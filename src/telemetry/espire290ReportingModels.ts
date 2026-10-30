// src/telemetry/espire290ReportingModels.ts
//
// SCAFFOLD - same open question as espire314ReportingModels.ts (on
// feat/espire314-esmu): every ss40k.model in the eSpire 290 templates is
// "TODO" until a SunSpec-style model number range is assigned for the OLP
// CMS / BMU cluster / TMU blocks. Once assigned:
//   - FAULT models: CmsFaultWord*, CmsFaultStatus, cluster FaultCode1-3,
//     ImuStatus - report immediately on change.
//   - MONITORING models: CMS SOC/V/I/power/limits, cluster SOC/V/I, TMU temps.
//   - INFO / CONFIG models: versions, cluster count/enable mask, SOC limits.

export const ESPIRE290_INFO_MODELS: ReadonlySet<string> = new Set([
  // TODO
]);

export const ESPIRE290_MONITORING_MODELS: ReadonlySet<string> = new Set([
  // TODO
]);

export const ESPIRE290_FAULT_MODELS: ReadonlySet<string> = new Set([
  // TODO
]);

export const ESPIRE290_CONFIG_MODELS: ReadonlySet<string> = new Set([
  // TODO
]);
