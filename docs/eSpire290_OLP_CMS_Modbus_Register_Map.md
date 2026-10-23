# eSpire 290 – OLiPower CMS Modbus register map and control notes

**Sources** (R&D for C&I SharePoint → `020 Product/espire 290/EMS General/General`):

- `OLP290_CMS_ETH2_V3.3-LY 20260930.xlsx`: point sheet (authoritative for addresses)
- `Omni BL 290 液冷储能柜三级BMS控制器策略文档_V0.4 - 20260930.docx`: controller strategy (startup flow, protection table, fault severities)

**Hardware**

- Battery side: OLiPower Omni BL 290 liquid-cooled cabinet. The 3-level BMS controller (CMS) is an ECU-1170-551 and runs up to 16 BMU clusters, each paired with one TMU (chiller). The insulation monitor is an OLP-X1-IRM-1500-UL on CAN address 17.
- PCS: Delta PCS125HV (per `eSpire 290_Inverter_Installation_Manual_V1.2`), the same unit as the 280. Reuse `Delta_280_ss40k.json`.

## 1. Interfaces

| Port | IP | Use |
|---|---|---|
| ETH1 | 192.168.1.101 | MQTT cloud, local HMI Modbus :502 |
| **ETH2** | **192.168.2.101** | **Upper-level EMS, Modbus TCP :503 (our connection)** |
| ETH3 | 192.168.3.101 | Internal parallel :504 |
| ETH4 | 192.168.4.101 | Third-party device :505 |

**Comm watchdog:** the CMS opens all contactors after **60 s** without EMS traffic on ETH2 (strategy doc §6 item 41, a severe fault that is remotely resettable). Poll ETH2 well inside 60 s. The docs don't say whether reads alone count as traffic or whether a write or heartbeat is required (open question 1).

## 2. Addressing and data rules

- The templates use the sheet's labels as **literal PDU addresses**: IR `31962` is read with FC04 at address 31962, and HR `40215` is written with FC06/16 at 40215. Everything fits in 16 bits. The sheet never states its offset convention, so **check this on the first site connection**: if every read comes back as an illegal-address exception or shifted, subtract 30000 or 40000.
- Signedness follows the sheet's "Data Rule" block, not its blanket `Int16` column:
  - Power, current and temperature are signed (`IR`).
  - Voltage, capacity, energy and frequency are unsigned (`IRUS`).
  - `cmsRateCapacity` at 0.1 kWh overflows Int16 above about 11 clusters, which is another reason to read it unsigned.
- **Sign convention:** CMS current and power are **charge +, discharge −**. The unified control cycle uses +PCS = discharge, so convert with `espire290CmsPowerToPcsConvention()`.
- Block strides:
  - BMS cluster telemetry: `31981 + 50·(n−1)`
  - TMU telemetry: `33162 + 28·(n−1)`
  - Cluster controls: `40300 + 8·(n−1)`

## 3. Templates

| File | Content |
|---|---|
| `eSpire290_OLP_CMS_ss_TEMPLATE.json` | 83 system points: config, clock, DI/DO, CMS aggregates and limits, TMS summary, IMU. 75 commands: mode/config/HV/reset, plus reset/HV/soft-start for clusters 1–16 |
| `eSpire290_OLP_BMS_Cluster_ss_TEMPLATE.json` | Offset template for one cluster (offsets 0–49) |
| `eSpire290_OLP_TMU_ss_TEMPLATE.json` | Offset template for one TMU (offsets 0–26) |

`buildEspire290EquipmentConfig({ clusterCount })` in `src/telemetry/espire290OlpCms.ts` returns the CMS entry plus one BMS entry and one TMU entry per cluster.

The 24-char system and EMS SN strings (30001–30024 and 30026–30049, one ASCII character per register) are not templated, because the reader has no ASCII parser yet. Only the length registers are.

Every `ss40k.model` is `"TODO"`. See `src/telemetry/espire290ReportingModels.ts`.

## 4. Control sequence (`src/coreControl/espire290CmsSequencer.ts`)

The vendor flow (strategy doc §5) is implemented as a state machine: `off → configure → verify-config → precheck → hv-on-sent → running`. Error paths go to `fault-reset-sent`, `hv-off-sent` and `lockout`.

1. **configure:** write `40032` (cluster count, also `40037` TMU count) and `40033` (enable mask, also `40038`). Then `40007 = 3` (manual: realtime power executes immediately) and `40019 = 2` (remote over ETH2).
2. **verify-config:** after the settle time, read back `30061`, `30062` and `30052`. Retry up to 3 times, then lock out.
3. **precheck:**
   - If a comm or protection fault is active: write `40214 = 1` **once** (the vendor says never to hold it), settle, and retry up to 2 times.
   - If the CMS would refuse HV-on, hold and do nothing. The triggers are `31973` bit7 (SOC < 10 %), bit8 (cell ΔV > 500 mV) and bit9 (circulating current > 10 A).
   - If any enabled cluster has `bmsSelfCheck ≠ 1`, hold.
4. **hv-on:** write `40215 = 1` and `40216 = 0` as a **pair**. Off is `0 / 1`, and any other combination is invalid. Wait for the `31953` HV-on mask to cover every enabled cluster (30 s timeout, 3 attempts).
5. **running:** `available = true`. The caps come from `32784`/`32785`, clamped to the PCS rating and zeroed by the `31955`/`31956` forbid masks. If HV drops, go back to precheck.

**Cluster isolation** (`allowClusterIsolation`, default off): a cluster with a hazard or hardware fault gets cluster HV off and its bit cleared in `40033`, and the system keeps running if at least `minClusters` remain. Without isolation, or below the minimum, the system turns HV off for everything and locks out.

**Lockout** is released only by `clearLockout` (operator acknowledgement after a site check).

### Fault tiers (`src/coreControl/espire290Faults.ts`)

| Tier | Bits | Auto-reset? |
|---|---|---|
| hazard | cluster code3 b0 E-stop, b1 heat detector, b3 water, b5 combustible gas; CMS word2 b0 E-stop | **Never.** Needs a site inspection |
| hardware | code3 b6/b7 fuses; code2 b1 temperature sensor, b2 voltage sensor, b3 insulation, b4 contactor; IMU level-1 | Never |
| config | CMS word1 b1–b5 | Never. Fix the config |
| comm | code2 b0 L-CAN, b6 TMU comm | Yes |
| protection | code1 (cell/pack OV/UV, temperature, OC, ΔV, ΔT, BSU ΔV level-3); CMS word1 b6 SOC diff; fault mask bit set with no decodable code | Yes, limited attempts |
| informational | code3 b2 door/smoke, b4 dehumidifier; code2 b5 **forced-charge request** (surfaced as `forcedChargeRequested`) | n/a |

Level-2 alarms (`warningCode1`) are not treated as faults. The CMS already drives the allowed current in that direction to 0, and the caps follow.

## 5. Vendor doc discrepancies (raise with OLP)

1. The strategy doc lists the CMS limits at **3178x**; the point sheet (V3.3) has **32781–32785**. The templates use the sheet.
2. The strategy doc gives cluster-2 HV-on as `40309 = 10` and cluster-16 as `40421 = 10`. Every other mention uses `1`. The code assumes **1**.
3. The strategy doc labels the cluster `faultCode_3` address as `32009`, which duplicates `faultCode_2`. Offset arithmetic gives **32010**, and the templates use that.
4. The strategy doc gives `40427` as cluster-16 "reset"; by stride it is cluster-16 **soft start** (40420 is reset).
5. `faultCode_1` bits: the sheet says "Level-1 alarm" and the strategy doc says "Level-3" (contactor-opening). The code treats them as **severe** (strategy doc), since the CMS warning register already carries level-2 and level-1 is "not reported externally".
6. `faultCode_3` bit2: the sheet says "door open (no HV-off)" and the strategy doc says "smoke detector (minor)". Both are non-acting, so it is treated as informational.
7. The sheet's Version tab stops at V3.0, while the file is named V3.3.

## 6. Open questions

1. What satisfies the 60 s EMS comm watchdog: any FC03/04 read on ETH2, or a write or heartbeat register? (`30257 heartBeat` is read-only.)
2. Semantics of `31950 cmsOnlineStatus`, `31954 cmsChargeStatus`, the per-cluster `chargeStatus`/`runningStatus`, and whether `31955–31958` are per-cluster bitmasks (assumed).
3. The TMU fault and warning codes are said to follow the chiller vendor's protocol, which isn't provided.
4. Recovery path when SOC < 10 % with HV off: the CMS refuses HV-on, so the system can't charge itself. What does OLP expect: a forced-charge procedure, or the `softStartBMS` registers?
5. How is the PCS power command routed: EMS → Delta PCS directly (as on the 280), or through CMS ETH4 / H2-L2?
