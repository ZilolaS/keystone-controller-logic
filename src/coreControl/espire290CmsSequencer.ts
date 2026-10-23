// src/coreControl/espire290CmsSequencer.ts
//
// Startup / HV / fault-recovery sequencer for the eSpire 290 battery side
// (OLiPower Omni BL 290 CMS). Unlike the 314 ESMU, the CMS does NOT bring
// itself up: per the vendor strategy doc (V0.4 section 5) it waits for the
// EMS to configure it and command HV on:
//
//   1. 40032 cluster count, 40033 cluster enable mask
//   2. 40007 working mode (3 = manual: execute realtime power immediately)
//   3. 40019 operation mode (2 = remote over ETH2)
//   4. read back 30061 / 30062, check 31973 bit0 + 31951 for faults
//   5. HV on: 40215 = 1 AND 40216 = 0 (HV off is 0 / 1) - always as a pair
//   6. wait for 31953 (HV-on mask) to cover every enabled cluster
//
// Faulted clusters may be dropped from the enable mask so the rest keep
// running ("allowed, EMS handles it"). Resets (40214 all / 40300+8n one
// cluster) are single-shot writes - the vendor says never to hold them.
//
// Also note: the CMS opens all contactors after 60 s without EMS traffic on
// ETH2 (strategy doc section 6 item 41), so the reader must poll the CMS well
// inside that window or the battery will drop off mid-dispatch.

import type { ControlEnvelope } from "../writer/writer";
import {
  classifyEspire290Faults,
  espire290ClusterMask,
  hasBit,
  resolveEspire290PowerCaps,
  type Espire290CmsTelemetry,
  type Espire290FaultClassification,
  type Espire290PowerCaps,
} from "./espire290Faults";

export const ESPIRE290_EMS_COMM_TIMEOUT_MS = 60_000;
export const ESPIRE290_OPERATION_MODE_REMOTE = 2;
export const ESPIRE290_WORKING_MODE_MANUAL = 3;

export type Espire290SequencerMode =
  | "off"
  | "configure"
  | "verify-config"
  | "precheck"
  | "fault-reset-sent"
  | "hv-on-sent"
  | "running"
  | "hv-off-sent"
  | "lockout";

export interface Espire290SequencerState {
  mode: Espire290SequencerMode;
  /** Clusters currently enabled in 40033 (bit0 = cluster 1). */
  enabledMask: number;
  /** Clusters dropped from service by this sequencer. */
  isolatedMask: number;
  configAttempts: number;
  resetAttempts: number;
  hvOnAttempts: number;
  waitUntilMs?: number;
  lockoutReason?: string;
}

export interface Espire290SequencerInput {
  telemetry: Espire290CmsTelemetry;
  /** Scheduler wants the battery available (HV on). */
  runRequested: boolean;
  /** Clusters physically installed (1-16). */
  clusterCount: number;
  /** Delta PCS125HV rating x PCS count, for the power caps. */
  pcsRatingKw: number;
  /** Operator acknowledged a lockout after a site check. */
  clearLockout?: boolean;
}

export interface Espire290SequencerOptions {
  nowMs?: number;
  settleMs?: number;
  hvOnTimeoutMs?: number;
  maxConfigAttempts?: number;
  maxResetAttempts?: number;
  maxHvOnAttempts?: number;
  /** Drop hazard/hardware-faulted clusters and keep running on the rest. */
  allowClusterIsolation?: boolean;
  /** Minimum healthy clusters needed to stay in service. */
  minClusters?: number;
}

export type Espire290Command =
  | { kind: "set-operation-mode"; value: number }
  | { kind: "set-working-mode"; value: number }
  | { kind: "set-cluster-count"; value: number }
  | { kind: "set-enable-mask"; value: number }
  | { kind: "hv-on" }
  | { kind: "hv-off" }
  | { kind: "reset-all" }
  | { kind: "cluster-hv-off"; cluster: number }
  | { kind: "cluster-reset"; cluster: number };

export interface Espire290SequencerResult {
  state: Espire290SequencerState;
  commands: Espire290Command[];
  classification: Espire290FaultClassification;
  caps: Espire290PowerCaps;
  /** True only when every enabled cluster is on HV and dispatch may use the caps. */
  available: boolean;
  reasons: string[];
}

const DEFAULT_SETTLE_MS = 5_000;
const DEFAULT_HV_ON_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONFIG_ATTEMPTS = 3;
const DEFAULT_MAX_RESET_ATTEMPTS = 2;
const DEFAULT_MAX_HV_ON_ATTEMPTS = 3;

export function initialEspire290SequencerState(clusterCount: number): Espire290SequencerState {
  return {
    mode: "off",
    enabledMask: espire290ClusterMask(clusterCount),
    isolatedMask: 0,
    configAttempts: 0,
    resetAttempts: 0,
    hvOnAttempts: 0,
  };
}

export function evaluateEspire290CmsSequencer(
  input: Espire290SequencerInput,
  previousState: Espire290SequencerState = initialEspire290SequencerState(input.clusterCount),
  options: Espire290SequencerOptions = {}
): Espire290SequencerResult {
  const nowMs = options.nowMs ?? Date.now();
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const hvOnTimeoutMs = options.hvOnTimeoutMs ?? DEFAULT_HV_ON_TIMEOUT_MS;
  const maxConfigAttempts = options.maxConfigAttempts ?? DEFAULT_MAX_CONFIG_ATTEMPTS;
  const maxResetAttempts = options.maxResetAttempts ?? DEFAULT_MAX_RESET_ATTEMPTS;
  const maxHvOnAttempts = options.maxHvOnAttempts ?? DEFAULT_MAX_HV_ON_ATTEMPTS;
  const minClusters = Math.max(1, options.minClusters ?? 1);

  const { telemetry } = input;
  const installedMask = espire290ClusterMask(input.clusterCount);
  const state: Espire290SequencerState = { ...previousState };
  const commands: Espire290Command[] = [];
  const reasons: string[] = [];
  const hvOnMask = toWord(telemetry.cmsHvOnStatus);

  if (state.mode === "lockout" && input.clearLockout) {
    Object.assign(state, initialEspire290SequencerState(input.clusterCount));
    reasons.push("e290-lockout-cleared");
  }

  let classification = classifyEspire290Faults(telemetry, state.enabledMask);

  const finish = (): Espire290SequencerResult => {
    const caps = resolveEspire290PowerCaps({
      telemetry,
      enabledMask: state.enabledMask,
      pcsRatingKw: input.pcsRatingKw,
    });
    const available = state.mode === "running";
    return {
      state,
      commands,
      classification,
      caps: available ? caps : { maxChargeKw: 0, maxDischargeKw: 0, reasons: ["e290-not-running", ...caps.reasons] },
      available,
      reasons: [...reasons, ...classification.reasons],
    };
  };

  // No telemetry means no ETH2 link: writes would not land either. Hold; the
  // CMS drops HV on its own after 60 s of EMS silence.
  if (telemetry.criticalTelemetryMissing) {
    reasons.push("e290-hold-telemetry-missing");
    if (state.mode === "running") state.mode = "precheck";
    return finish();
  }

  if (state.mode === "lockout") {
    if (hvOnMask & installedMask) commands.push({ kind: "hv-off" });
    reasons.push(`e290-lockout:${state.lockoutReason ?? "unknown"}`);
    return finish();
  }

  // System-level hazard/hardware/config faults stop everything.
  const systemBlocking = classification.systemCategories.filter(
    (c) => c === "hazard" || c === "hardware" || c === "config"
  );
  if (systemBlocking.length > 0) {
    return lockout(`system-${systemBlocking.join("+")}`);
  }

  // Cluster-level hazard/hardware faults: isolate if allowed, else lock out.
  if (classification.unrecoverableClusters.length > 0) {
    const badMask = classification.unrecoverableClusters.reduce((m, n) => m | (1 << (n - 1)), 0);
    const remainingMask = state.enabledMask & ~badMask;
    if (options.allowClusterIsolation && popcount(remainingMask) >= minClusters) {
      for (const cluster of classification.unrecoverableClusters) {
        if (hasBit(hvOnMask, cluster - 1)) commands.push({ kind: "cluster-hv-off", cluster });
      }
      commands.push({ kind: "set-enable-mask", value: remainingMask });
      state.enabledMask = remainingMask;
      state.isolatedMask |= badMask;
      reasons.push(`e290-isolated-clusters:${classification.unrecoverableClusters.join(",")}`);
      // Re-judge with the faulted clusters out of the enable mask.
      classification = classifyEspire290Faults(telemetry, state.enabledMask);
      if (state.mode === "running" || state.mode === "hv-on-sent") {
        state.mode = "verify-config";
        state.waitUntilMs = nowMs + settleMs;
        return finish();
      }
    } else {
      return lockout(`clusters-${classification.unrecoverableClusters.join(",")}-unrecoverable`);
    }
  }

  if (!input.runRequested) {
    if (hvOnMask & installedMask) {
      if (state.mode !== "hv-off-sent") {
        commands.push({ kind: "hv-off" });
        state.mode = "hv-off-sent";
        reasons.push("e290-stop-requested-hv-off");
      } else {
        reasons.push("e290-waiting-hv-off");
      }
    } else {
      state.mode = "off";
      state.configAttempts = 0;
      state.resetAttempts = 0;
      state.hvOnAttempts = 0;
      reasons.push("e290-off");
    }
    return finish();
  }

  const enabled = state.enabledMask;
  const waiting = state.waitUntilMs != null && nowMs < state.waitUntilMs;

  switch (state.mode) {
    case "off":
    case "hv-off-sent":
    case "configure":
      if (state.configAttempts >= maxConfigAttempts) {
        return lockout("config-not-accepted");
      }
      commands.push(
        { kind: "set-cluster-count", value: popcount(installedMask) },
        { kind: "set-enable-mask", value: enabled },
        { kind: "set-working-mode", value: ESPIRE290_WORKING_MODE_MANUAL },
        { kind: "set-operation-mode", value: ESPIRE290_OPERATION_MODE_REMOTE }
      );
      state.configAttempts += 1;
      state.mode = "verify-config";
      state.waitUntilMs = nowMs + settleMs;
      reasons.push("e290-configure-sent");
      break;

    case "verify-config": {
      if (waiting) {
        reasons.push("e290-verify-config-wait");
        break;
      }
      const countOk = telemetry.bmsConfigNumber == null || telemetry.bmsConfigNumber === popcount(installedMask);
      const maskOk = telemetry.bmsEnableStatus == null || (toWord(telemetry.bmsEnableStatus) & installedMask) === enabled;
      const modeOk =
        telemetry.sysOperationMode == null || telemetry.sysOperationMode === ESPIRE290_OPERATION_MODE_REMOTE;
      if (countOk && maskOk && modeOk) {
        state.mode = "precheck";
        state.waitUntilMs = undefined;
        reasons.push("e290-config-verified");
      } else {
        state.mode = "configure";
        reasons.push("e290-config-readback-mismatch");
      }
      break;
    }

    case "precheck":
      if (classification.faulted) {
        // Only comm/protection faults remain here (others returned above).
        if (state.resetAttempts >= maxResetAttempts) {
          return lockout("reset-attempts-exhausted");
        }
        commands.push({ kind: "reset-all" });
        state.resetAttempts += 1;
        state.mode = "fault-reset-sent";
        state.waitUntilMs = nowMs + settleMs;
        reasons.push("e290-fault-reset-sent");
        break;
      }
      if (classification.hvOnBlocked) {
        // SOC < 10 % / cell dV / circulating current: the CMS refuses HV-on
        // and there is nothing safe to do remotely - flag it and wait.
        reasons.push("e290-precheck-hv-on-blocked");
        break;
      }
      if (!clustersSelfChecked(telemetry, enabled)) {
        reasons.push("e290-precheck-bms-not-ready");
        break;
      }
      if (state.hvOnAttempts >= maxHvOnAttempts) {
        return lockout("hv-on-attempts-exhausted");
      }
      commands.push({ kind: "hv-on" });
      state.hvOnAttempts += 1;
      state.mode = "hv-on-sent";
      state.waitUntilMs = nowMs + hvOnTimeoutMs;
      reasons.push("e290-hv-on-sent");
      break;

    case "fault-reset-sent":
      if (waiting) {
        reasons.push("e290-fault-reset-wait");
        break;
      }
      state.mode = "precheck";
      reasons.push("e290-fault-reset-settled");
      break;

    case "hv-on-sent":
      if ((hvOnMask & enabled) === enabled) {
        state.mode = "running";
        state.waitUntilMs = undefined;
        state.resetAttempts = 0;
        state.hvOnAttempts = 0;
        reasons.push("e290-running");
      } else if (!waiting) {
        state.mode = "precheck";
        reasons.push("e290-hv-on-timeout");
      } else {
        reasons.push("e290-hv-on-wait");
      }
      break;

    case "running":
      if ((hvOnMask & enabled) !== enabled) {
        state.mode = "precheck";
        reasons.push("e290-hv-dropped");
      } else {
        reasons.push("e290-running");
      }
      break;
  }

  return finish();

  function lockout(reason: string): Espire290SequencerResult {
    if (hvOnMask & installedMask) commands.push({ kind: "hv-off" });
    state.mode = "lockout";
    state.lockoutReason = reason;
    state.waitUntilMs = undefined;
    reasons.push(`e290-lockout:${reason}`);
    return finish();
  }
}

export interface Espire290WriterOptions {
  topic?: string;
}

/** Tag IDs are the command ids in eSpire290_OLP_CMS_ss_TEMPLATE.json. */
export function espire290CommandsToWriterEnvelopes(
  commands: Espire290Command[],
  options: Espire290WriterOptions = {}
): ControlEnvelope[] {
  const payload: ControlEnvelope["payload"] = [];

  for (const command of commands) {
    switch (command.kind) {
      case "set-operation-mode":
        payload.push({ tagID: "SetSysOperationMode", value: command.value });
        break;
      case "set-working-mode":
        payload.push({ tagID: "SetSysWorkingMode", value: command.value });
        break;
      case "set-cluster-count":
        payload.push({ tagID: "SetBmsConfigNumber", value: command.value });
        payload.push({ tagID: "SetTmuConfigNumber", value: command.value });
        break;
      case "set-enable-mask":
        payload.push({ tagID: "SetBmsEnableStatus", value: command.value });
        payload.push({ tagID: "SetTmuEnableStatus", value: command.value });
        break;
      case "hv-on":
        payload.push({ tagID: "SetCmsHvOn", value: 1 }, { tagID: "SetCmsHvOff", value: 0 });
        break;
      case "hv-off":
        payload.push({ tagID: "SetCmsHvOn", value: 0 }, { tagID: "SetCmsHvOff", value: 1 });
        break;
      case "reset-all":
        payload.push({ tagID: "ResetCms", value: 1 });
        break;
      case "cluster-hv-off":
        payload.push(
          { tagID: `Bms${command.cluster}HvOn`, value: 0 },
          { tagID: `Bms${command.cluster}HvOff`, value: 1 }
        );
        break;
      case "cluster-reset":
        payload.push({ tagID: `Bms${command.cluster}Reset`, value: 1 });
        break;
    }
  }

  return payload.length > 0 ? [{ topic: options.topic ?? "CMS", payload }] : [];
}

function clustersSelfChecked(telemetry: Espire290CmsTelemetry, enabledMask: number): boolean {
  const clusters = telemetry.clusters ?? [];
  for (let index = 0; index < 16; index += 1) {
    if (!hasBit(enabledMask, index)) continue;
    const selfCheck = clusters[index]?.bmsSelfCheck;
    // Unknown = trust the CMS (it refuses HV-on itself if not ready).
    if (selfCheck != null && selfCheck !== 1) return false;
  }
  return true;
}

function popcount(mask: number): number {
  let count = 0;
  for (let m = mask & 0xffff; m; m &= m - 1) count += 1;
  return count;
}

function toWord(value: number | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric & 0xffff : 0;
}
