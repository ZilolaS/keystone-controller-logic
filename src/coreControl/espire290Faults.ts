// src/coreControl/espire290Faults.ts
//
// Fault classification + power caps for the eSpire 290 battery side
// (OLiPower Omni BL 290 CMS). Bit meanings come from the vendor point sheet
// (OLP290_CMS_ETH2_V3.3) and the controller strategy doc (V0.4, sections 6
// and 9) - see docs/eSpire290_OLP_CMS_Modbus_Register_Map.md.
//
// The CMS protects itself: level-2 alarms drive the allowed charge/discharge
// current to 0, level-3 ("severe") alarms open the contactors. So the EMS
// does not re-implement cell protection; it (a) respects the CMS power caps,
// (b) decides which tripped faults are safe to reset remotely and which need
// a person on site, and (c) can isolate a bad cluster and keep running on the
// rest (vendor: "allowed, EMS handles it").

/** CMS input registers 31973/31974 (system level). */
export const E290_CMS_FAULT_WORD1 = {
  cmsFault: 0,
  bmsCountConfigError: 1,
  cellCapacityConfigError: 2,
  bsuCountConfigError: 3,
  cellCountConfigError: 4,
  tcCountConfigError: 5,
  socDiffTooHigh: 6,
  /** < 10 %: HV-on refused; if already on, alarm only. */
  socTooLow: 7,
  /** > 500 mV: HV-on refused; if already on, alarm only. */
  cellVoltageDiffTooHigh: 8,
  /** > 10 A circulating current: HV-on refused; if already on, alarm only. */
  currentDiffTooHigh: 9,
} as const;

export const E290_CMS_FAULT_WORD2 = {
  emergencyStop: 0,
} as const;

/** Per-cluster faultCode_2 (offset 28). */
export const E290_CLUSTER_FAULT_CODE2 = {
  lCanComm: 0,
  temperatureSensor: 1,
  voltageSensor: 2,
  insulation: 3,
  contactor: 4,
  forcedChargeRequest: 5,
  thermalUnitComm: 6,
} as const;

/** Per-cluster faultCode_3 (offset 29) - site digital inputs. */
export const E290_CLUSTER_FAULT_CODE3 = {
  emergencyStop: 0,
  heatDetector: 1,
  /** Point sheet: "door open (no HV-off)"; strategy doc: smoke detector (minor). Informational either way. */
  doorOrSmoke: 2,
  waterImmersion: 3,
  dehumidifier: 4,
  combustibleGas: 5,
  positiveFuse: 6,
  negativeFuse: 7,
} as const;

/** faultCode_1 bits that are defined (cell/pack OV/UV/T/OC/dV/dT, BSU dV). */
const PROTECTION_TRIP_MASK = 0b0100_1111_1111_1111;
const HAZARD_CODE3_MASK =
  bitMask(E290_CLUSTER_FAULT_CODE3.emergencyStop) |
  bitMask(E290_CLUSTER_FAULT_CODE3.heatDetector) |
  bitMask(E290_CLUSTER_FAULT_CODE3.waterImmersion) |
  bitMask(E290_CLUSTER_FAULT_CODE3.combustibleGas);
const HARDWARE_CODE3_MASK =
  bitMask(E290_CLUSTER_FAULT_CODE3.positiveFuse) |
  bitMask(E290_CLUSTER_FAULT_CODE3.negativeFuse);
const HARDWARE_CODE2_MASK =
  bitMask(E290_CLUSTER_FAULT_CODE2.temperatureSensor) |
  bitMask(E290_CLUSTER_FAULT_CODE2.voltageSensor) |
  bitMask(E290_CLUSTER_FAULT_CODE2.insulation) |
  bitMask(E290_CLUSTER_FAULT_CODE2.contactor);
const COMM_CODE2_MASK =
  bitMask(E290_CLUSTER_FAULT_CODE2.lCanComm) |
  bitMask(E290_CLUSTER_FAULT_CODE2.thermalUnitComm);
const CONFIG_WORD1_MASK = 0b11_1110;
const HV_ON_BLOCKER_WORD1_MASK =
  bitMask(E290_CMS_FAULT_WORD1.socTooLow) |
  bitMask(E290_CMS_FAULT_WORD1.cellVoltageDiffTooHigh) |
  bitMask(E290_CMS_FAULT_WORD1.currentDiffTooHigh);

/** IMU 34000 bits 4-5: 00 normal, 01 level-2, 10 level-1. */
const IMU_FAULT_LEVEL_SHIFT = 4;

export interface Espire290ClusterTelemetry {
  /** Offset 49 - 1 = HV-on allowed. */
  bmsSelfCheck?: number;
  /** Offsets 27-29. */
  faultCode1?: number;
  faultCode2?: number;
  faultCode3?: number;
  /** Offset 37 - level-2 alarms (CMS already zeroes allowed current). */
  warningCode1?: number;
  allowedChargeCurrentA?: number;
  allowedDischargeCurrentA?: number;
  soc?: number;
}

export interface Espire290CmsTelemetry {
  /** 31951 - bitN = cluster N+1 faulted. */
  cmsFaultStatus?: number;
  /** 31953 - bitN = cluster N+1 HV on. */
  cmsHvOnStatus?: number;
  /** 31955 / 31956 - per-cluster forbid masks. */
  bmsChargeForbidStatus?: number;
  bmsDischargeForbidStatus?: number;
  cmsFaultWord1?: number;
  cmsFaultWord2?: number;
  /** 34000 - insulation monitor status word. */
  imuStatus?: number;
  /** 30052 / 30061 / 30062 - config readback. */
  sysOperationMode?: number;
  bmsConfigNumber?: number;
  bmsEnableStatus?: number;
  /** 31962, %. */
  cmsSoc?: number;
  /** 32784 / 32785, kW (unsigned magnitudes). */
  cmsAllowedChargePowerKw?: number;
  cmsAllowedDischargePowerKw?: number;
  /** Index 0 = cluster 1. */
  clusters?: Espire290ClusterTelemetry[];
  criticalTelemetryMissing?: boolean;
}

export type Espire290FaultCategory =
  /** Fire/gas/water/E-stop - never reset remotely, needs a site inspection. */
  | "hazard"
  /** Fuses, sensors, contactor, insulation - needs service. */
  | "hardware"
  /** CMS configuration error (cluster/cell counts) - fix config, not reset. */
  | "config"
  /** Internal link (L-CAN, TMU) - resettable once the link is back. */
  | "comm"
  /** Level-3 OV/UV/temp/current/dV trip - remotely resettable per vendor. */
  | "protection";

export interface Espire290ClusterFault {
  cluster: number;
  categories: Espire290FaultCategory[];
  reasons: string[];
}

export interface Espire290FaultClassification {
  faulted: boolean;
  /** Every active fault is comm/protection, so a remote reset is allowed. */
  recoverable: boolean;
  /** System-level (CMS) faults, not tied to a cluster. */
  systemCategories: Espire290FaultCategory[];
  clusterFaults: Espire290ClusterFault[];
  /** Clusters (1-based) with a hazard/hardware fault - candidates for isolation. */
  unrecoverableClusters: number[];
  /** CMS will refuse HV-on (SOC < 10 %, cell dV > 500 mV, current diff > 10 A). */
  hvOnBlocked: boolean;
  forcedChargeRequested: boolean;
  criticalTelemetryMissing: boolean;
  reasons: string[];
}

export function classifyEspire290Faults(
  telemetry: Espire290CmsTelemetry,
  enabledMask = 0xffff
): Espire290FaultClassification {
  const reasons: string[] = [];
  const systemCategories = new Set<Espire290FaultCategory>();
  const word1 = toWord(telemetry.cmsFaultWord1);
  const word2 = toWord(telemetry.cmsFaultWord2);

  if (hasBit(word2, E290_CMS_FAULT_WORD2.emergencyStop)) {
    systemCategories.add("hazard");
    reasons.push("e290-cms-emergency-stop");
  }
  if (word1 & CONFIG_WORD1_MASK) {
    systemCategories.add("config");
    reasons.push("e290-cms-config-error");
  }
  if (hasBit(word1, E290_CMS_FAULT_WORD1.socDiffTooHigh)) {
    systemCategories.add("protection");
    reasons.push("e290-cms-soc-diff-too-high");
  }
  const imuLevel = (toWord(telemetry.imuStatus) >> IMU_FAULT_LEVEL_SHIFT) & 0b11;
  if (imuLevel === 0b10) {
    systemCategories.add("hardware");
    reasons.push("e290-imu-insulation-level1");
  } else if (imuLevel === 0b01) {
    reasons.push("e290-imu-insulation-level2-warning");
  }

  const hvOnBlocked = (word1 & HV_ON_BLOCKER_WORD1_MASK) !== 0;
  if (hasBit(word1, E290_CMS_FAULT_WORD1.socTooLow)) reasons.push("e290-hv-on-blocked-soc-below-10");
  if (hasBit(word1, E290_CMS_FAULT_WORD1.cellVoltageDiffTooHigh)) reasons.push("e290-hv-on-blocked-cell-dv");
  if (hasBit(word1, E290_CMS_FAULT_WORD1.currentDiffTooHigh)) reasons.push("e290-hv-on-blocked-circulating-current");

  const clusterFaults: Espire290ClusterFault[] = [];
  const unrecoverableClusters: number[] = [];
  let forcedChargeRequested = false;
  const faultMask = toWord(telemetry.cmsFaultStatus);

  (telemetry.clusters ?? []).forEach((cluster, index) => {
    if (!hasBit(enabledMask, index)) return;
    const number = index + 1;
    const code1 = toWord(cluster.faultCode1);
    const code2 = toWord(cluster.faultCode2);
    const code3 = toWord(cluster.faultCode3);
    const categories = new Set<Espire290FaultCategory>();
    const clusterReasons: string[] = [];

    if (hasBit(code2, E290_CLUSTER_FAULT_CODE2.forcedChargeRequest)) {
      forcedChargeRequested = true;
      clusterReasons.push(`e290-bms${number}-forced-charge-request`);
    }
    if (code3 & HAZARD_CODE3_MASK) {
      categories.add("hazard");
      clusterReasons.push(`e290-bms${number}-site-hazard`);
    }
    if (code3 & HARDWARE_CODE3_MASK || code2 & HARDWARE_CODE2_MASK) {
      categories.add("hardware");
      clusterReasons.push(`e290-bms${number}-hardware-fault`);
    }
    if (code2 & COMM_CODE2_MASK) {
      categories.add("comm");
      clusterReasons.push(`e290-bms${number}-internal-comm-fault`);
    }
    if (code1 & PROTECTION_TRIP_MASK) {
      categories.add("protection");
      clusterReasons.push(`e290-bms${number}-protection-trip`);
    }
    // The CMS fault mask can be set with no decodable code bit (codes 4-10 are
    // undocumented) - treat it as a protection trip so it still gets a reset.
    if (categories.size === 0 && hasBit(faultMask, index)) {
      categories.add("protection");
      clusterReasons.push(`e290-bms${number}-fault-undecoded`);
    }

    if (categories.size > 0) {
      clusterFaults.push({ cluster: number, categories: [...categories], reasons: clusterReasons });
      if (categories.has("hazard") || categories.has("hardware")) {
        unrecoverableClusters.push(number);
      }
    }
    reasons.push(...clusterReasons);
  });

  const criticalTelemetryMissing = telemetry.criticalTelemetryMissing === true;
  if (criticalTelemetryMissing) reasons.push("e290-critical-telemetry-missing");

  const allCategories = new Set<Espire290FaultCategory>(systemCategories);
  for (const fault of clusterFaults) fault.categories.forEach((c) => allCategories.add(c));
  const faulted = allCategories.size > 0;
  const recoverable =
    faulted &&
    !criticalTelemetryMissing &&
    [...allCategories].every((c) => c === "comm" || c === "protection");

  return {
    faulted,
    recoverable,
    systemCategories: [...systemCategories],
    clusterFaults,
    unrecoverableClusters,
    hvOnBlocked,
    forcedChargeRequested,
    criticalTelemetryMissing,
    reasons,
  };
}

export interface Espire290PowerCapsInput {
  telemetry: Espire290CmsTelemetry;
  enabledMask: number;
  /** Delta PCS125HV rating x PCS count (site config). */
  pcsRatingKw: number;
}

export interface Espire290PowerCaps {
  maxChargeKw: number;
  maxDischargeKw: number;
  reasons: string[];
}

/**
 * Charge/discharge caps for the PCS dispatch, in kW magnitudes. The CMS
 * already folds level-2 protection into 32784/32785 (min cluster limit x
 * HV-on cluster count), so this mostly clamps to the PCS rating and zeroes
 * out when no enabled cluster is on HV or the forbid masks are set.
 */
export function resolveEspire290PowerCaps(input: Espire290PowerCapsInput): Espire290PowerCaps {
  const { telemetry, enabledMask } = input;
  const reasons: string[] = [];
  const pcsKw = Math.max(0, Number(input.pcsRatingKw) || 0);
  const hvOn = toWord(telemetry.cmsHvOnStatus) & enabledMask;

  if (telemetry.criticalTelemetryMissing) {
    return { maxChargeKw: 0, maxDischargeKw: 0, reasons: ["e290-caps-telemetry-missing"] };
  }
  if (hvOn === 0) {
    return { maxChargeKw: 0, maxDischargeKw: 0, reasons: ["e290-caps-no-cluster-on-hv"] };
  }

  let maxChargeKw = capFrom(telemetry.cmsAllowedChargePowerKw, pcsKw);
  let maxDischargeKw = capFrom(telemetry.cmsAllowedDischargePowerKw, pcsKw);
  if (telemetry.cmsAllowedChargePowerKw == null) reasons.push("e290-caps-charge-limit-missing");
  if (telemetry.cmsAllowedDischargePowerKw == null) reasons.push("e290-caps-discharge-limit-missing");

  // Any HV-on cluster forbidding a direction blocks it for the whole DC bus.
  if (toWord(telemetry.bmsChargeForbidStatus) & hvOn) {
    maxChargeKw = 0;
    reasons.push("e290-caps-charge-forbidden");
  }
  if (toWord(telemetry.bmsDischargeForbidStatus) & hvOn) {
    maxDischargeKw = 0;
    reasons.push("e290-caps-discharge-forbidden");
  }

  return { maxChargeKw, maxDischargeKw, reasons };
}

/**
 * CMS DC power (32783) is charge-positive; the unified control cycle uses
 * +PCS = discharge, -PCS = charge.
 */
export function espire290CmsPowerToPcsConvention(cmsDcPowerKw: number): number {
  return -cmsDcPowerKw;
}

/** Bitmask with the low `count` bits set (clusters 1..count). */
export function espire290ClusterMask(count: number): number {
  const n = Math.max(0, Math.min(16, Math.trunc(count)));
  return n === 16 ? 0xffff : (1 << n) - 1;
}

function capFrom(limitKw: number | undefined, pcsKw: number): number {
  if (limitKw == null || !Number.isFinite(limitKw)) return 0;
  return Math.max(0, Math.min(Math.abs(limitKw), pcsKw));
}

function bitMask(bit: number): number {
  return 1 << bit;
}

export function hasBit(word: number, bit: number): boolean {
  return ((word >>> bit) & 1) === 1;
}

function toWord(value: number | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric & 0xffff : 0;
}
