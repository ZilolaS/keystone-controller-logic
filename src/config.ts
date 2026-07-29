// src/config.ts

// ---- Basic string unions / enums ----

export type OperationMode = "grid-tied" | "backup" | "off-grid";

export type GridCode =
  | "IEEE1547-2018"
  | "Rule21"
  | "Rule14H"
  | "PREPA-MTR"
  | "ISO"
  | "Ontario-ESA"
  | "Custom";

export type CrdMode =
  | "no-restriction"
  | "no-import"
  | "no-export"
  | "no-exchange";

export type SiteExportMode = "no-restriction" | "no-export";

export type PvCurtailmentMethod =
  | "modbus"
  | "frequency-shifting"
  | null
  | undefined;

export type IslandingDeviceType =
  | "SEL351"
  | "SEL751"
  | "SEL851"
  | "ASCO-ATS"
  | "EATON-ATS";

export type GeneratorControlType = "RemoteIO" | "SEL";

// ---- Core interfaces ----

export interface SystemNominal {
  voltageVll: number;   // e.g. 480
  frequencyHz: number;  // e.g. 60
}

export interface SystemConfig {
  /**
   * "eSpire280", "NANO", or Mini model code like "MINI-60-90-163-480"
   */
  systemProfile: string;

  controllerTimezone: string;           // IANA TZ string
  nominal: SystemNominal;
}

export interface ModbusServerConfig {
  ip: string;
  port: number; // usually 502
}

export type SiteAssetProductLine = "280" | "Mini" | "NANO" | "all";

export type SiteAssetRole =
  | "pcs"
  | "bms"
  | "mbmu"
  | "pvdc"
  | "meter"
  | "islanding"
  | "generator"
  | "load"
  | "pv-inverter"
  | "remote-io"
  | "other";

export interface ModbusServerSlotConfig {
  /**
   * Stable Node-RED server slot key, for example "server_1".
   */
  key: string;
  ip: string;
  port: number;
  enabled?: boolean;
}

export interface SiteAssetConfig {
  /**
   * Stable asset id used by telemetry/writer topics, for example "PCS",
   * "AMPACE", "PVDC1", "MBMU", or "Meter".
   */
  id: string;
  role: SiteAssetRole;
  productLine?: SiteAssetProductLine;
  template?: string;
  profileName?: string;
  ip: string;
  port: number;
  unitId: number;
  serverSlot?: string;
  serverKey?: string;
  enabled?: boolean;
}

export interface ControllerNetworkConfig {
  ip: string;
  modbusServer: ModbusServerConfig;
}

export interface NetworkConfig {
  controller: ControllerNetworkConfig;
  /**
   * Optional fixed Modbus client slots used by the unified Node-RED flow.
   * IP/topology changes here are restart-required.
   */
  serverSlots?: ModbusServerSlotConfig[];
  /**
   * Optional installed device inventory. The runtime plan builder should map
   * these assets onto fixed server slots.
   */
  assets?: SiteAssetConfig[];
}

// ---- Operation / grid code ----

export interface VoltageRideThroughBand {
  name: string;
  vMinPu: number;
  vMaxPu: number;
  minRideThroughSec: number;
}

export interface FrequencyRideThroughBand {
  name: string;
  fMinHz: number;
  fMaxHz: number;
  minRideThroughSec: number;
}

export interface VoltVarPoint {
  vPu: number;
  qPu: number;
}

export interface VoltVarProfile {
  enabled: boolean;
  points: VoltVarPoint[];
}

export interface FreqWattProfile {
  enabled: boolean;
  droopPercent: number;
  deadbandHz: number;
  minHz: number;
  maxHz: number;
}

export interface VoltWattPoint {
  vPu: number;
  pPu: number;
}

export interface VoltWattProfile {
  enabled: boolean;
  points: VoltWattPoint[];
}

export interface RampRates {
  startupPctPerSec: number;
  normalPctPerSec: number;
}

export interface ReconnectionProfile {
  delaySec: number;
  vMinPu: number;
  vMaxPu: number;
  fMinHz: number;
  fMaxHz: number;
}

// Only present when gridCode === "Custom"
export interface CustomGridProfile {
  gridProfile: string;
  voltageRideThrough: VoltageRideThroughBand[];
  frequencyRideThrough: FrequencyRideThroughBand[];
  voltVar: VoltVarProfile;
  freqWatt: FreqWattProfile;
  voltWatt: VoltWattProfile;
  rampRates: RampRates;
  reconnection: ReconnectionProfile;
}

export interface OperationConfig {
  mode: OperationMode;
  gridCode: GridCode;
  customGridProfile?: CustomGridProfile;
  /**
   * PCS/battery-side CRD policy. Site-level PV export limiting is configured
   * separately with siteExportMode.
   */
  crdMode: CrdMode;
  siteExportMode?: SiteExportMode;
  siteExportTargetImportKw?: number;
  siteExportDeadbandKw?: number;
  scheduledControlEnabled: boolean;
}

// ---- PCS / MBMU (eSpire280 only) ----

export interface PcsConfig {
  /**
   * eSpire280 ONLY.
   * pcsDaisyChain = [1,2,1] means:
   *  Cabinet 1 → 1 PCS
   *  Cabinet 2 → 2 PCS
   *  Cabinet 3 → 1 PCS
   */
  pcsDaisyChain: number[];

  maxChargeKw: number;
  maxDischargeKw: number;
}

/**
 * eSpire280 ONLY.
 * sbmuStrings = [2,3,2] means:
 *  MBMU #1 → 2 SBMU strings
 *  MBMU #2 → 3 SBMU strings
 *  MBMU #3 → 2 SBMU strings
 */
export interface MbmuConfig {
  sbmuStrings: number[];
}

// ---- Battery ----

export interface BatteryConfig {
  minSoc: number; // 0..1
  maxSoc: number; // 0..1
  socLow?: number; // 0..1
  socLowRecover?: number; // 0..1
  socHigh?: number; // 0..1
  socHighRecover?: number; // 0..1
  forceGridChargeSoc?: number; // 0..1
  forceGridChargeMinCellVoltageV?: number;
  forceGridChargeKw?: number;
  powerHeadroomKw?: number;
  commandRampKwPerSec?: number;
  cellVoltagePolicy?: BatteryCellVoltagePolicy;
}

export interface BatteryCellVoltagePolicy {
  /**
   * Disable charging when max cell voltage is at or above this threshold.
   */
  maxCellVoltageChargeBlockV?: number;
  /**
   * Re-enable charging when max cell voltage is at or below this threshold.
   */
  maxCellVoltageChargeRecoverV?: number;
  /**
   * Disable discharging when min cell voltage is at or below this threshold.
   */
  minCellVoltageDischargeBlockV?: number;
  /**
   * Re-enable discharging when min cell voltage is at or above this threshold.
   * eSpire280 defaults this to the block threshold for legacy behavior.
   */
  minCellVoltageDischargeRecoverV?: number;
  /**
   * eSpire280 charge taper start voltage.
   */
  chargeTaperStartV?: number;
  /**
   * eSpire280 charge taper end voltage. Defaults to charge-block threshold.
   */
  chargeTaperEndV?: number;
  /**
   * Minimum charge capacity fraction at taper end, before full block.
   */
  chargeTaperMinFraction?: number;
}

// ---- PV / AC-coupled inverters ----

export interface PvAcInverterConfig {
  id?: string;
  type: string;           // "Fronius", "SMA", etc.
  model: string;
  ratedKwAc: number;
  ip: string;
  port: number;
  modbusProfile: string;  // e.g. "fronius_ac_v1"
}

export interface PvConfig {
  acInverters: PvAcInverterConfig[];
  curtailmentMethod?: PvCurtailmentMethod;
  /**
   * eSpire Mini only. True when PV is DC-coupled through the Mini PCS, so the
   * PCS active power setpoint represents DC PV pass-through plus battery power.
   * False for AC-only PV sites where the Mini PCS command is battery-only.
   */
  dcCoupledToMiniPcs?: boolean;
}

// ---- Islanding ----

export interface IslandingConfig {
  device: IslandingDeviceType;
}

// ---- Metering ----

export interface MeterReadsConfig {
  pv: boolean;
  pvFromInverter: boolean;
  utility: boolean;
  load: boolean;
}

export type MeteringReadingKey = "utilityPowerKw" | "siteLoadKw" | "pvKw";

/**
 * Site-level normalized power signals used by both control and cloud export.
 *
 * Sign convention:
 * - gridPowerKw: + import from grid, - export to grid
 * - loadPowerKw: + site consumption
 * - pvPowerKw: + PV production
 * - batteryPowerKw: + battery discharge, - battery charge
 * - pcsPowerKw: + PCS discharge to AC bus, - PCS charge
 * - backupLoadKw: + backup/critical load consumption
 * - generatorPowerKw: + generator output
 */
export type CanonicalPowerSignalKey =
  | "gridPowerKw"
  | "loadPowerKw"
  | "pvPowerKw"
  | "batteryPowerKw"
  | "pcsPowerKw"
  | "backupLoadKw"
  | "generatorPowerKw";

export type MeteringRegisterFunction =
  | "HR"
  | "HRUS"
  | "HRI"
  | "HRUI"
  | "HRF"
  | "IR"
  | "IRUS"
  | "IRI"
  | "IRUI"
  | "IRF";

export type MeteringRegisterSignalKey =
  | MeteringReadingKey
  | "gridImportPowerKw"
  | "gridExportPowerKw"
  | "backupLoadKw"
  | "frequencyHz"
  | "voltageL1N"
  | "voltageL2N"
  | "voltageL3N"
  | "voltageL1L2"
  | "voltageL2L3"
  | "voltageL3L1"
  | "energyImportKwh"
  | "energyExportKwh"
  | "custom";

export interface MeteringRegisterMapping {
  /**
   * Stable canonical meaning. UI should present this as a dropdown instead of
   * letting every legacy site invent new signal names.
   */
  signal: MeteringRegisterSignalKey;
  /**
   * Tag name exposed under the Meter equipment, for example
   * Meter.Utility_Total_Power. If omitted, the runtime uses a canonical default.
   */
  tagID?: string;
  register: number;
  function: MeteringRegisterFunction;
  scale?: number;
  offset?: number;
  sign?: 1 | -1;
  pollClass?: "fast" | "normal" | "slow" | "startup";
  ss40kName?: string;
  supportingTag?: boolean;
  description?: string;
}

export interface MeteringDirectReadingCalculation {
  source: "tag";
  tagID: string;
}

export interface MeteringExpressionCalculation {
  source: "calc";
  inputs: Record<string, string>;
  expr: string;
}

export type MeteringReadingCalculation =
  | MeteringDirectReadingCalculation
  | MeteringExpressionCalculation;

export type MeteringCalculationConfig = Partial<
  Record<MeteringReadingKey, MeteringReadingCalculation>
>;

export interface MeteringConfig {
  meterType: string;      // "eGauge-4015", "Accuenergy-AcuRev", etc.
  modbusProfile: string;  // "udt_eGauge_V1", "acurev_v1", etc.
  ip: string;
  port?: number;
  unitId?: number;
  reads: MeterReadsConfig;
  registerMap?: MeteringRegisterMapping[];
  calculations?: MeteringCalculationConfig;
}

// ---- Signal mapping / telemetry normalization ----

export type CanonicalSignalKey =
  | CanonicalPowerSignalKey
  // Legacy aliases kept for existing site configs and flow functions.
  | MeteringReadingKey
  | "pcsActivePowerKw"
  | "generatorRunning";

export interface SignalMappingSourceConfig {
  profile?: string;
  profileName?: string;
  modbusProfile?: string;
  role?: string;
  ip?: string;
  host?: string;
  tcpHost?: string;
  port?: number;
  tcpPort?: number;
  unitId?: number;
  route?: string;
}

export interface SignalMappingSignalConfig {
  expr: string;
  invertSign?: boolean;
}

export interface SignalMappingConfig {
  sources?: Record<string, SignalMappingSourceConfig>;
  deadbands?: Record<string, number>;
  signals?: Partial<Record<CanonicalSignalKey, SignalMappingSignalConfig>>;
  /**
   * Optional direct fixed-model point overrides. Used when a site maps SS40K
   * reporting points such as pGridImpTot or fGrid to eGauge/custom meter tags
   * instead of product-default telemetry.
   */
  ss40k?: Partial<Record<string, SignalMappingSignalConfig>>;
}

// ---- Generator ----

export interface GeneratorConfig {
  maxKw: number;
  chargeFromGenerator: boolean;
  chargeKwLimit: number;
  startSoc: number;
  stopSoc: number;
  controlType: GeneratorControlType;
}

// ---- Top-level site config ----

export interface SiteConfig {
  system: SystemConfig;
  network: NetworkConfig;
  operation: OperationConfig;
  pcs?: PcsConfig;          // present only for eSpire280
  mbmu?: MbmuConfig;        // present only for eSpire280
  battery: BatteryConfig;
  pv: PvConfig;
  islanding?: IslandingConfig;
  metering: MeteringConfig;
  signalMapping?: SignalMappingConfig;
  generator?: GeneratorConfig;
}
