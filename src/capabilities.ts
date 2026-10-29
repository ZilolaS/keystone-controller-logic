// src/capabilities.ts

import { SiteConfig } from "./config";

export interface MiniModelInfo {
  modelCode: string;
  pcsKw: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  dcPvKw: number;
  pvDcKw: number;
  hasDcPvConverter: boolean;
  batteryKwh: number;
  batteryKWh: number;
  voltageVll: 208 | 480;
  voltage: number;
}

const MINI_PCS_KW = [30, 50, 60, 90] as const;
const MINI_DC_PV_KW = [0, 45, 90, 135] as const;
const MINI_VOLTAGE_VLL = [208, 480] as const;

/**
 * Parse MINI-60-90-163-480 into product capabilities.
 * Existing field configs may omit voltage, for example MINI-90-135-288.
 * Omitted voltage defaults to 480 VLL.
 *
 * Format: MINI-XX-YY-ZZ-VVV or MINI-XX-YY-ZZ
 * XX  = PCS kW, one of 30/50/60/90
 * YY  = DC PV kW, one of 0/45/90/135. 0 means no built-in DC converter.
 * ZZ  = battery kWh
 * VVV = AC line-line voltage, 208 or 480. Defaults to 480 when omitted.
 */
export function parseMiniModel(systemProfile: string): MiniModelInfo | null {
  const match = systemProfile
    .trim()
    .match(/^MINI-(\d+)-(\d+)-(\d+(?:\.\d+)?)(?:-(\d+))?$/i);
  if (!match) return null;

  const [, pcsStr, pvStr, battStr, voltStr] = match;
  const pcsKw = Number(pcsStr);
  const dcPvKw = Number(pvStr);
  const batteryKwh = Number(battStr);
  const voltage = Number(voltStr ?? 480);

  if (
    [pcsKw, batteryKwh, voltage].some(
      (v) => !Number.isFinite(v) || v <= 0
    ) ||
    !Number.isFinite(dcPvKw) ||
    dcPvKw < 0
  ) {
    return null;
  }
  if (!includesNumber(MINI_PCS_KW, pcsKw)) return null;
  if (!includesNumber(MINI_DC_PV_KW, dcPvKw)) return null;
  if (!includesNumber(MINI_VOLTAGE_VLL, voltage)) return null;

  const voltageVll = voltage as 208 | 480;
  return {
    modelCode: `MINI-${pcsKw}-${dcPvKw}-${batteryKwh}-${voltageVll}`,
    pcsKw,
    maxChargeKw: pcsKw,
    maxDischargeKw: pcsKw,
    dcPvKw,
    pvDcKw: dcPvKw,
    hasDcPvConverter: dcPvKw > 0,
    batteryKwh,
    batteryKWh: batteryKwh,
    voltageVll,
    voltage: voltageVll,
  };
}

function includesNumber(values: readonly number[], value: number): boolean {
  return values.includes(value);
}

export interface SiteCapabilities {
  isMini: boolean;
  is280: boolean;
  isNano: boolean;
  hasPcs: boolean;
  hasMbmu: boolean;
  hasGenerator: boolean;
  hasACPV: boolean;
  usesCustomGrid: boolean;
  hasIslanding: boolean;
  hasControllerNetwork: boolean;
  hasMeterIntegration: boolean;
  hasPcsTopology: boolean;
  hasMbmuTopology: boolean;
  hasAcInverterInventory: boolean;
  scheduledControlEnabled: boolean;
  crdRestricted: boolean;
  siteExportRestricted: boolean;
  pvCurtailmentViaModbus: boolean;
  pvCurtailmentViaFrequencyShift: boolean;
  miniModelInfo: MiniModelInfo | null;
}

export function deriveCapabilities(config: SiteConfig): SiteCapabilities {
  const profile = config.system.systemProfile.trim();

  const is280 = profile === "eSpire280";
  const isNano = isNanoModel(profile);
  const miniModelInfo = parseMiniModel(profile);
  const isMini = !!miniModelInfo;

  const hasPcs = (is280 && !!config.pcs) || isMini || isNano;
  const hasMbmu = is280 && !!config.mbmu;
  const hasGenerator = !!config.generator;
  const hasACPV = config.pv.acInverters?.length > 0;
  const usesCustomGrid = config.operation.gridCode === "Custom";
  const hasIslanding = !!config.islanding;
  const hasControllerNetwork =
    !!config.network?.controller?.ip &&
    !!config.network?.controller?.modbusServer?.ip;
  const hasMeterIntegration =
    !!config.metering?.meterType &&
    !!config.metering?.modbusProfile &&
    !!config.metering?.ip;
  const hasPcsTopology = Array.isArray(config.pcs?.pcsDaisyChain) && config.pcs!.pcsDaisyChain.length > 0;
  const hasMbmuTopology = Array.isArray(config.mbmu?.sbmuStrings) && config.mbmu!.sbmuStrings.length > 0;
  const hasAcInverterInventory = Array.isArray(config.pv?.acInverters) && config.pv.acInverters.length > 0;
  const scheduledControlEnabled = !!config.operation.scheduledControlEnabled;
  const crdRestricted = config.operation.crdMode !== "no-restriction";
  const siteExportRestricted = config.operation.siteExportMode === "no-export";
  const pvCurtailmentViaModbus = config.pv.curtailmentMethod === "modbus";
  const pvCurtailmentViaFrequencyShift =
    config.pv.curtailmentMethod === "frequency-shifting";

  return {
    isMini,
    is280,
    isNano,
    hasPcs,
    hasMbmu,
    hasGenerator,
    hasACPV,
    usesCustomGrid,
    hasIslanding,
    hasControllerNetwork,
    hasMeterIntegration,
    hasPcsTopology,
    hasMbmuTopology,
    hasAcInverterInventory,
    scheduledControlEnabled,
    crdRestricted,
    siteExportRestricted,
    pvCurtailmentViaModbus,
    pvCurtailmentViaFrequencyShift,
    miniModelInfo,
  };
}

export function isNanoModel(systemProfile: string): boolean {
  return /^NANO(?:-|$)/i.test(systemProfile.trim());
}
