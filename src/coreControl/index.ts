import { SiteConfig } from "../config";
import { SiteCapabilities } from "../capabilities";
import { ScheduleOutput } from "../scheduler";
import type { ControlEnvelope } from "../writer/writer";
import {
  buildUnifiedControlDesign,
  type UnifiedControlDesign,
} from "./design";
import {
  buildUnifiedControlRoutePlan,
  type UnifiedControlRoutePlan,
} from "./routes";
import {
  evaluateMeteringCalculations,
  type MeteringCalculationDiagnostic,
  type MeteringTelemetryInput,
} from "./meteringCalculations";
import {
  evaluateSignalMapping,
  type SignalMappingDiagnostic,
} from "./signalMapping";

export {
  assertUnifiedControlDesignCoverage,
  buildUnifiedControlDesign,
} from "./design";
export { buildUnifiedControlRoutePlan } from "./routes";
export {
  normalizeSel751Protection,
  normalizeSelHoldingRegisterProtection,
  type NormalizedProtectionTelemetry,
  type Sel751ProtectionInput,
  type SelHoldingRegisterProtectionInput,
} from "./protectionAdapters";
export {
  evaluateMeteringCalculations,
  type MeteringCalculationDiagnostic,
  type MeteringCalculationResult,
  type MeteringTelemetryInput,
  type TelemetrySampleLike,
} from "./meteringCalculations";
export {
  evaluateSignalMapping,
  type SignalMappingDiagnostic,
  type SignalMappingResult,
} from "./signalMapping";
export {
  evaluateGeneratorSequencer,
  generatorCommandsToWriterEnvelopes,
  type GeneratorSequencerCommand,
  type GeneratorSequencerMode,
  type GeneratorSequencerOptions,
  type GeneratorSequencerResult,
  type GeneratorSequencerState,
  type GeneratorSequencerTelemetry,
  type GeneratorWriterOptions,
} from "./generatorSequencer";
export {
  evaluateESpire280IslandingSequencer,
  islandingCommandsToWriterEnvelopes,
  type IslandingSequencerCommand,
  type IslandingSequencerMode,
  type IslandingSequencerOptions,
  type IslandingSequencerResult,
  type IslandingSequencerState,
  type IslandingSequencerTelemetry,
  type IslandingWriterOptions,
} from "./islandingSequencer";
export {
  classifyMiniFaults,
  evaluateMiniFaultRecovery,
  miniFaultRecoveryCommandsToWriterEnvelopes,
  type MiniFaultClassification,
  type MiniFaultRecoveryCommand,
  type MiniFaultRecoveryMode,
  type MiniFaultRecoveryOptions,
  type MiniFaultRecoveryResult,
  type MiniFaultRecoveryState,
  type MiniFaultRecoveryWriterOptions,
  type MiniFaultTelemetry,
} from "./miniFaultRecovery";
export {
  classifyEspire314Faults,
  evaluateEspire314FaultRecovery,
  espire314FaultRecoveryCommandsToWriterEnvelopes,
  type Espire314FaultClassification,
  type Espire314FaultRecoveryCommand,
  type Espire314FaultRecoveryMode,
  type Espire314FaultRecoveryOptions,
  type Espire314FaultRecoveryResult,
  type Espire314FaultRecoveryState,
  type Espire314FaultRecoveryWriterOptions,
  type Espire314FaultTelemetry,
} from "./espire314FaultRecovery";
export {
  evaluateMiniStandaloneSequencer,
  miniStandaloneCommandsToWriterEnvelopes,
  type MiniStandaloneCommand,
  type MiniStandaloneMode,
  type MiniStandaloneOptions,
  type MiniStandaloneResult,
  type MiniStandaloneState,
  type MiniStandaloneTelemetry,
  type MiniStandaloneWriterOptions,
} from "./miniStandaloneSequencer";
export type {
  ControlCommandDesign,
  ControlDesignRole,
  ControlProductLine,
  PcsLimitSource,
  ProtectionStrategy,
  ReadingSource,
  UnifiedControlDesign,
} from "./design";
export type {
  ControlProductPath,
  ControlRoute,
  ControlRouteId,
  UnifiedControlRoutePlan,
} from "./routes";

export type GridStatus = "normal" | "island" | "fault";
export type ProtectionState = "normal" | "islanded" | "fault" | "unavailable";
export type PcsRunMode = "grid-tie" | "off-grid";

export interface ESpire280MachineStatus {
  batteryVoltageV?: number;
  maxChargeCurrentAllowedA?: number;
  maxDischargeCurrentAllowedA?: number;
  maxCellVoltageV?: number;
  minCellVoltageV?: number;
  maxCellTemperatureC?: number;
  minCellTemperatureC?: number;
  bmsStatus?: number;
  pcsGlobalState?: number;
  epoActive?: boolean;
  contactorsClosed?: boolean;
  miniFaulted?: boolean;
  miniFaultReasons?: string[];
  actualBatteryPowerKw?: number;
  onOffGridSwitch?: number;
  gridAvailable?: boolean;
}

export interface TelemetrySnapshot {
  soc: number;
  gridStatus: GridStatus;

  // Sign convention: +utility = site importing from grid, -utility = exporting.
  utilityPowerKw?: number;
  siteLoadKw?: number;
  pvKw?: number;
  pcsActivePowerKw?: number;

  generatorRunning?: boolean;
  generatorAvailable?: boolean;

  protectionState?: ProtectionState;
  pcsRunAllowed?: boolean;
  remoteInterlockClosed?: boolean;

  allowCharge?: boolean;
  allowDischarge?: boolean;
  machineStatus?: ESpire280MachineStatus;

  // Sign convention: +PCS = discharge to AC bus, -PCS = charge battery.
  realtimeActivePowerKwRequest?: number;
  realtimeReactivePowerKvarRequest?: number;
}

export interface CoreControlCommand {
  controlMode: "idle" | "realtime" | "scheduled";
  pcsActivePowerKw: number;
  pcsReactivePowerKvar?: number;
  generatorStart?: boolean;
  generatorStop?: boolean;
  generatorChargeKwLimit?: number;
  pvCurtailmentKw?: number;
  pvActivePowerLimitPct?: number;
  frequencyShiftRequested?: boolean;
  pcsRunMode?: PcsRunMode;
  gridWireConnection?: boolean;
  pcsActivePowerSetpointEnabled?: boolean;
  maxChargeCurrentA?: number;
  maxDischargeCurrentA?: number;
  batteryActivePowerKw?: number;
  predictedUtilityPowerKw?: number;
  reasons: string[];
}

export interface CoreControlState {
  baseMemKw?: number;
  previousPcsActivePowerKw?: number;
  socState?: {
    allowCharge: boolean;
    allowDischarge: boolean;
  };
  vcellChargeBlocked?: boolean;
  miniCellVoltageChargeBlocked?: boolean;
  miniCellVoltageDischargeBlocked?: boolean;
  pvControl?: {
    lastUpdateMs: number;
    fleetPct: number;
  };
  solarEdgeState?: Record<
    string,
    {
      lastWriteMs?: number;
      lastPct?: number;
    }
  >;
  miniSelfConsumptionCorrectionKw?: number;
}

export type ControlPipelineStageId =
  | "product-routing"
  | "safety-gates"
  | "metering"
  | "dispatch-source"
  | "crd"
  | "soc-policy"
  | "availability"
  | "pcs-limits"
  | "protection"
  | "generator"
  | "pv-curtailment"
  | "writer";

export type ControlPipelineStageStatus =
  | "active"
  | "skipped"
  | "warning"
  | "blocked";

export interface ControlPipelineStage {
  id: ControlPipelineStageId;
  title: string;
  status: ControlPipelineStageStatus;
  reasons: string[];
}

export interface ControlPipelineResult {
  stages: ControlPipelineStage[];
  activeStageIds: ControlPipelineStageId[];
  warnings: string[];
  blocked: boolean;
}

export interface CoreControlContext {
  config: SiteConfig;
  caps: SiteCapabilities;
  design: UnifiedControlDesign;
  enforceTelemetryRequirements?: boolean;
  state?: CoreControlState;
  nowMs?: number;
}

export interface UnifiedControlCycleInput {
  telemetry: MeteringTelemetryInput;
  baseTelemetry: Pick<TelemetrySnapshot, "soc" | "gridStatus"> &
    Partial<TelemetrySnapshot>;
  schedule?: ScheduleOutput;
  state?: CoreControlState;
  nowMs?: number;
}

export interface UnifiedControlCycleDiagnostics {
  metering: MeteringCalculationDiagnostic[];
  signalMapping: SignalMappingDiagnostic[];
}

export interface UnifiedControlCycleResult {
  design: UnifiedControlDesign;
  routePlan: UnifiedControlRoutePlan;
  pipeline: ControlPipelineResult;
  telemetry: TelemetrySnapshot;
  command: CoreControlCommand;
  writerEnvelopes: ControlEnvelope[];
  diagnostics: UnifiedControlCycleDiagnostics;
}

export function initCoreControl(config: SiteConfig) {
  const design = buildUnifiedControlDesign(config);
  const state: CoreControlState = {};
  const ctx: CoreControlContext = {
    config,
    caps: design.capabilities,
    design,
    state,
  };

  return {
    evaluate(
      telemetry: TelemetrySnapshot,
      schedule: ScheduleOutput = {}
    ): CoreControlCommand {
      ctx.nowMs = Date.now();
      return evaluateCoreControl(ctx, telemetry, schedule);
    },
    state,
  };
}

export function runUnifiedControlCycle(
  config: SiteConfig,
  input: UnifiedControlCycleInput
): UnifiedControlCycleResult {
  const design = buildUnifiedControlDesign(config);
  const routePlan = buildUnifiedControlRoutePlan(design);
  const signalMapping = evaluateSignalMapping(
    config.signalMapping,
    input.telemetry
  );
  const signalMeteringReadings = pickSignalMeteringReadings(
    signalMapping.signals
  );
  const telemetryForMetering = mergeTelemetryInput(
    input.telemetry,
    signalMapping.signals
  );
  const metering = evaluateMeteringCalculations(
    config.metering.calculations,
    telemetryForMetering
  );
  const meteringDiagnostics = metering.diagnostics.filter(
    (diagnostic) =>
      !Object.prototype.hasOwnProperty.call(
        signalMeteringReadings,
        diagnostic.reading
      )
  );
  const measuredPcsActivePowerKw =
    input.baseTelemetry.pcsActivePowerKw ??
    numericSignal(signalMapping.signals.pcsPowerKw) ??
    numericSignal(signalMapping.signals.pcsActivePowerKw) ??
    readTelemetryNumber(
      input.telemetry,
      "PCS.SYSTEM_POWER_ACTIVE_ALL",
      "PCS.ACBusTotalActivePower",
      "SYSTEM_POWER_ACTIVE_ALL",
      "ACBusTotalActivePower",
      "Meter.BESS_Total_Power",
      "BESS_KW"
    );
  const generatorRunning =
    input.baseTelemetry.generatorRunning ??
    booleanSignal(signalMapping.signals.generatorRunning);
  const telemetry: TelemetrySnapshot = {
    ...input.baseTelemetry,
    ...(measuredPcsActivePowerKw != null
      ? { pcsActivePowerKw: measuredPcsActivePowerKw }
      : {}),
    ...(generatorRunning != null ? { generatorRunning } : {}),
    ...signalMeteringReadings,
    ...metering.readings,
  };
  const command = evaluateCoreControl(
    {
      config,
      caps: design.capabilities,
      design,
      enforceTelemetryRequirements: true,
      state: input.state,
      nowMs: input.nowMs,
    },
    telemetry,
    input.schedule || {}
  );

  return {
    design,
    routePlan,
    pipeline: buildControlPipelineResult(
      design,
      routePlan,
      telemetry,
      command,
      meteringDiagnostics
    ),
    telemetry,
    command,
    writerEnvelopes: buildCoreWriterEnvelopes(config, command, {
      state: input.state,
      nowMs: input.nowMs,
    }),
    diagnostics: {
      metering: meteringDiagnostics,
      signalMapping: signalMapping.diagnostics,
    },
  };
}

function pickSignalMeteringReadings(
  signals: Partial<Record<string, unknown>>
): Partial<Pick<TelemetrySnapshot, "utilityPowerKw" | "siteLoadKw" | "pvKw">> {
  const readings: Partial<
    Pick<TelemetrySnapshot, "utilityPowerKw" | "siteLoadKw" | "pvKw">
  > = {};

  const canonicalToInternal = {
    utilityPowerKw: ["gridPowerKw", "utilityPowerKw"],
    siteLoadKw: ["loadPowerKw", "siteLoadKw"],
    pvKw: ["pvPowerKw", "pvKw"],
  } as const;

  for (const key of ["utilityPowerKw", "siteLoadKw", "pvKw"] as const) {
    const value = firstNumericSignal(signals, canonicalToInternal[key]);
    if (value != null) {
      readings[key] = value;
    }
  }

  return readings;
}

function firstNumericSignal(
  signals: Partial<Record<string, unknown>>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = numericSignal(signals[key]);
    if (value != null) return value;
  }
  return undefined;
}

function mergeTelemetryInput(
  telemetry: MeteringTelemetryInput,
  signals: Partial<Record<string, unknown>>
): MeteringTelemetryInput {
  return {
    ...(telemetry as Record<string, unknown>),
    ...signals,
  };
}

function numericSignal(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function booleanSignal(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value == null) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric !== 0 : undefined;
}

function buildControlPipelineResult(
  design: UnifiedControlDesign,
  routePlan: UnifiedControlRoutePlan,
  telemetry: TelemetrySnapshot,
  command: CoreControlCommand,
  meteringDiagnostics: MeteringCalculationDiagnostic[]
): ControlPipelineResult {
  const warnings: string[] = [];
  const stages: ControlPipelineStage[] = [];
  const requiredTelemetryWarnings = getMissingRequiredTelemetryWarnings(
    design,
    telemetry
  );

  warnings.push(...requiredTelemetryWarnings);

  stages.push(
    stage(
      "product-routing",
      "Product routing",
      command.reasons.includes("unsupported-product")
        ? "blocked"
        : routePlan.productPath === "unsupported"
          ? "blocked"
          : "active",
      [`${routePlan.productPath} path selected`]
    )
  );

  const safetyReasons = command.reasons.filter(isSafetyGateReason);
  stages.push(
    stage(
      "safety-gates",
      "Safety gates",
      safetyReasons.length > 0 ? "blocked" : "skipped",
      safetyReasons.length > 0
        ? safetyReasons
        : ["no hard safety gate active"]
    )
  );

  const relevantMeteringDiagnostics = meteringDiagnostics.filter(
    (diagnostic) =>
      diagnostic.status !== "missing-config" ||
      design.metering.calculatedReadings.includes(diagnostic.reading) ||
      isTelemetryReadingRequired(design, diagnostic.reading)
  );
  stages.push(
    stage(
      "metering",
      "Metering normalization",
      relevantMeteringDiagnostics.length > 0 ||
        requiredTelemetryWarnings.length > 0
        ? "warning"
        : routePlan.activeRouteIds.includes("metering")
          ? "active"
          : "skipped",
      [
        ...design.metering.calculatedReadings.map(
          (reading) => `${reading} calculated`
        ),
        ...relevantMeteringDiagnostics.map(
          (diagnostic) => `${diagnostic.reading}: ${diagnostic.status}`
        ),
        ...requiredTelemetryWarnings,
      ]
    )
  );

  stages.push(
    stage(
      "dispatch-source",
      "Dispatch source",
      command.controlMode === "idle" ? "skipped" : "active",
      command.controlMode === "idle"
        ? ["no scheduled or realtime setpoint"]
        : [`${command.controlMode} dispatch selected`]
    )
  );

  stages.push(
    stage(
      "crd",
      "CRD policy",
      command.reasons.some((reason) => reason.startsWith("crd-"))
        ? "active"
        : routePlan.activeRouteIds.includes("crd")
          ? "skipped"
          : "skipped",
      routePlan.activeRouteIds.includes("crd")
        ? [`${design.policies.crdMode} configured`]
        : ["CRD is not active for this configuration"]
    )
  );

  stages.push(
    stage(
      "soc-policy",
      "SOC policy",
      command.reasons.includes("battery-min-soc") ||
        command.reasons.includes("battery-max-soc")
        ? "active"
        : routePlan.activeRouteIds.includes("soc-policy")
          ? "skipped"
          : "skipped",
      [`SOC window ${design.policies.soc.min}-${design.policies.soc.max}`]
    )
  );

  stages.push(
    stage(
      "availability",
      "Availability gates",
      getAvailabilityStatus(command.reasons),
      getAvailabilityReasons(command.reasons)
    )
  );

  stages.push(
    stage(
      "pcs-limits",
      "PCS limits",
      command.reasons.includes("pcs-limit-clamp") ? "active" : "skipped",
      [
        `charge ${design.limits.pcs.maxChargeKw} kW`,
        `discharge ${design.limits.pcs.maxDischargeKw} kW`,
      ]
    )
  );

  const protectionReasons = command.reasons.filter(isProtectionReason);
  stages.push(
    stage(
      "protection",
      "Protection integration",
      protectionReasons.length > 0
        ? "blocked"
        : routePlan.activeRouteIds.includes("protection")
          ? "active"
          : "skipped",
      protectionReasons.length > 0
        ? protectionReasons
        : routePlan.activeRouteIds.includes("protection")
          ? [`${design.protection.strategy} protection route configured`]
          : ["protection route disabled"]
    )
  );

  stages.push(
    stage(
      "generator",
      "Generator policy",
      command.reasons.some((reason) => reason.startsWith("generator-"))
        ? "active"
        : routePlan.activeRouteIds.includes("generator")
          ? "skipped"
          : "skipped",
      routePlan.activeRouteIds.includes("generator")
        ? [`${design.routing.generator} generator route configured`]
        : ["generator route disabled"]
    )
  );

  stages.push(
    stage(
      "pv-curtailment",
      "PV curtailment",
      command.reasons.some((reason) => reason.startsWith("pv-curtailment-"))
        ? "active"
        : routePlan.activeRouteIds.includes("pv-curtailment")
          ? "skipped"
          : "skipped",
      routePlan.activeRouteIds.includes("pv-curtailment")
        ? [`${design.routing.pvCurtailment} curtailment configured`]
        : ["PV curtailment route disabled"]
    )
  );

  stages.push(
    stage(
      "writer",
      "Writer routing",
      routePlan.activeRouteIds.includes("writer-pcs") ? "active" : "skipped",
      routePlan.activeRouteIds.includes("writer-pcs")
        ? ["PCS writer envelope enabled"]
        : ["PCS writer route disabled"]
    )
  );

  return {
    stages,
    activeStageIds: stages
      .filter((candidate) => candidate.status === "active")
      .map((candidate) => candidate.id),
    warnings,
    blocked: stages.some((candidate) => candidate.status === "blocked"),
  };
}

function stage(
  id: ControlPipelineStageId,
  title: string,
  status: ControlPipelineStageStatus,
  reasons: string[]
): ControlPipelineStage {
  return {
    id,
    title,
    status,
    reasons: reasons.filter((reason) => reason.length > 0),
  };
}

function getMissingRequiredTelemetryWarnings(
  design: UnifiedControlDesign,
  telemetry: TelemetrySnapshot
): string[] {
  const required = design.telemetryRequirements;
  const warnings: string[] = [];

  if (required.utilityPowerKw && telemetry.utilityPowerKw == null) {
    warnings.push("utilityPowerKw is required but unavailable");
  }
  if (required.siteLoadKw && telemetry.siteLoadKw == null) {
    warnings.push("siteLoadKw is required but unavailable");
  }
  if (required.pvKw && telemetry.pvKw == null) {
    warnings.push("pvKw is required but unavailable");
  }
  if (required.generatorState && telemetry.generatorRunning == null) {
    warnings.push("generatorRunning is required but unavailable");
  }
  if (required.protectionState && telemetry.protectionState == null) {
    warnings.push("protectionState is required but unavailable");
  }

  return warnings;
}

function isTelemetryReadingRequired(
  design: UnifiedControlDesign,
  reading: MeteringCalculationDiagnostic["reading"]
): boolean {
  return design.telemetryRequirements[reading];
}

function isSafetyGateReason(reason: string): boolean {
  return (
    reason === "unsupported-product" ||
    reason === "invalid-soc" ||
    reason === "invalid-grid-status" ||
    reason === "grid-fault" ||
    reason === "e280-bms-not-normal" ||
    reason === "e280-pcs-faulted" ||
    reason === "e280-epo-active" ||
    reason === "e280-contactors-open" ||
    reason === "mini-faulted" ||
    reason === "crd-missing-utility-power" ||
    reason === "pcs-dispatch-unavailable" ||
    isProtectionReason(reason)
  );
}

function isProtectionReason(reason: string): boolean {
  return (
    reason === "protection-state-missing" ||
    reason === "protection-fault" ||
    reason === "protection-unavailable" ||
    reason === "pcs-run-not-allowed" ||
    reason === "remote-interlock-open"
  );
}

export function evaluateCoreControl(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  schedule: ScheduleOutput = {}
): CoreControlCommand {
  const reasons: string[] = [];
  const safetyGateReasons = evaluateSafetyGates(ctx, telemetry);
  if (safetyGateReasons.length > 0) {
    reasons.push(...safetyGateReasons);
    const command = createSafeZeroCommand(reasons);
    applyPvCurtailmentPolicy(ctx, telemetry, command);
    if (telemetry.utilityPowerKw != null) {
      command.predictedUtilityPowerKw = predictUtilityPowerKw(
        telemetry,
        command.pcsActivePowerKw
      );
    }
    return command;
  }

  const requestedActive = resolveRequestedActivePowerKw(
    ctx,
    telemetry,
    schedule,
    reasons
  );
  const requestedReactive = resolveRequestedReactivePowerKvar(
    ctx,
    telemetry,
    schedule
  );

  let batteryActivePowerKw = requestedActive.targetKw;

  batteryActivePowerKw = applySharedBatteryPolicy(
    ctx,
    telemetry,
    batteryActivePowerKw,
    reasons
  );
  batteryActivePowerKw = applySocPolicy(ctx, telemetry, batteryActivePowerKw, reasons);
  batteryActivePowerKw = applyESpire280MachineAvailabilityPolicy(
    ctx,
    telemetry,
    batteryActivePowerKw,
    reasons
  );
  batteryActivePowerKw = applyAvailabilityPolicy(
    telemetry,
    batteryActivePowerKw,
    reasons
  );
  batteryActivePowerKw = applyPcsLimits(ctx, batteryActivePowerKw, reasons);
  batteryActivePowerKw = applyBatteryCommandRamp(ctx, batteryActivePowerKw, reasons);

  const isMini = ctx.design.productLine === "Mini";
  if (isMini && telemetry.gridStatus === "normal") {
    batteryActivePowerKw = applyCrdPolicy(
      ctx,
      telemetry,
      batteryActivePowerKw,
      reasons
    );
    batteryActivePowerKw = applySharedBatteryPolicy(
      ctx,
      telemetry,
      batteryActivePowerKw,
      reasons
    );
    batteryActivePowerKw = applySocPolicy(ctx, telemetry, batteryActivePowerKw, reasons);
    batteryActivePowerKw = applyAvailabilityPolicy(
      telemetry,
      batteryActivePowerKw,
      reasons
    );
    batteryActivePowerKw = applyPcsLimits(ctx, batteryActivePowerKw, reasons);
  }

  const miniDispatch = resolveMiniDispatch(ctx, telemetry, batteryActivePowerKw, reasons);
  let pcsActivePowerKw = miniDispatch
    ? miniDispatch.pcsActivePowerKw
    : batteryActivePowerKw;

  if (!isMini && miniDispatch?.pcsActivePowerSetpointEnabled !== false) {
    pcsActivePowerKw = applyCrdPolicy(ctx, telemetry, pcsActivePowerKw, reasons);
    if (miniDispatch) {
      pcsActivePowerKw = applyPcsLimits(ctx, pcsActivePowerKw, reasons);
    }
  }

  const command: CoreControlCommand = {
    controlMode: requestedActive.mode,
    pcsActivePowerKw,
    reasons,
  };

  if (miniDispatch) {
    command.batteryActivePowerKw = batteryActivePowerKw;
    command.pcsActivePowerSetpointEnabled =
      miniDispatch.pcsActivePowerSetpointEnabled;
    command.maxChargeCurrentA = miniDispatch.maxChargeCurrentA;
    command.maxDischargeCurrentA = miniDispatch.maxDischargeCurrentA;
  }

  if (requestedReactive != null) {
    command.pcsReactivePowerKvar = requestedReactive;
  }

  applyPcsRunModePolicy(ctx, telemetry, command);
  applyGeneratorPolicy(ctx, telemetry, command);
  applyPvCurtailmentPolicy(ctx, telemetry, command);

  if (telemetry.utilityPowerKw != null) {
    command.predictedUtilityPowerKw = predictUtilityPowerKw(
      telemetry,
      command.pcsActivePowerKw
    );
  }

  return command;
}

function evaluateSafetyGates(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot
): string[] {
  const reasons: string[] = [];

  if (ctx.design.productLine === "unknown") {
    reasons.push("unsupported-product");
  }

  if (!Number.isFinite(Number(telemetry.soc))) {
    reasons.push("invalid-soc");
  }

  if (
    telemetry.gridStatus !== "normal" &&
    telemetry.gridStatus !== "island" &&
    telemetry.gridStatus !== "fault"
  ) {
    reasons.push("invalid-grid-status");
  }

  if (telemetry.gridStatus === "fault") {
    reasons.push("grid-fault");
  }

  applyESpire280MachineSafetyGates(ctx, telemetry, reasons);
  applyMiniMachineSafetyGates(ctx, telemetry, reasons);

  if (
    ctx.design.routing.pcsDispatch === "none" ||
    ctx.design.limits.pcs.source === "disabled"
  ) {
    reasons.push("pcs-dispatch-unavailable");
  }

  if (
    ctx.enforceTelemetryRequirements &&
    ctx.config.operation.crdMode !== "no-restriction" &&
    ctx.design.metering.sources.utilityPowerKw !== "not-configured" &&
    telemetry.utilityPowerKw == null
  ) {
    reasons.push("crd-missing-utility-power");
  }

  applyProtectionSafetyGates(ctx, telemetry, reasons);

  return reasons;
}

function applyESpire280MachineSafetyGates(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  reasons: string[]
) {
  if (ctx.design.productLine !== "280") return;
  const machine = telemetry.machineStatus;
  if (!machine) return;

  if (machine.bmsStatus != null && machine.bmsStatus !== 1) {
    reasons.push("e280-bms-not-normal");
  }
  if (machine.pcsGlobalState === 7) {
    reasons.push("e280-pcs-faulted");
  }
  if (machine.epoActive === true) {
    reasons.push("e280-epo-active");
  }
  if (machine.contactorsClosed === false) {
    reasons.push("e280-contactors-open");
  }
}

function applyMiniMachineSafetyGates(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  reasons: string[]
) {
  if (ctx.design.productLine !== "Mini") return;
  const machine = telemetry.machineStatus;
  if (!machine) return;

  if (machine.miniFaulted === true) {
    reasons.push("mini-faulted");
    if (machine.miniFaultReasons) {
      reasons.push(...machine.miniFaultReasons);
    }
  }
}

function applyProtectionSafetyGates(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  reasons: string[]
) {
  if (ctx.design.protection.strategy === "none") return;

  if (ctx.enforceTelemetryRequirements && telemetry.protectionState == null) {
    reasons.push("protection-state-missing");
    return;
  }

  if (telemetry.protectionState === "fault") {
    reasons.push("protection-fault");
  }

  if (telemetry.protectionState === "unavailable") {
    reasons.push("protection-unavailable");
  }

  if (
    ctx.design.protection.controlsPcsRunMode &&
    telemetry.pcsRunAllowed === false
  ) {
    reasons.push("pcs-run-not-allowed");
  }

  if (
    ctx.design.protection.controlsRemoteInterlock &&
    telemetry.remoteInterlockClosed === false
  ) {
    reasons.push("remote-interlock-open");
  }
}

function createSafeZeroCommand(reasons: string[]): CoreControlCommand {
  return {
    controlMode: "idle",
    pcsActivePowerKw: 0,
    reasons: ["safe-zero", ...reasons],
  };
}

function buildCoreWriterEnvelopes(
  config: SiteConfig,
  command: CoreControlCommand,
  options: { state?: CoreControlState; nowMs?: number } = {}
): ControlEnvelope[] {
  const pcsPayload =
    config.system.systemProfile.startsWith("MINI-")
      ? buildMiniPcsPayload(command)
      : buildESpire280PcsPayload(command);

  const envelopes: ControlEnvelope[] =
    pcsPayload.length > 0
      ? [
          {
            topic: "PCS",
            payload: pcsPayload,
          },
        ]
      : [];

  if (
    config.pv.curtailmentMethod === "modbus" &&
    config.pv.acInverters.length > 0 &&
    (command.pvActivePowerLimitPct != null ||
      config.operation.siteExportMode === "no-export")
  ) {
    // SolarEdge requires the dynamic active power limit to be refreshed
    // continuously while site-level no-export is active, even if unchanged.
    const pvLimitPct = command.pvActivePowerLimitPct ?? 1;
    const nowMs = options.nowMs ?? Date.now();
    const seState = options.state?.solarEdgeState || {};
    for (let index = 0; index < config.pv.acInverters.length; index++) {
      const inverter = config.pv.acInverters[index];
      const topic =
        inverter.id || `${inverter.type || "PV"}${index + 1}`;
      if (
        options.state &&
        !shouldWriteSolarEdgeLimit(seState[topic], pvLimitPct, nowMs)
      ) {
        continue;
      }
      if (options.state) {
        seState[topic] = { lastWriteMs: nowMs, lastPct: pvLimitPct };
        options.state.solarEdgeState = seState;
      }
      envelopes.push({
        topic,
        payload: [
          {
            tagID: `${topic}.Dynamic_Active_Power_Limit`,
            value: pvLimitPct,
          },
        ],
      });
    }
  }

  return envelopes;
}

function buildESpire280PcsPayload(
  command: CoreControlCommand
): ControlEnvelope["payload"] {
  const pcsPayload: ControlEnvelope["payload"] = [
    {
      tagID: "SYSTEM_ACTIVE_POWER_DEMAND",
      value: command.pcsActivePowerKw,
    },
  ];

  if (command.pcsReactivePowerKvar != null) {
    pcsPayload.push({
      tagID: "SYSTEM_REACTIVE_POWER_DEMAND",
      value: command.pcsReactivePowerKvar,
    });
  }

  if (command.pcsRunMode != null) {
    pcsPayload.push({
      tagID: "SYSTEM_RUN_MODE",
      value: command.pcsRunMode === "off-grid" ? 1 : 0,
    });
  }

  if (command.gridWireConnection != null) {
    pcsPayload.push({
      tagID: "GRID_WIRE_CONNECTION",
      value: command.gridWireConnection ? 1 : 0,
    });
  }

  return pcsPayload;
}

function buildMiniPcsPayload(
  command: CoreControlCommand
): ControlEnvelope["payload"] {
  const pcsPayload: ControlEnvelope["payload"] = [];

  if (command.pcsActivePowerSetpointEnabled !== false) {
    pcsPayload.push({
      tagID: "ActivePowerSetpoint",
      value:
        command.pcsActivePowerKw === 0 ? 0 : -command.pcsActivePowerKw,
    });
  }

  if (command.maxChargeCurrentA != null) {
    pcsPayload.push({
      tagID: "MaxChgCurrent",
      value: command.maxChargeCurrentA,
    });
  }

  if (command.maxDischargeCurrentA != null) {
    pcsPayload.push({
      tagID: "MaxDsgCurrent",
      value: command.maxDischargeCurrentA,
    });
  }

  return pcsPayload;
}

function shouldWriteSolarEdgeLimit(
  state: { lastWriteMs?: number; lastPct?: number } | undefined,
  pct: number,
  nowMs: number
): boolean {
  const changed =
    state?.lastPct == null || Math.abs(pct - state.lastPct) >= 0.005;
  const keepalive =
    state?.lastWriteMs == null || nowMs - state.lastWriteMs >= 30_000;
  return pct === 0 || changed || keepalive;
}

function resolveRequestedActivePowerKw(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  schedule: ScheduleOutput,
  reasons: string[]
): { mode: CoreControlCommand["controlMode"]; targetKw: number } {
  const scheduledTarget = resolveScheduledActivePowerKw(
    ctx,
    telemetry,
    schedule,
    reasons
  );
  if (scheduledTarget != null) {
    return {
      mode: "scheduled",
      targetKw: scheduledTarget,
    };
  }

  if (ctx.config.operation.scheduledControlEnabled && schedule.activePlan) {
    reasons.push("scheduled-plan-no-dispatch");
  }

  if (telemetry.realtimeActivePowerKwRequest != null) {
    reasons.push("realtime-active-setpoint");
    return {
      mode: "realtime",
      targetKw: telemetry.realtimeActivePowerKwRequest,
    };
  }

  return {
    mode: "idle",
    targetKw: 0,
  };
}

function resolveScheduledActivePowerKw(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  schedule: ScheduleOutput,
  reasons: string[]
): number | undefined {
  if (!ctx.config.operation.scheduledControlEnabled) return undefined;

  if (
    schedule.activePowerKwSetpoint != null
  ) {
    reasons.push("scheduled-active-setpoint");
    return schedule.activePowerKwSetpoint;
  }

  const strategy = schedule.strategy;
  if (!strategy) return undefined;

  const meterRule = readStrategyObject(strategy, "meter_rule");
  if (meterRule) {
    return resolveScheduledMeterRuleKw(ctx, telemetry, meterRule, reasons);
  }

  const pvRule = readStrategyObject(strategy, "pv_rule");
  if (pvRule) {
    return resolveScheduledPvRuleKw(ctx, telemetry, pvRule, reasons);
  }

  return undefined;
}

function resolveScheduledMeterRuleKw(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  meterRule: Record<string, unknown>,
  reasons: string[]
): number | undefined {
  const utilityPowerKw = telemetry.utilityPowerKw;
  if (utilityPowerKw == null || !Number.isFinite(utilityPowerKw)) {
    reasons.push("scheduled-meter-rule-missing-utility");
    return undefined;
  }

  const dischargeThresholdKw = readRuleKw(
    readStrategyObject(meterRule, "discharge"),
    "net_load_threshold"
  );
  const chargeThresholdKw = readRuleKw(
    readStrategyObject(meterRule, "charge"),
    "net_load_threshold"
  );
  const fixedDischargeKw = readRuleKw(
    readStrategyObject(meterRule, "discharge"),
    "fixed_output"
  );
  const fixedChargeKw = readRuleKw(
    readStrategyObject(meterRule, "charge"),
    "fixed_output"
  );

  const minSoc = ctx.config.battery.minSoc;
  const maxSoc = ctx.config.battery.maxSoc;
  const allowCharge =
    telemetry.allowCharge !== false && telemetry.soc < maxSoc;
  const allowDischarge =
    telemetry.allowDischarge !== false && telemetry.soc > minSoc;

  if (fixedChargeKw != null && allowCharge) {
    reasons.push("scheduled-meter-rule-fixed-charge");
    return -Math.min(Math.abs(fixedChargeKw), ctx.design.limits.pcs.maxChargeKw);
  }

  if (fixedDischargeKw != null && allowDischarge) {
    reasons.push("scheduled-meter-rule-fixed-discharge");
    return Math.min(
      Math.abs(fixedDischargeKw),
      ctx.design.limits.pcs.maxDischargeKw
    );
  }

  const deadbandKw = readRuleKw(meterRule, "deadband_kw") ?? 0.5;
  const bessPowerKw = resolveMeasuredBatteryActivePowerKw(ctx, telemetry);
  const baselineUtilityKw = utilityPowerKw + bessPowerKw;
  const holdAtThreshold =
    readBooleanRule(meterRule, "hold_at_threshold") ?? true;

  if (
    dischargeThresholdKw != null &&
    utilityPowerKw > dischargeThresholdKw + deadbandKw
  ) {
    if (!allowDischarge) {
      reasons.push("scheduled-meter-rule-discharge-blocked");
      return 0;
    }

    reasons.push("scheduled-meter-rule-discharge");
    return Math.max(0, baselineUtilityKw - dischargeThresholdKw);
  }

  if (
    holdAtThreshold &&
    dischargeThresholdKw != null &&
    bessPowerKw > 0 &&
    baselineUtilityKw > dischargeThresholdKw + deadbandKw
  ) {
    if (!allowDischarge) {
      reasons.push("scheduled-meter-rule-discharge-blocked");
      return 0;
    }

    reasons.push("scheduled-meter-rule-discharge-hold");
    return Math.max(0, baselineUtilityKw - dischargeThresholdKw);
  }

  if (
    chargeThresholdKw != null &&
    utilityPowerKw < chargeThresholdKw - deadbandKw
  ) {
    if (!allowCharge) {
      reasons.push("scheduled-meter-rule-charge-blocked");
      return 0;
    }

    reasons.push("scheduled-meter-rule-charge");
    return Math.min(0, baselineUtilityKw - chargeThresholdKw);
  }

  if (
    holdAtThreshold &&
    chargeThresholdKw != null &&
    bessPowerKw < 0 &&
    baselineUtilityKw < chargeThresholdKw - deadbandKw
  ) {
    if (!allowCharge) {
      reasons.push("scheduled-meter-rule-charge-blocked");
      return 0;
    }

    reasons.push("scheduled-meter-rule-charge-hold");
    return Math.min(0, baselineUtilityKw - chargeThresholdKw);
  }

  reasons.push("scheduled-meter-rule-idle");
  return 0;
}

function resolveMeasuredBatteryActivePowerKw(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot
): number {
  const pcsActivePowerKw = Number.isFinite(telemetry.pcsActivePowerKw)
    ? telemetry.pcsActivePowerKw || 0
    : 0;
  if (!hasMiniDcPvConverter(ctx)) {
    return pcsActivePowerKw;
  }

  const dcPvKw = Number.isFinite(telemetry.pvKw) ? telemetry.pvKw || 0 : 0;
  return pcsActivePowerKw - dcPvKw;
}

function resolveScheduledPvRuleKw(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  pvRule: Record<string, unknown>,
  reasons: string[]
): number | undefined {
  const mode = String(
    pvRule.mode ?? pvRule.rule ?? pvRule.name ?? ""
  ).toLowerCase();
  if (mode !== "selfconsumption" && mode !== "self-consumption") {
    reasons.push("scheduled-pv-rule-unsupported");
    return undefined;
  }

  if (telemetry.utilityPowerKw == null || telemetry.pcsActivePowerKw == null) {
    reasons.push("scheduled-self-consumption-missing-base-readings");
    return undefined;
  }

  const targetImportKw = readRuleKw(pvRule, "target_import_kw") ?? 0.5;
  const deadbandKw = readRuleKw(pvRule, "deadband_kw") ?? 0.8;
  const baseAlpha = readRuleKw(pvRule, "base_alpha") ?? 0.15;
  const baseStickEpsKw = readRuleKw(pvRule, "base_stick_eps_kw") ?? 1;
  const baseInstantKw = telemetry.utilityPowerKw + telemetry.pcsActivePowerKw;
  let baseMemKw = finiteNumber(ctx.state?.baseMemKw);

  if (baseMemKw == null) {
    baseMemKw = baseInstantKw;
  }

  const delta = baseInstantKw - baseMemKw;
  if (Math.abs(delta) > baseStickEpsKw) {
    baseMemKw = baseMemKw + clamp(baseAlpha, 0, 1) * delta;
    reasons.push("scheduled-self-consumption-base-filter");
  }

  if (ctx.state) {
    ctx.state.baseMemKw = baseMemKw;
  }

  let targetKw = baseMemKw - targetImportKw;
  const errorNowKw = telemetry.utilityPowerKw - targetImportKw;
  if (Math.abs(errorNowKw) < deadbandKw) {
    const holdKw = finiteNumber(ctx.state?.previousPcsActivePowerKw);
    if (holdKw != null) {
      targetKw = holdKw;
      reasons.push("scheduled-self-consumption-deadband-hold");
    }
  }

  reasons.push("scheduled-self-consumption");
  return targetKw;
}

function readStrategyObject(
  source: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = source?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const nested = source?.strategy;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return readStrategyObject(nested as Record<string, unknown>, key);
  }
  return undefined;
}

function readRuleKw(
  source: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  if (!source) return undefined;
  const raw = source[key];
  if (raw == null) return undefined;
  const value =
    raw && typeof raw === "object" && "value" in raw
      ? (raw as { value?: unknown }).value
      : raw;
  const numeric =
    typeof value === "string"
      ? Number(value.replace(/[^0-9+-.]/g, "").trim())
      : Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) >= 1_000_000) {
    return undefined;
  }
  return numeric;
}

function readBooleanRule(
  source: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  if (!source || source[key] == null) return undefined;
  const raw = source[key];
  const value =
    raw && typeof raw === "object" && "value" in raw
      ? (raw as { value?: unknown }).value
      : raw;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function resolveRequestedReactivePowerKvar(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  schedule: ScheduleOutput
): number | undefined {
  if (
    ctx.config.operation.scheduledControlEnabled &&
    schedule.reactivePowerKvarSetpoint != null
  ) {
    return schedule.reactivePowerKvarSetpoint;
  }

  return telemetry.realtimeReactivePowerKvarRequest;
}

function applyPcsRunModePolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  command: CoreControlCommand
) {
  if (!ctx.design.protection.controlsPcsRunMode) return;
  const islandingDevice = ctx.config.islanding?.device;
  if (
    ctx.design.productLine === "280" &&
    (islandingDevice === "SEL751" || islandingDevice === "SEL851")
  ) {
    command.reasons.push("pcs-mode-owned-by-islanding-sequencer");
    return;
  }

  const offGridRequested =
    telemetry.protectionState === "islanded" ||
    telemetry.gridStatus === "island" ||
    ctx.config.operation.mode === "off-grid";

  command.pcsRunMode = offGridRequested ? "off-grid" : "grid-tie";
  command.gridWireConnection = offGridRequested;
  command.reasons.push(
    offGridRequested ? "pcs-mode-off-grid" : "pcs-mode-grid-tie"
  );
}

function readTelemetryNumber(
  telemetry: MeteringTelemetryInput,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = telemetry[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function applyCrdPolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  currentTargetKw: number,
  reasons: string[]
): number {
  const utilityPowerKw = telemetry.utilityPowerKw;
  if (utilityPowerKw == null) return currentTargetKw;

  switch (ctx.config.operation.crdMode) {
    case "no-import":
      if (utilityPowerKw > 0) {
        reasons.push("crd-no-import");
        return currentTargetKw + utilityPowerKw;
      }
      return currentTargetKw;

    case "no-export":
      if (utilityPowerKw < 0) {
        reasons.push("crd-no-export");
        return currentTargetKw + utilityPowerKw;
      }
      return currentTargetKw;

    case "no-exchange":
      if (utilityPowerKw !== 0) {
        reasons.push("crd-no-exchange");
      }
      return currentTargetKw + utilityPowerKw;

    default:
      return currentTargetKw;
  }
}

function predictUtilityPowerKw(
  telemetry: TelemetrySnapshot,
  targetPcsActivePowerKw: number
): number | undefined {
  if (telemetry.utilityPowerKw == null) return undefined;
  const measuredPcsActivePowerKw = Number.isFinite(telemetry.pcsActivePowerKw)
    ? telemetry.pcsActivePowerKw || 0
    : 0;
  return (
    telemetry.utilityPowerKw +
    measuredPcsActivePowerKw -
    targetPcsActivePowerKw
  );
}

function applySocPolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  currentTargetKw: number,
  reasons: string[]
): number {
  const {
    battery: { minSoc, maxSoc },
  } = ctx.config;

  if (telemetry.soc <= minSoc && currentTargetKw > 0) {
    reasons.push("battery-min-soc");
    return 0;
  }

  if (telemetry.soc >= maxSoc && currentTargetKw < 0) {
    reasons.push("battery-max-soc");
    return 0;
  }

  return currentTargetKw;
}

const DEFAULT_BATT_HEADROOM_KW = 2;
const DEFAULT_BATT_RAMP_KW_PER_S = 25;
const DEFAULT_SOC_LOW = 0.3;
const DEFAULT_SOC_HIGH = 0.95;
const DEFAULT_SOC_LOW_RECOVER = 0.22;
const DEFAULT_SOC_HIGH_RECOVER = 0.92;
const DEFAULT_FORCE_GRID_CHARGE_SOC = 0.15;
const DEFAULT_FORCE_GRID_CHARGE_VMIN = 2.95;
const DEFAULT_FORCE_GRID_CHARGE_KW = 10;
const SITE_NO_EXPORT_PV_UPDATE_MS = 8_000;
const SITE_NO_EXPORT_PV_MARGIN_KW = 1;
const SITE_NO_EXPORT_PV_RAMP_PCT = 0.1;
const SITE_NO_EXPORT_PV_PANIC_SOC = 0.948;
const SITE_NO_EXPORT_PV_PANIC_EXPORT_KW = -0.5;
const SITE_NO_EXPORT_PV_PANIC_RAMP_PCT = 0.3;
const SITE_NO_EXPORT_SOC_PREHIGH = 0.93;
const E280_VCELL_MAX_BLOCK_CHG_ON = 3.6;
const E280_VCELL_MAX_BLOCK_CHG_OFF = 3.35;
const E280_VCELL_MIN_BLOCK_DIS = 2.9;
const E280_VCELL_TAPER_START = 3.44;
const E280_VCELL_TAPER_END = E280_VCELL_MAX_BLOCK_CHG_ON;
const E280_VCELL_TAPER_MIN_FRAC = 0.08;
const MINI_CHARGE_MIN_TEMP_C = 0;
const MINI_DISCHARGE_MIN_TEMP_C = -15;
const MINI_BATTERY_MAX_TEMP_C = 55;
const MINI_VCELL_MAX_BLOCK_CHG_ON = 3.57;
const MINI_VCELL_MAX_BLOCK_CHG_OFF = 3.33;
const MINI_VCELL_MIN_BLOCK_DIS_ON = 2.92;
const MINI_VCELL_MIN_BLOCK_DIS_OFF = 3.2;

interface BatteryControlPolicy {
  socLow: number;
  socLowRecover: number;
  socHigh: number;
  socHighRecover: number;
  forceGridChargeSoc: number;
  forceGridChargeMinCellVoltageV: number;
  forceGridChargeKw: number;
  powerHeadroomKw: number;
  commandRampKwPerSec: number;
}

interface CellVoltageControlPolicy {
  maxCellVoltageChargeBlockV: number;
  maxCellVoltageChargeRecoverV: number;
  minCellVoltageDischargeBlockV: number;
  minCellVoltageDischargeRecoverV: number;
  chargeTaperStartV: number;
  chargeTaperEndV: number;
  chargeTaperMinFraction: number;
}

function resolveBatteryControlPolicy(ctx: CoreControlContext): BatteryControlPolicy {
  const battery = ctx.config.battery;
  return {
    socLow: finiteNumber(battery.socLow) ?? DEFAULT_SOC_LOW,
    socLowRecover: finiteNumber(battery.socLowRecover) ?? DEFAULT_SOC_LOW_RECOVER,
    socHigh: finiteNumber(battery.socHigh) ?? battery.maxSoc ?? DEFAULT_SOC_HIGH,
    socHighRecover:
      finiteNumber(battery.socHighRecover) ??
      Math.min(finiteNumber(battery.socHigh) ?? battery.maxSoc ?? DEFAULT_SOC_HIGH, DEFAULT_SOC_HIGH_RECOVER),
    forceGridChargeSoc:
      finiteNumber(battery.forceGridChargeSoc) ?? DEFAULT_FORCE_GRID_CHARGE_SOC,
    forceGridChargeMinCellVoltageV:
      finiteNumber(battery.forceGridChargeMinCellVoltageV) ??
      DEFAULT_FORCE_GRID_CHARGE_VMIN,
    forceGridChargeKw: finiteNumber(battery.forceGridChargeKw) ?? DEFAULT_FORCE_GRID_CHARGE_KW,
    powerHeadroomKw: finiteNumber(battery.powerHeadroomKw) ?? DEFAULT_BATT_HEADROOM_KW,
    commandRampKwPerSec:
      finiteNumber(battery.commandRampKwPerSec) ?? DEFAULT_BATT_RAMP_KW_PER_S,
  };
}

function resolveCellVoltagePolicy(ctx: CoreControlContext): CellVoltageControlPolicy {
  const override = ctx.config.battery.cellVoltagePolicy || {};
  const isMini = ctx.design.productLine === "Mini";
  const chargeBlockDefault = isMini
    ? MINI_VCELL_MAX_BLOCK_CHG_ON
    : E280_VCELL_MAX_BLOCK_CHG_ON;
  const dischargeBlockDefault = isMini
    ? MINI_VCELL_MIN_BLOCK_DIS_ON
    : E280_VCELL_MIN_BLOCK_DIS;

  return {
    maxCellVoltageChargeBlockV:
      finiteNumber(override.maxCellVoltageChargeBlockV) ??
      chargeBlockDefault,
    maxCellVoltageChargeRecoverV:
      finiteNumber(override.maxCellVoltageChargeRecoverV) ??
      (isMini ? MINI_VCELL_MAX_BLOCK_CHG_OFF : E280_VCELL_MAX_BLOCK_CHG_OFF),
    minCellVoltageDischargeBlockV:
      finiteNumber(override.minCellVoltageDischargeBlockV) ??
      dischargeBlockDefault,
    minCellVoltageDischargeRecoverV:
      finiteNumber(override.minCellVoltageDischargeRecoverV) ??
      (isMini ? MINI_VCELL_MIN_BLOCK_DIS_OFF : dischargeBlockDefault),
    chargeTaperStartV:
      finiteNumber(override.chargeTaperStartV) ?? E280_VCELL_TAPER_START,
    chargeTaperEndV:
      finiteNumber(override.chargeTaperEndV) ??
      finiteNumber(override.maxCellVoltageChargeBlockV) ??
      E280_VCELL_TAPER_END,
    chargeTaperMinFraction:
      finiteNumber(override.chargeTaperMinFraction) ??
      E280_VCELL_TAPER_MIN_FRAC,
  };
}

function applySharedBatteryPolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  currentTargetKw: number,
  reasons: string[]
): number {
  let targetKw = currentTargetKw;
  const machine = telemetry.machineStatus;
  const batteryPolicy = resolveBatteryControlPolicy(ctx);
  const cellVoltagePolicy = resolveCellVoltagePolicy(ctx);
  const socState = resolveSocHysteresisState(ctx, telemetry, reasons);
  const caps = machine
    ? resolveESpire280MachinePowerCaps(
        machine,
        batteryPolicy.powerHeadroomKw,
        cellVoltagePolicy
      )
    : {};
  const maxChargeKw =
    ctx.design.productLine === "Mini"
      ? ctx.design.limits.pcs.maxChargeKw
      : caps.maxChargeKw;
  const maxDischargeKw =
    ctx.design.productLine === "Mini"
      ? ctx.design.limits.pcs.maxDischargeKw
      : caps.maxDischargeKw;
  const vcellChargeBlocked = resolveVcellChargeBlock(ctx, machine, reasons);
  const vcellDischargeBlocked = resolveVcellDischargeBlock(
    ctx,
    machine,
    reasons
  );
  const minCellVoltageV = finiteNumber(machine?.minCellVoltageV);
  const forceGridCharge =
    telemetry.soc <= batteryPolicy.forceGridChargeSoc ||
    (minCellVoltageV != null &&
      minCellVoltageV < batteryPolicy.forceGridChargeMinCellVoltageV);

  if (forceGridCharge && maxChargeKw != null && maxChargeKw > 0) {
    if (!socState.allowCharge || vcellChargeBlocked) {
      reasons.push("force-grid-charge-blocked");
      return 0;
    }
    reasons.push("force-grid-charge");
    return -Math.min(maxChargeKw, batteryPolicy.forceGridChargeKw);
  }

  if (targetKw < 0) {
    if (!socState.allowCharge) {
      reasons.push("soc-high-charge-block");
      return 0;
    }
    if (vcellChargeBlocked) {
      if (ctx.design.productLine !== "Mini") {
        reasons.push("e280-cell-high-charge-block");
      }
      return 0;
    }
    if (ctx.design.productLine !== "Mini" && maxChargeKw != null) {
      const clamped = Math.max(targetKw, -maxChargeKw);
      if (clamped !== targetKw) {
        reasons.push("e280-charge-current-limit");
        targetKw = clamped;
      }
    }
  }

  if (targetKw > 0) {
    if (!socState.allowDischarge) {
      reasons.push("soc-low-discharge-block");
      return 0;
    }
    if (vcellDischargeBlocked) {
      return 0;
    }
    if (ctx.design.productLine !== "Mini" && maxDischargeKw != null) {
      const clamped = Math.min(targetKw, maxDischargeKw);
      if (clamped !== targetKw) {
        reasons.push("e280-discharge-current-limit");
        targetKw = clamped;
      }
    }
  }

  return targetKw;
}

function resolveSocHysteresisState(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  reasons: string[]
): { allowCharge: boolean; allowDischarge: boolean } {
  const state = ctx.state;
  const batteryPolicy = resolveBatteryControlPolicy(ctx);
  const socState = state?.socState
    ? { ...state.socState }
    : { allowCharge: true, allowDischarge: true };

  if (telemetry.soc >= batteryPolicy.socHigh) {
    socState.allowCharge = false;
  } else if (telemetry.soc <= batteryPolicy.socHighRecover) {
    socState.allowCharge = true;
  }

  if (telemetry.soc <= batteryPolicy.socLow) {
    socState.allowDischarge = false;
  } else if (telemetry.soc >= batteryPolicy.socLowRecover) {
    socState.allowDischarge = true;
  }

  if (telemetry.soc <= batteryPolicy.forceGridChargeSoc) {
    socState.allowDischarge = false;
  }

  if (state) {
    state.socState = socState;
  }

  if (!socState.allowCharge) reasons.push("soc-high-no-charge");
  if (!socState.allowDischarge) reasons.push("soc-low-no-discharge");

  return socState;
}

function resolveVcellChargeBlock(
  ctx: CoreControlContext,
  machine: ESpire280MachineStatus | undefined,
  reasons: string[]
): boolean {
  const maxCellVoltageV = finiteNumber(machine?.maxCellVoltageV);
  const cellVoltagePolicy = resolveCellVoltagePolicy(ctx);

  if (ctx.design.productLine === "Mini") {
    let blocked = ctx.state?.miniCellVoltageChargeBlocked ?? false;

    if (maxCellVoltageV == null) {
      blocked = true;
      reasons.push("mini-cell-voltage-max-missing");
    } else if (
      maxCellVoltageV >= cellVoltagePolicy.maxCellVoltageChargeBlockV
    ) {
      blocked = true;
    } else if (
      maxCellVoltageV <= cellVoltagePolicy.maxCellVoltageChargeRecoverV
    ) {
      blocked = false;
    }

    if (ctx.state) {
      ctx.state.miniCellVoltageChargeBlocked = blocked;
    }

    if (blocked) reasons.push("mini-cell-high-charge-block");
    return blocked;
  }

  let blocked = ctx.state?.vcellChargeBlocked ?? false;

  if (
    maxCellVoltageV != null &&
    maxCellVoltageV >= cellVoltagePolicy.maxCellVoltageChargeBlockV
  ) {
    blocked = true;
  } else if (
    maxCellVoltageV != null &&
    maxCellVoltageV <= cellVoltagePolicy.maxCellVoltageChargeRecoverV
  ) {
    blocked = false;
  }

  if (ctx.state) {
    ctx.state.vcellChargeBlocked = blocked;
  }

  if (blocked) reasons.push("vcell-high-no-charge");
  return blocked;
}

function resolveVcellDischargeBlock(
  ctx: CoreControlContext,
  machine: ESpire280MachineStatus | undefined,
  reasons: string[]
): boolean {
  const minCellVoltageV = finiteNumber(machine?.minCellVoltageV);
  const cellVoltagePolicy = resolveCellVoltagePolicy(ctx);

  if (ctx.design.productLine === "Mini") {
    let blocked = ctx.state?.miniCellVoltageDischargeBlocked ?? false;

    if (minCellVoltageV == null) {
      blocked = true;
      reasons.push("mini-cell-voltage-min-missing");
    } else if (
      minCellVoltageV <= cellVoltagePolicy.minCellVoltageDischargeBlockV
    ) {
      blocked = true;
    } else if (
      minCellVoltageV >= cellVoltagePolicy.minCellVoltageDischargeRecoverV
    ) {
      blocked = false;
    }

    if (ctx.state) {
      ctx.state.miniCellVoltageDischargeBlocked = blocked;
    }

    if (blocked) reasons.push("mini-cell-low-discharge-block");
    return blocked;
  }

  if (
    minCellVoltageV != null &&
    minCellVoltageV <= cellVoltagePolicy.minCellVoltageDischargeBlockV
  ) {
    reasons.push("e280-cell-low-discharge-block");
    return true;
  }

  return false;
}

function applyESpire280MachineAvailabilityPolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  currentTargetKw: number,
  reasons: string[]
): number {
  if (ctx.design.productLine !== "280") return currentTargetKw;
  const machine = telemetry.machineStatus;
  if (!machine) return currentTargetKw;

  let targetKw = currentTargetKw;
  const maxCellVoltageV = finiteNumber(machine.maxCellVoltageV);
  const minCellVoltageV = finiteNumber(machine.minCellVoltageV);

  if (
    targetKw > 0 &&
    minCellVoltageV != null &&
    minCellVoltageV <=
      resolveCellVoltagePolicy(ctx).minCellVoltageDischargeBlockV
  ) {
    reasons.push("e280-cell-low-discharge-block");
    targetKw = 0;
  }

  const caps = resolveESpire280MachinePowerCaps(
    machine,
    resolveBatteryControlPolicy(ctx).powerHeadroomKw,
    resolveCellVoltagePolicy(ctx)
  );
  if (targetKw < 0 && caps.maxChargeKw != null) {
    const clamped = Math.max(targetKw, -caps.maxChargeKw);
    if (clamped !== targetKw) {
      reasons.push("e280-charge-current-limit");
      targetKw = clamped;
    }
  }
  if (targetKw > 0 && caps.maxDischargeKw != null) {
    const clamped = Math.min(targetKw, caps.maxDischargeKw);
    if (clamped !== targetKw) {
      reasons.push("e280-discharge-current-limit");
      targetKw = clamped;
    }
  }

  return targetKw;
}

function resolveESpire280MachinePowerCaps(
  machine: ESpire280MachineStatus,
  powerHeadroomKw = DEFAULT_BATT_HEADROOM_KW,
  cellVoltagePolicy: CellVoltageControlPolicy = {
    maxCellVoltageChargeBlockV: E280_VCELL_MAX_BLOCK_CHG_ON,
    maxCellVoltageChargeRecoverV: E280_VCELL_MAX_BLOCK_CHG_OFF,
    minCellVoltageDischargeBlockV: E280_VCELL_MIN_BLOCK_DIS,
    minCellVoltageDischargeRecoverV: E280_VCELL_MIN_BLOCK_DIS,
    chargeTaperStartV: E280_VCELL_TAPER_START,
    chargeTaperEndV: E280_VCELL_TAPER_END,
    chargeTaperMinFraction: E280_VCELL_TAPER_MIN_FRAC,
  }
): {
  maxChargeKw?: number;
  maxDischargeKw?: number;
} {
  const batteryVoltageV = finiteNumber(machine.batteryVoltageV);
  if (batteryVoltageV == null) return {};

  const maxChargeCurrentAllowedA = finiteNumber(
    machine.maxChargeCurrentAllowedA
  );
  const maxDischargeCurrentAllowedA = finiteNumber(
    machine.maxDischargeCurrentAllowedA
  );
  const maxCellVoltageV = finiteNumber(machine.maxCellVoltageV);

  let maxChargeKw =
    maxChargeCurrentAllowedA == null
      ? undefined
      : Math.max(
          0,
          Math.abs(batteryVoltageV * maxChargeCurrentAllowedA) / 1000 -
            powerHeadroomKw
        );
  const maxDischargeKw =
    maxDischargeCurrentAllowedA == null
      ? undefined
      : Math.max(
          0,
          Math.abs(batteryVoltageV * maxDischargeCurrentAllowedA) / 1000 -
            powerHeadroomKw
        );

  if (
    maxChargeKw != null &&
    maxCellVoltageV != null &&
    maxCellVoltageV >= cellVoltagePolicy.chargeTaperStartV &&
    maxCellVoltageV < cellVoltagePolicy.chargeTaperEndV
  ) {
    const frac = clamp(
      (cellVoltagePolicy.chargeTaperEndV - maxCellVoltageV) /
        (cellVoltagePolicy.chargeTaperEndV -
          cellVoltagePolicy.chargeTaperStartV),
      0,
      1
    );
    const taperFrac =
      cellVoltagePolicy.chargeTaperMinFraction +
      (1 - cellVoltagePolicy.chargeTaperMinFraction) * frac;
    maxChargeKw *= taperFrac;
  }
  if (
    maxChargeKw != null &&
    maxCellVoltageV != null &&
    maxCellVoltageV >= cellVoltagePolicy.chargeTaperEndV
  ) {
    maxChargeKw = 0;
  }

  return { maxChargeKw, maxDischargeKw };
}

function finiteNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getAvailabilityReasons(reasons: string[]): string[] {
  return reasons.filter(
    (reason) =>
      reason === "charge-disabled" ||
      reason === "discharge-disabled" ||
      reason === "e280-cell-high-charge-block" ||
      reason === "e280-cell-low-discharge-block" ||
      reason === "e280-charge-current-limit" ||
      reason === "e280-discharge-current-limit" ||
      reason.startsWith("mini-max-charge-current-zero") ||
      reason.startsWith("mini-max-discharge-current-zero")
  );
}

function getAvailabilityStatus(
  reasons: string[]
): ControlPipelineStageStatus {
  if (
    reasons.some(
      (reason) =>
        reason === "charge-disabled" ||
        reason === "discharge-disabled" ||
        reason === "e280-cell-high-charge-block" ||
        reason === "e280-cell-low-discharge-block" ||
        reason.startsWith("mini-max-charge-current-zero") ||
        reason.startsWith("mini-max-discharge-current-zero")
    )
  ) {
    return "blocked";
  }
  if (
    reasons.some(
      (reason) =>
        reason === "e280-charge-current-limit" ||
        reason === "e280-discharge-current-limit"
    )
  ) {
    return "active";
  }
  return "skipped";
}

function applyAvailabilityPolicy(
  telemetry: TelemetrySnapshot,
  currentTargetKw: number,
  reasons: string[]
): number {
  if (currentTargetKw > 0 && telemetry.allowDischarge === false) {
    reasons.push("discharge-disabled");
    return 0;
  }

  if (currentTargetKw < 0 && telemetry.allowCharge === false) {
    reasons.push("charge-disabled");
    return 0;
  }

  return currentTargetKw;
}

function applyPcsLimits(
  ctx: CoreControlContext,
  currentTargetKw: number,
  reasons: string[]
): number {
  const maxChargeKw = ctx.design.limits.pcs.maxChargeKw;
  const maxDischargeKw = ctx.design.limits.pcs.maxDischargeKw;

  const clamped = clamp(currentTargetKw, -maxChargeKw, maxDischargeKw);
  if (clamped !== currentTargetKw) {
    reasons.push("pcs-limit-clamp");
  }
  return clamped;
}

interface MiniDispatchResult {
  pcsActivePowerKw: number;
  pcsActivePowerSetpointEnabled: boolean;
  maxChargeCurrentA?: number;
  maxDischargeCurrentA?: number;
}

function resolveMiniDispatch(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  batteryActivePowerKw: number,
  reasons: string[]
): MiniDispatchResult | undefined {
  if (ctx.design.productLine !== "Mini") return undefined;

  const maxCurrents = resolveMiniCurrentLimits(ctx, telemetry, reasons);
  const hasDcPvConverter = hasMiniDcPvConverter(ctx);
  const offGrid =
    telemetry.gridStatus === "island" ||
    telemetry.protectionState === "islanded" ||
    ctx.config.operation.mode === "off-grid";

  if (offGrid) {
    reasons.push("mini-off-grid-setpoint-suppressed");
    if (hasDcPvConverter) {
      maxCurrents.maxChargeCurrentA = 0;
      reasons.push("mini-off-grid-dc-pv-charge-current-zero");
    }
    return {
      pcsActivePowerKw: 0,
      pcsActivePowerSetpointEnabled: false,
      ...maxCurrents,
    };
  }

  const dcPvKw =
    hasDcPvConverter && Number.isFinite(telemetry.pvKw)
      ? telemetry.pvKw || 0
      : 0;
  let pcsActivePowerKw = hasDcPvConverter
    ? dcPvKw + batteryActivePowerKw
    : batteryActivePowerKw;
  if (
    hasDcPvConverter &&
    ctx.config.operation.crdMode === "no-export" &&
    batteryActivePowerKw >= 0 &&
    maxCurrents.maxChargeCurrentA === 0 &&
    Number.isFinite(telemetry.siteLoadKw)
  ) {
    pcsActivePowerKw = clamp(
      telemetry.siteLoadKw || 0,
      0,
      ctx.design.limits.pcs.maxDischargeKw
    );
    reasons.push("mini-no-export-pv-load-follow");
  }
  reasons.push(
    hasDcPvConverter
      ? "mini-dc-pv-ac-setpoint"
      : "mini-ac-pv-battery-setpoint"
  );

  pcsActivePowerKw = applyMiniSelfConsumptionCorrection(
    ctx,
    telemetry,
    batteryActivePowerKw,
    pcsActivePowerKw,
    reasons
  );

  return {
    pcsActivePowerKw,
    pcsActivePowerSetpointEnabled: true,
    ...maxCurrents,
  };
}

function applyMiniSelfConsumptionCorrection(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  batteryActivePowerKw: number,
  pcsActivePowerKw: number,
  reasons: string[]
): number {
  if (!hasMiniDcPvConverter(ctx)) return pcsActivePowerKw;
  if (telemetry.gridStatus !== "normal") return pcsActivePowerKw;
  const actualBatteryPowerKw = finiteNumber(
    telemetry.machineStatus?.actualBatteryPowerKw
  );
  if (actualBatteryPowerKw == null) return pcsActivePowerKw;

  const targetNearZero = Math.abs(batteryActivePowerKw) <= 1;
  const maxCorrectionKw = 15;
  const deadbandKw = 0.2;
  const gain = 0.35;
  const decay = 0.02;
  let correction = ctx.state?.miniSelfConsumptionCorrectionKw ?? 0;

  if (targetNearZero) {
    let errorKw = actualBatteryPowerKw - batteryActivePowerKw;
    if (Math.abs(errorKw) < deadbandKw) errorKw = 0;
    correction = clamp(correction + errorKw * gain, -maxCorrectionKw, maxCorrectionKw);
    reasons.push("mini-self-consumption-correction");
  } else {
    correction *= 1 - decay;
    if (Math.abs(correction) < 0.1) correction = 0;
  }

  if (ctx.state) {
    ctx.state.miniSelfConsumptionCorrectionKw = correction;
  }

  return clamp(
    pcsActivePowerKw - correction,
    -ctx.design.limits.pcs.maxChargeKw,
    ctx.design.limits.pcs.maxDischargeKw
  );
}

function hasMiniDcPvConverter(ctx: CoreControlContext): boolean {
  return ctx.design.productLine === "Mini" && ctx.design.pv.dcCoupledToMiniPcs;
}

function resolveMiniCurrentLimits(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  reasons: string[]
): Pick<MiniDispatchResult, "maxChargeCurrentA" | "maxDischargeCurrentA"> {
  const machine = telemetry.machineStatus;
  const batteryVoltageV = finiteNumber(machine?.batteryVoltageV);
  const socState =
    ctx.state?.socState || resolveSocHysteresisState(ctx, telemetry, reasons);

  let maxChargeCurrentA = finiteNumber(machine?.maxChargeCurrentAllowedA);
  let maxDischargeCurrentA = finiteNumber(machine?.maxDischargeCurrentAllowedA);

  if (batteryVoltageV != null && batteryVoltageV > 0) {
    const chargeCapA =
      (ctx.design.limits.pcs.maxChargeKw * 1000) / batteryVoltageV;
    const dischargeCapA =
      (ctx.design.limits.pcs.maxDischargeKw * 1000) / batteryVoltageV;
    maxChargeCurrentA =
      maxChargeCurrentA == null
        ? chargeCapA
        : Math.min(maxChargeCurrentA, chargeCapA);
    maxDischargeCurrentA =
      maxDischargeCurrentA == null
        ? dischargeCapA
        : Math.min(maxDischargeCurrentA, dischargeCapA);
  }

  const maxCellTemperatureC = finiteNumber(machine?.maxCellTemperatureC);
  const minCellTemperatureC = finiteNumber(machine?.minCellTemperatureC);
  const cellChargeBlocked =
    ctx.state?.miniCellVoltageChargeBlocked ??
    resolveVcellChargeBlock(ctx, machine, reasons);
  const cellDischargeBlocked =
    ctx.state?.miniCellVoltageDischargeBlocked ??
    resolveVcellDischargeBlock(ctx, machine, reasons);

  if (!socState.allowCharge) {
    maxChargeCurrentA = 0;
    reasons.push("mini-max-charge-current-zero-soc");
  }
  if (cellChargeBlocked) {
    maxChargeCurrentA = 0;
    reasons.push("mini-max-charge-current-zero-cell-high");
  }
  if (
    minCellTemperatureC != null &&
    minCellTemperatureC <= MINI_CHARGE_MIN_TEMP_C
  ) {
    maxChargeCurrentA = 0;
    reasons.push("mini-max-charge-current-zero-temp-low");
  }
  if (
    maxCellTemperatureC != null &&
    maxCellTemperatureC >= MINI_BATTERY_MAX_TEMP_C
  ) {
    maxChargeCurrentA = 0;
    reasons.push("mini-max-charge-current-zero-temp-high");
  }

  if (!socState.allowDischarge) {
    maxDischargeCurrentA = 0;
    reasons.push("mini-max-discharge-current-zero-soc");
  }
  if (cellDischargeBlocked) {
    maxDischargeCurrentA = 0;
    reasons.push("mini-max-discharge-current-zero-cell-low");
  }
  if (
    minCellTemperatureC != null &&
    minCellTemperatureC <= MINI_DISCHARGE_MIN_TEMP_C
  ) {
    maxDischargeCurrentA = 0;
    reasons.push("mini-max-discharge-current-zero-temp-low");
  }
  if (
    maxCellTemperatureC != null &&
    maxCellTemperatureC >= MINI_BATTERY_MAX_TEMP_C
  ) {
    maxDischargeCurrentA = 0;
    reasons.push("mini-max-discharge-current-zero-temp-high");
  }

  return {
    maxChargeCurrentA:
      maxChargeCurrentA == null ? undefined : Math.max(0, maxChargeCurrentA),
    maxDischargeCurrentA:
      maxDischargeCurrentA == null
        ? undefined
        : Math.max(0, maxDischargeCurrentA),
  };
}

function applyBatteryCommandRamp(
  ctx: CoreControlContext,
  currentTargetKw: number,
  reasons: string[]
): number {
  const state = ctx.state;
  if (!state) return currentTargetKw;
  const batteryPolicy = resolveBatteryControlPolicy(ctx);

  if (!Number.isFinite(state.previousPcsActivePowerKw)) {
    state.previousPcsActivePowerKw = currentTargetKw;
    return currentTargetKw;
  }

  const previousKw = state.previousPcsActivePowerKw || 0;
  const clamped = previousKw +
    clamp(
      currentTargetKw - previousKw,
      -batteryPolicy.commandRampKwPerSec,
      batteryPolicy.commandRampKwPerSec
    );

  if (clamped !== currentTargetKw) {
    reasons.push("battery-command-ramp");
  }

  state.previousPcsActivePowerKw = clamped;
  return clamped;
}

function applyGeneratorPolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  command: CoreControlCommand
) {
  const generator = ctx.config.generator;
  if (!generator) return;

  const generatorAvailable = telemetry.generatorAvailable !== false;
  const allowGeneratorStart = telemetry.gridStatus !== "normal";
  if (
    generatorAvailable &&
    allowGeneratorStart &&
    !telemetry.generatorRunning &&
    telemetry.soc <= generator.startSoc
  ) {
    command.generatorStart = true;
    command.reasons.push("generator-start");
  }

  if (
    generatorAvailable &&
    !allowGeneratorStart &&
    !telemetry.generatorRunning &&
    telemetry.soc <= generator.startSoc
  ) {
    command.reasons.push("generator-start-not-allowed");
  }

  if (telemetry.generatorRunning && telemetry.soc >= generator.stopSoc) {
    command.generatorStop = true;
    command.reasons.push("generator-stop");
  }

  if (
    telemetry.generatorRunning &&
    generator.chargeFromGenerator &&
    telemetry.soc < generator.stopSoc
  ) {
    const maxChargeKw = ctx.design.limits.pcs.maxChargeKw;
    const generatorChargeKwLimit = clamp(
      generator.chargeKwLimit,
      0,
      Math.min(generator.maxKw, maxChargeKw || generator.chargeKwLimit)
    );

    command.generatorChargeKwLimit = generatorChargeKwLimit;

    if (generatorChargeKwLimit > 0 && telemetry.allowCharge !== false) {
      const chargeTargetKw = -generatorChargeKwLimit;
      if (command.pcsActivePowerKw >= 0) {
        command.pcsActivePowerKw = chargeTargetKw;
      } else {
        command.pcsActivePowerKw = Math.max(
          command.pcsActivePowerKw,
          chargeTargetKw
        );
      }
      command.reasons.push("generator-charge-support");
    }
  }
}

function applyPvCurtailmentPolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  command: CoreControlCommand
) {
  if (!ctx.caps.hasACPV || !telemetry.pvKw || telemetry.pvKw <= 0) return;

  const siteExportMode =
    ctx.config.operation.siteExportMode || "no-restriction";
  const islanded =
    telemetry.gridStatus !== "normal" || ctx.config.operation.mode === "off-grid";

  if (
    siteExportMode === "no-export" &&
    !islanded &&
    telemetry.siteLoadKw != null
  ) {
    applySiteNoExportPvPolicy(ctx, telemetry, command);
    return;
  }

  let curtailmentNeedKw = 0;

  if (
    islanded &&
    telemetry.soc >= ctx.config.battery.maxSoc &&
    telemetry.siteLoadKw != null
  ) {
    curtailmentNeedKw = Math.max(
      curtailmentNeedKw,
      Math.max(0, telemetry.pvKw - Math.max(0, telemetry.siteLoadKw))
    );
  }

  if (islanded && telemetry.siteLoadKw != null) {
    const machineChargeCapKw = telemetry.machineStatus
      ? resolveESpire280MachinePowerCaps(
          telemetry.machineStatus,
          resolveBatteryControlPolicy(ctx).powerHeadroomKw,
          resolveCellVoltagePolicy(ctx)
        ).maxChargeKw
      : undefined;
    const maxChargeKw =
      machineChargeCapKw ?? ctx.design.limits.pcs.maxChargeKw;
    const maxPvWithoutChargeOverloadKw =
      Math.max(0, telemetry.siteLoadKw) + Math.max(0, maxChargeKw);
    curtailmentNeedKw = Math.max(
      curtailmentNeedKw,
      Math.max(0, telemetry.pvKw - maxPvWithoutChargeOverloadKw)
    );
  }

  if (curtailmentNeedKw <= 0) return;

  const boundedCurtailmentKw = Math.min(telemetry.pvKw, curtailmentNeedKw);
  const totalRatedKwAc = Math.max(0, ctx.design.pv.totalRatedKwAc);
  const pvLimitKw = Math.max(0, telemetry.pvKw - boundedCurtailmentKw);
  const pvActivePowerLimitPct =
    totalRatedKwAc > 0
      ? clamp(pvLimitKw / totalRatedKwAc, 0, 1)
      : undefined;

  switch (ctx.config.pv.curtailmentMethod) {
    case "modbus":
      command.pvCurtailmentKw = boundedCurtailmentKw;
      if (pvActivePowerLimitPct != null) {
        command.pvActivePowerLimitPct = pvActivePowerLimitPct;
      }
      command.reasons.push("pv-curtailment-modbus");
      break;

    case "frequency-shifting":
      command.frequencyShiftRequested = true;
      command.reasons.push("pv-curtailment-frequency-shift");
      break;

    default:
      break;
  }
}

function applySiteNoExportPvPolicy(
  ctx: CoreControlContext,
  telemetry: TelemetrySnapshot,
  command: CoreControlCommand
) {
  const totalRatedKwAc = Math.max(0, ctx.design.pv.totalRatedKwAc);
  if (totalRatedKwAc <= 0 || telemetry.siteLoadKw == null) return;

  const machine = telemetry.machineStatus;
  const caps = machine
    ? resolveESpire280MachinePowerCaps(
        machine,
        resolveBatteryControlPolicy(ctx).powerHeadroomKw,
        resolveCellVoltagePolicy(ctx)
      )
    : {};
  const chargeBlockedBySoc =
    telemetry.soc >= ctx.config.battery.maxSoc ||
    command.reasons.includes("battery-max-soc") ||
    telemetry.allowCharge === false;
  const maxChargeKw = chargeBlockedBySoc
    ? 0
    : caps.maxChargeKw ?? ctx.design.limits.pcs.maxChargeKw;
  const nearFull = telemetry.soc >= SITE_NO_EXPORT_SOC_PREHIGH;
  const pchgForPvKw = nearFull ? 0 : Math.max(0, maxChargeKw);
  const utilityPowerKw = telemetry.utilityPowerKw;
  const bmsOk = machine?.bmsStatus == null || machine.bmsStatus === 1;
  const pcsFaulted = machine?.pcsGlobalState === 7;
  const siteExportTargetImportKw =
    ctx.config.operation.siteExportTargetImportKw ?? 0.5;
  const siteExportDeadbandKw =
    ctx.config.operation.siteExportDeadbandKw ?? 0.8;

  let fleetKwTarget = clamp(
    Math.max(0, telemetry.siteLoadKw) + pchgForPvKw + SITE_NO_EXPORT_PV_MARGIN_KW,
    0,
    totalRatedKwAc
  );

  if (utilityPowerKw != null && utilityPowerKw < 0 && maxChargeKw <= 0) {
    fleetKwTarget = clamp(Math.max(0, telemetry.siteLoadKw) + 0.5, 0, totalRatedKwAc);
    command.reasons.push("site-no-export-charge-unavailable");
  }
  if (!bmsOk || pcsFaulted) {
    fleetKwTarget = clamp(Math.max(0, telemetry.siteLoadKw) + 0.5, 0, totalRatedKwAc);
  }
  const nowMs = ctx.nowMs ?? Date.now();
  const state = ctx.state;
  const previousPv = state?.pvControl || { lastUpdateMs: 0, fleetPct: 0 };
  if (utilityPowerKw != null) {
    const poiErrorKw = utilityPowerKw - siteExportTargetImportKw;
    if (Math.abs(poiErrorKw) > siteExportDeadbandKw) {
      const previousFleetPct =
        Number.isFinite(previousPv.fleetPct) && previousPv.fleetPct > 0.01
          ? previousPv.fleetPct
          : undefined;
      const effectivePvAvailableKw =
        previousFleetPct != null && telemetry.pvKw != null
          ? clamp(telemetry.pvKw / previousFleetPct, telemetry.pvKw, totalRatedKwAc)
          : totalRatedKwAc;
      const poiCorrectedPvKw = clamp(
        (telemetry.pvKw ?? fleetKwTarget) + poiErrorKw,
        0,
        effectivePvAvailableKw
      );
      fleetKwTarget = clamp(
        (poiCorrectedPvKw / effectivePvAvailableKw) * totalRatedKwAc,
        0,
        totalRatedKwAc
      );
      command.reasons.push("site-no-export-poi-trim");
    }
  }

  const targetPct = clamp(fleetKwTarget / totalRatedKwAc, 0, 1);
  const shouldUpdate =
    !state || nowMs - previousPv.lastUpdateMs >= SITE_NO_EXPORT_PV_UPDATE_MS;
  const panic =
    telemetry.soc >= SITE_NO_EXPORT_PV_PANIC_SOC &&
    utilityPowerKw != null &&
    utilityPowerKw <= SITE_NO_EXPORT_PV_PANIC_EXPORT_KW;
  const rampPct = panic
    ? SITE_NO_EXPORT_PV_PANIC_RAMP_PCT
    : SITE_NO_EXPORT_PV_RAMP_PCT;
  let fleetPct = Number.isFinite(previousPv.fleetPct)
    ? previousPv.fleetPct
    : targetPct;

  if (shouldUpdate) {
    fleetPct =
      fleetPct + clamp(targetPct - fleetPct, -rampPct, rampPct);
    fleetPct = clamp(fleetPct, 0, 1);
    if (state) {
      state.pvControl = { lastUpdateMs: nowMs, fleetPct };
    }
  }

  command.pvActivePowerLimitPct = fleetPct;
  command.pvCurtailmentKw = Math.max(
    0,
    (telemetry.pvKw ?? 0) - fleetPct * totalRatedKwAc
  );
  command.reasons.push("site-no-export", "pv-curtailment-modbus");
  if (nearFull) command.reasons.push("site-no-export-soc-prehigh");
  if (panic) command.reasons.push("site-no-export-panic-ramp");
  if (!bmsOk) command.reasons.push("site-no-export-bms-abnormal");
  if (pcsFaulted) command.reasons.push("site-no-export-pcs-faulted");
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
