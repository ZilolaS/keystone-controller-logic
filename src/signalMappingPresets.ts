import type { SignalMappingConfig, SignalMappingSourceConfig } from "./config";

export type MiniSignalMappingPreset =
  | "mini_pcs_grid_load_pvdc"
  | "mini_egauge_grid_load_pvdc"
  | "mini_egauge_grid_pcs_load_pvdc";

export interface MiniSignalMappingPresetOptions {
  systemProfile: string;
  meterProfile?: string;
  meterIp?: string;
  meterPort?: number;
  meterUnitId?: number;
  pvdcCount?: number;
}

export function buildMiniSignalMappingPreset(
  preset: MiniSignalMappingPreset,
  options: MiniSignalMappingPresetOptions
): SignalMappingConfig {
  const pvdcCount = resolveMiniPvdcCount(options);
  const sources: Record<string, SignalMappingSourceConfig> = {
    PCS: { profile: "Sinexcel_Mini_PCS_ss40k", role: "pcs" },
    AMPACE: { profile: "AMPACE_Mini_ss40k", role: "bms" },
    Gateway: {
      profile: "Sinexcel_Mini_Gateway_ss40k",
      role: "other",
      ip: "192.168.1.101",
      port: 502,
      unitId: 1,
    },
    ...pvdcSources(pvdcCount),
  };

  if (preset === "mini_pcs_grid_load_pvdc") {
    sources.Load = { profile: "Sinexcel_Mini_Load_ss40k", role: "load" };
    return {
      sources,
      signals: {
        gridPowerKw: { expr: "PCS.GridTotalActivePower" },
        loadPowerKw: { expr: "Load.LoadTotalActivePower" },
        pvPowerKw: { expr: pvdcPowerExpression(pvdcCount) },
        pcsPowerKw: { expr: "PCS.ACBusTotalActivePower", invertSign: true },
        batteryPowerKw: { expr: "AMPACE.BamsPower" },
      },
    };
  }

  sources.Meter = meterSource(options, "siteMeter");

  if (preset === "mini_egauge_grid_load_pvdc") {
    return {
      sources,
      signals: {
        gridPowerKw: { expr: "Meter.Utility_Total_Power" },
        loadPowerKw: { expr: "Meter.Load_Active_Power" },
        pvPowerKw: { expr: pvdcPowerExpression(pvdcCount) },
        pcsPowerKw: { expr: "PCS.ACBusTotalActivePower", invertSign: true },
        batteryPowerKw: { expr: "AMPACE.BamsPower" },
      },
    };
  }

  sources.Load = { profile: "Sinexcel_Mini_Load_ss40k", role: "load" };
  return {
    sources,
    signals: {
      gridPowerKw: { expr: "Meter.Utility_Total_Power" },
      loadPowerKw: { expr: "Load.LoadTotalActivePower" },
      pvPowerKw: { expr: pvdcPowerExpression(pvdcCount) },
      pcsPowerKw: { expr: "PCS.ACBusTotalActivePower", invertSign: true },
      batteryPowerKw: { expr: "AMPACE.BamsPower" },
    },
  };
}

export function resolveMiniPvdcCount(
  options: Pick<MiniSignalMappingPresetOptions, "systemProfile" | "pvdcCount">
): number {
  if (options.pvdcCount !== undefined) {
    return clampPvdcCount(options.pvdcCount);
  }

  const dcPvKw = Number(String(options.systemProfile || "").split("-")[2]);
  if (!Number.isFinite(dcPvKw) || dcPvKw <= 0) return 0;
  return clampPvdcCount(Math.round(dcPvKw / 45));
}

function pvdcSources(count: number): Record<string, SignalMappingSourceConfig> {
  const sources: Record<string, SignalMappingSourceConfig> = {};
  for (let i = 1; i <= count; i += 1) {
    sources[`PVDC${i}`] = {
      profile: `Sinexcel_Mini_PVDC_Module${i}_ss40k`,
      role: "pvdc",
    };
  }
  return sources;
}

function pvdcPowerExpression(count: number): string {
  if (count <= 0) return "0";
  return Array.from(
    { length: count },
    (_, index) => `PVDC${index + 1}.PVBusSidePower`
  ).join(" + ");
}

function meterSource(
  options: MiniSignalMappingPresetOptions,
  role: string
): SignalMappingSourceConfig {
  return {
    profile: options.meterProfile || "configured_eGauge",
    role,
    ...(options.meterIp ? { ip: options.meterIp } : {}),
    ...(options.meterPort ? { port: options.meterPort } : {}),
    ...(options.meterUnitId ? { unitId: options.meterUnitId } : {}),
  };
}

function clampPvdcCount(value: number): number {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.max(0, Math.min(3, count));
}
