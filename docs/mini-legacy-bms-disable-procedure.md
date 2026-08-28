# Mini Legacy BMS Disable Procedure

Use this procedure when adding the unified FMP/AWS telemetry flow to an existing Mini controller while keeping the legacy Azure reporting flow online.

Goal: make the unified telemetry reader the only reader for AMPACE/BMS/BCU data, then bridge unified telemetry back into the legacy `AMP_A` shape. This reduces Modbus contention on the BMS while preserving the existing Azure output path.

## Rules

- Back up the Node-RED container before every change.
- Do not edit the repo ad hoc on a controller. If the unified flow or TypeScript logic changes, commit it and push or open a PR before rolling it to other sites.
- Keep PCS, Load, Meter, PV, Azure outputs, and existing control logic untouched unless the site-specific plan says otherwise.
- Disable only legacy AMPACE/BMS polling nodes. Leave dashboard display nodes alone.
- Do not publish 42K/52K battery payloads without a real BCU/BMS serial number.

## Step By Step

1. Identify the controller.

   Record the controller IP, gateway/controller serial, site name, product profile, timezone, and whether control/writes should remain disabled.

2. Back up Node-RED.

   Save a full `/data/node-red` backup from inside `NodeRedModule` before edits.

   ```bash
   docker exec NodeRedModule sh -lc 'cd /data && tar czf /tmp/node-red-before-unified-bms.tgz node-red'
   docker cp NodeRedModule:/tmp/node-red-before-unified-bms.tgz ./node-red-before-unified-bms.tgz
   ```

3. Confirm the site config.

   Verify the Mini profile, timezone, asset IPs, PVDC count, BCU count, signal mapping, and compatibility bridge.

   Required compatibility shape:

   ```json
   {
     "telemetryCompatibility": {
       "publishUnifiedToLegacy": {
         "PCS": { "legacyEquipment": "INVERTER" },
         "Load": { "legacyEquipment": "INVERTER" },
         "Meter": { "legacyEquipment": "Meter" },
         "AMPACE": { "legacyEquipment": "AMP_A" }
       }
     }
   }
   ```

4. Confirm unified readers are configured.

   Expected Mini readers are typically:

   - `PCS` using `Sinexcel_Mini_PCS_ss40k`
   - `AMPACE` using `AMPACE_Mini_ss40k`
   - `Load` using `Sinexcel_Mini_Load_ss40k`
   - `PVDC1`, `PVDC2`, `PVDC3` as needed by model DC PV size
   - `Gateway` using `Sinexcel_Mini_Gateway_ss40k` when cabinet/STS/IO alarms are required
   - `Meter` using a site-config generated meter template when eGauge data is required

5. Disable legacy BMS polling.

   In the existing legacy flow, disable only the mapped-reader subflow instances that poll AMPACE/BMS directly. On older Mini flows these are usually named:

   - `AMP_A`
   - `AMP_B`
   - `AMP_C`

   Do not disable BMS dashboard display nodes just because their labels include BMS or AMPACE. The polling nodes are normally subflow instances of `Mapped Modbus Reader` on the `Operation` tab.

6. Restart Node-RED once.

   Restart is required because polling timers live in Node.js memory.

   ```bash
   docker restart NodeRedModule
   ```

7. Verify unified telemetry freshness.

   Check `global.unifiedTelemetry` / `global.NEW_telemetry` for fresh timestamps:

   - `PCS`
   - `Load`
   - `PVDC1`, `PVDC2`, `PVDC3` as configured
   - `Meter` if configured
   - `AMPACE`
   - `AMPACE_BCU_1`, etc.

   `AMPACE` parent and each BCU should refresh from the unified reader. Stale BCU keys above configured BCU count should be pruned by the unified store logic.

8. Verify legacy bridge freshness.

   Check `global.telemetry` and top-level dashboard globals:

   - `global.telemetry.AMP_A`
   - `global.AMP_A`
   - `global.telemetry.INVERTER`
   - `global.INVERTER`

   `AMP_A` should now be populated by the unified bridge, not by legacy AMPACE polling.

9. Verify battery identity.

   Check `/api/products`. The battery will appear only when a real battery/BCU serial number is available from telemetry or site config.

   If BCU serials cannot be read reliably during commissioning, add configured BCU serial numbers to site config. Do not invent placeholder serials.

10. Verify cloud outputs.

   Check AWSFeed logs for successful telemetry publish and named shadow publish. Check Azure output logs only to confirm existing Azure reporting still sends.

11. Save an after backup.

   After verification, save a second `/data/node-red` backup and record the result in the rollout tracker.

## Rollback

If AMPACE telemetry gets worse or Azure reporting is affected:

1. Restore the pre-change Node-RED backup.
2. Restart `NodeRedModule`.
3. Confirm legacy telemetry returns to its previous behavior.
4. Record the failed step and logs before trying again.

## Notes

- If legacy and unified BMS polling run at the same time, AMPACE can become slow or stop responding to one side. This causes stale BMS/BCU telemetry and missing battery products in AWS device shadow.
- Mixed legacy and unified telemetry can make dashboards look partially alive while important battery or PV values are stale.
- For mixed DC PV plus AC PV sites, keep `pPVTotal` as DC PV only. Use signal mapping for total site PV/power-flow calculations when AC PV must be included.
