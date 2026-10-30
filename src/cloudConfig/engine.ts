import * as fs from "fs";
import * as path from "path";
import { isDeepStrictEqual } from "util";
import type { SiteConfig, CustomGridProfile } from "../config";
import {
  deriveCapabilities,
  isNanoModel,
  parseMiniModel,
  type SiteCapabilities,
} from "../capabilities";

const yaml = require("js-yaml") as { load: (src: string) => unknown };

export type CloudFieldType = "String" | "Number" | "enum16";

export interface CloudFieldRange {
  min?: number;
  max?: number;
}

export interface CloudFieldSpec {
  arg: string;
  dtype: CloudFieldType;
  meanings?: Record<string, string>;
  range?: CloudFieldRange;
}

export interface CloudCommandSpec {
  commandId: string;
  title: string;
  sectionId?: string;
  subsectionId?: string;
  access?: string;
  fields: Record<string, CloudFieldSpec>;
}

export interface CloudConfigSpec {
  commands: Record<string, CloudCommandSpec>;
}

export interface CloudConfigUpdate {
  commandId?: string;
  command_id?: string;
  values: Record<string, unknown>;
}

export interface NormalizedCloudConfigUpdate {
  commandId: string;
  values: Record<string, unknown>;
}

export interface SiteConfigValidationIssue {
  path: string;
  message: string;
}

export type ApplyClassification = "hot" | "restart";

export interface ConfigApplyDiagnostic {
  commandId: string;
  arg?: string;
  path?: string;
  status: "applied" | "applied-restart-required" | "rejected";
  classification?: ApplyClassification;
  message?: string;
}

export interface SiteConfigApplyResult {
  success: boolean;
  nextConfig: SiteConfig;
  nextCapabilities: SiteCapabilities;
  restartRequired: boolean;
  diagnostics: ConfigApplyDiagnostic[];
  validationIssues: SiteConfigValidationIssue[];
}

type ApplyArgResult = {
  changed: boolean;
  path: string;
  classification: ApplyClassification;
};

type ParsedPoint = {
  command_id?: string;
  section_id?: string;
  subsection_id?: string;
  title?: string;
  access?: string;
  entries?: Array<{
    arg?: string;
    dtype?: string;
    meanings?: Record<string, string>;
    range?: CloudFieldRange;
  }>;
};

function specYamlPath() {
  const candidates = [
    path.resolve(__dirname, "..", "coreControl", "keystone_ci_addition.yaml"),
    path.resolve(process.cwd(), "src", "coreControl", "keystone_ci_addition.yaml"),
    path.resolve(process.cwd(), "dist", "coreControl", "keystone_ci_addition.yaml"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Cannot locate keystone_ci_addition.yaml");
}

let cachedSpec: CloudConfigSpec | null = null;

export function loadSiteConfigCommandSpec(forceReload = false): CloudConfigSpec {
  if (cachedSpec && !forceReload) return cachedSpec;

  const raw = fs.readFileSync(specYamlPath(), "utf8");
  const parsed = yaml.load(raw) as { points?: ParsedPoint[] };
  const points = Array.isArray(parsed?.points) ? parsed.points : [];

  const commands: Record<string, CloudCommandSpec> = {};

  for (const point of points) {
    if (!point || typeof point !== "object") continue;
    const commandId = point.command_id;
    if (!commandId || typeof commandId !== "string") continue;

    const fields: Record<string, CloudFieldSpec> = {};
    const entries = Array.isArray(point.entries) ? point.entries : [];

    for (const entry of entries) {
      const arg = entry?.arg;
      const dtype = entry?.dtype;
      if (!arg || typeof arg !== "string") continue;
      if (dtype !== "String" && dtype !== "Number" && dtype !== "enum16") continue;

      fields[arg] = {
        arg,
        dtype,
        meanings:
          entry?.meanings && typeof entry.meanings === "object"
            ? entry.meanings
            : undefined,
        range:
          entry?.range && typeof entry.range === "object"
            ? entry.range
            : undefined,
      };
    }

    commands[commandId] = {
      commandId,
      title: point.title || commandId,
      sectionId: point.section_id,
      subsectionId: point.subsection_id,
      access: point.access,
      fields,
    };
  }

  cachedSpec = { commands };
  return cachedSpec;
}

export function normalizeCloudConfigUpdates(
  updates: CloudConfigUpdate[]
): NormalizedCloudConfigUpdate[] {
  return updates
    .map((update) => ({
      commandId: String(update.commandId || update.command_id || "").trim(),
      values: update.values || {},
    }))
    .filter((update) => !!update.commandId);
}

export function applyCloudConfigUpdates(
  currentConfig: SiteConfig,
  updates: CloudConfigUpdate[],
  spec: CloudConfigSpec = loadSiteConfigCommandSpec()
): SiteConfigApplyResult {
  const diagnostics: ConfigApplyDiagnostic[] = [];
  const normalizedUpdates = normalizeCloudConfigUpdates(updates);
  const working = cloneConfig(currentConfig);

  for (const update of normalizedUpdates) {
    const command = spec.commands[update.commandId];
    if (!command) {
      diagnostics.push({
        commandId: update.commandId,
        status: "rejected",
        message: "Unknown commandId",
      });
      continue;
    }

    for (const [arg, rawValue] of Object.entries(update.values || {})) {
      const fieldSpec = command.fields[arg];
      if (!fieldSpec) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: "Unknown arg for command",
        });
        continue;
      }

      const converted = convertCloudValue(rawValue, fieldSpec);
      if (!converted.ok) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: converted.error,
        });
        continue;
      }

      let applied: ApplyArgResult | null = null;
      try {
        applied = applyArgToSiteConfig(working, arg, converted.value);
      } catch (error) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: (error as Error).message || "Failed to apply arg",
        });
        continue;
      }
      if (!applied) {
        diagnostics.push({
          commandId: update.commandId,
          arg,
          status: "rejected",
          message: "Arg is valid but has no SiteConfig mapping",
        });
        continue;
      }

      if (!applied.changed) continue;

      diagnostics.push({
        commandId: update.commandId,
        arg,
        path: applied.path,
        status:
          applied.classification === "restart"
            ? "applied-restart-required"
            : "applied",
        classification: applied.classification,
      });
    }
  }

  const validationIssues = validateSiteConfig(working);
  if (validationIssues.length) {
    return {
      success: false,
      nextConfig: cloneConfig(currentConfig),
      nextCapabilities: deriveCapabilities(currentConfig),
      restartRequired: false,
      diagnostics: [
        ...diagnostics,
        ...validationIssues.map((issue) => ({
          commandId: "(post-apply)",
          path: issue.path,
          status: "rejected" as const,
          message: issue.message,
        })),
      ],
      validationIssues,
    };
  }

  const restartRequired = diagnostics.some(
    (d) => d.status === "applied-restart-required"
  );

  return {
    success: true,
    nextConfig: working,
    nextCapabilities: deriveCapabilities(working),
    restartRequired,
    diagnostics,
    validationIssues: [],
  };
}

function cloneConfig(config: SiteConfig): SiteConfig {
  return JSON.parse(JSON.stringify(config)) as SiteConfig;
}

function convertCloudValue(
  raw: unknown,
  field: CloudFieldSpec
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (field.dtype) {
    case "String": {
      if (typeof raw !== "string") {
        return { ok: false, error: "Expected String" };
      }
      return { ok: true, value: raw };
    }

    case "Number": {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return { ok: false, error: "Expected Number" };
      }
      if (field.range?.min != null && value < field.range.min) {
        return {
          ok: false,
          error: `Value below minimum ${field.range.min}`,
        };
      }
      if (field.range?.max != null && value > field.range.max) {
        return {
          ok: false,
          error: `Value above maximum ${field.range.max}`,
        };
      }
      return { ok: true, value };
    }

    case "enum16": {
      const meanings = field.meanings || {};
      if (!Object.keys(meanings).length) {
        return { ok: false, error: "enum16 field missing meanings" };
      }

      if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw.trim()))) {
        const key = String(raw).trim();
        const label = meanings[key];
        if (typeof label !== "string") {
          return { ok: false, error: `Invalid enum key: ${key}` };
        }
        return { ok: true, value: label };
      }

      if (typeof raw === "string") {
        const label = raw.trim();
        const matched = Object.values(meanings).find((candidate) => candidate === label);
        if (!matched) {
          return { ok: false, error: `Invalid enum label: ${label}` };
        }
        return { ok: true, value: matched };
      }

      return { ok: false, error: "Expected enum16 key or label" };
    }

    default:
      return { ok: false, error: "Unsupported field dtype" };
  }
}

function applyArgToSiteConfig(
  config: SiteConfig,
  arg: string,
  value: unknown
): ApplyArgResult | null {
  switch (arg) {
    case "SystemProfile":
      return applySystemProfile(config, mustString(value));
    case "ControllerTimezone":
      return setPath(config, "system.controllerTimezone", mustString(value), "hot");
    case "ControllerIp":
      return setPath(config, "network.controller.ip", mustString(value), "hot");
    case "ModbusServerIp":
      return setPath(config, "network.controller.modbusServer.ip", mustString(value), "hot");
    case "ModbusServerPort":
      return setPath(config, "network.controller.modbusServer.port", mustNumber(value), "hot");

    case "GridCode":
      return applyGridCode(config, mustString(value));

    case "CustomGridProfileJson": {
      const profile = parseCustomGridProfile(mustString(value));
      return setPath(config, "operation.customGridProfile", profile, "hot");
    }

    case "CRDMode":
      return setPath(config, "operation.crdMode", mustString(value), "hot");

    case "SiteExportMode":
      return setPath(config, "operation.siteExportMode", mustString(value), "hot");
    case "SiteExportTargetImportKw":
      return setPath(
        config,
        "operation.siteExportTargetImportKw",
        mustNumber(value),
        "hot"
      );
    case "SiteExportDeadbandKw":
      return setPath(
        config,
        "operation.siteExportDeadbandKw",
        mustNumber(value),
        "hot"
      );

    case "ScheduledControlEnabled": {
      const booleanValue = labelToBoolean(mustString(value));
      return setPath(
        config,
        "operation.scheduledControlEnabled",
        booleanValue,
        "hot"
      );
    }

    case "PcsDaisyChain": {
      ensure280TopologyArg(config, "PcsDaisyChain");
      const chain = parsePositiveIntegerArrayJson(mustString(value));
      if (!config.pcs) {
        config.pcs = {
          pcsDaisyChain: chain,
          maxChargeKw: 0,
          maxDischargeKw: 0,
        };
        return {
          changed: true,
          path: "pcs.pcsDaisyChain",
          classification: "restart",
        };
      }
      return setPath(config, "pcs.pcsDaisyChain", chain, "restart");
    }

    case "SiteMaxChargekW": {
      ensurePcs(config);
      return setPath(config, "pcs.maxChargeKw", mustNumber(value), "hot");
    }

    case "SiteMaxDischargekW": {
      ensurePcs(config);
      return setPath(config, "pcs.maxDischargeKw", mustNumber(value), "hot");
    }

    case "SbmuStrings": {
      ensure280TopologyArg(config, "SbmuStrings");
      const strings = parsePositiveIntegerArrayJson(mustString(value));
      if (!config.mbmu) {
        config.mbmu = { sbmuStrings: strings };
        return {
          changed: true,
          path: "mbmu.sbmuStrings",
          classification: "restart",
        };
      }
      return setPath(config, "mbmu.sbmuStrings", strings, "restart");
    }

    case "ControllerMinSOC":
      return setPath(config, "battery.minSoc", mustNumber(value), "hot");
    case "ControllerMaxSOC":
      return setPath(config, "battery.maxSoc", mustNumber(value), "hot");
    case "ControllerSocLow":
      return setPath(config, "battery.socLow", mustNumber(value), "hot");
    case "ControllerSocLowRecover":
      return setPath(config, "battery.socLowRecover", mustNumber(value), "hot");
    case "ControllerSocHigh":
      return setPath(config, "battery.socHigh", mustNumber(value), "hot");
    case "ControllerSocHighRecover":
      return setPath(config, "battery.socHighRecover", mustNumber(value), "hot");
    case "ForceGridChargeSoc":
      return setPath(config, "battery.forceGridChargeSoc", mustNumber(value), "hot");
    case "ForceGridChargeMinCellVoltageV":
      return setPath(
        config,
        "battery.forceGridChargeMinCellVoltageV",
        mustNumber(value),
        "hot"
      );
    case "ForceGridChargeKw":
      return setPath(config, "battery.forceGridChargeKw", mustNumber(value), "hot");
    case "BatteryPowerHeadroomKw":
      return setPath(config, "battery.powerHeadroomKw", mustNumber(value), "hot");
    case "BatteryCommandRampKwPerSec":
      return setPath(config, "battery.commandRampKwPerSec", mustNumber(value), "hot");

    case "AcInvertersJson": {
      const inverters = parseAcInvertersJson(mustString(value));
      return setPath(config, "pv.acInverters", inverters, "restart");
    }

    case "PvCurtailmentMethod": {
      const mode = mustString(value);
      const mapped = mode === "none" ? null : mode;
      return setPath(config, "pv.curtailmentMethod", mapped, "hot");
    }

    case "IslandingDevice": {
      const mode = mustString(value);
      return applyIslandingDevice(config, mode);
    }

    case "PrimaryMeterModel":
      return setPath(config, "metering.meterType", mustString(value), "restart");
    case "MeterModbusProfile":
      return setPath(config, "metering.modbusProfile", mustString(value), "restart");
    case "MeterIp":
      return setPath(config, "metering.ip", mustString(value), "hot");

    case "ReadsPV":
      return setPath(config, "metering.reads.pv", labelToBoolean(mustString(value)), "hot");
    case "PVFromInverter":
      return setPath(
        config,
        "metering.reads.pvFromInverter",
        labelToBoolean(mustString(value)),
        "hot"
      );
    case "ReadsUtility":
      return setPath(config, "metering.reads.utility", labelToBoolean(mustString(value)), "hot");
    case "ReadsLoad":
      return setPath(config, "metering.reads.load", labelToBoolean(mustString(value)), "hot");

    case "GeneratorMaxkW": {
      ensureGenerator(config);
      return setPath(config, "generator.maxKw", mustNumber(value), "hot");
    }

    case "ChargeFromGenerator": {
      ensureGenerator(config);
      return setPath(
        config,
        "generator.chargeFromGenerator",
        labelToBoolean(mustString(value)),
        "hot"
      );
    }

    case "GeneratorChargekWLimit": {
      ensureGenerator(config);
      return setPath(config, "generator.chargeKwLimit", mustNumber(value), "hot");
    }

    case "GeneratorStartSOC": {
      ensureGenerator(config);
      return setPath(config, "generator.startSoc", mustNumber(value), "hot");
    }

    case "GeneratorStopSOC": {
      ensureGenerator(config);
      return setPath(config, "generator.stopSoc", mustNumber(value), "hot");
    }

    case "GeneratorControlType": {
      ensureGenerator(config);
      return setPath(config, "generator.controlType", mustString(value), "hot");
    }

    default:
      return null;
  }
}

function applySystemProfile(
  config: SiteConfig,
  systemProfile: string
): ApplyArgResult {
  const changed = config.system.systemProfile !== systemProfile;
  config.system.systemProfile = systemProfile;

  const miniModel = parseMiniModel(systemProfile);
  if (miniModel || isNanoModel(systemProfile)) {
    delete config.pcs;
    delete config.mbmu;
  }
  if (miniModel) {
    config.system.nominal.voltageVll = miniModel.voltageVll;
  }

  return {
    changed,
    path: "system.systemProfile",
    classification: "restart",
  };
}

function applyGridCode(config: SiteConfig, gridCode: string): ApplyArgResult {
  const prevGridCode = config.operation.gridCode;
  const hadCustomProfile = !!config.operation.customGridProfile;
  config.operation.gridCode = gridCode as SiteConfig["operation"]["gridCode"];

  if (gridCode !== "Custom") {
    delete config.operation.customGridProfile;
  }

  return {
    changed:
      prevGridCode !== gridCode ||
      (gridCode !== "Custom" && hadCustomProfile),
    path: "operation.gridCode",
    classification: "hot",
  };
}

function applyIslandingDevice(
  config: SiteConfig,
  mode: string
): ApplyArgResult {
  if (mode === "None") {
    const had = !!config.islanding;
    delete config.islanding;
    return {
      changed: had,
      path: "islanding",
      classification: "hot",
    };
  }

  const validDevices = new Set([
    "SEL351",
    "SEL751",
    "SEL851",
    "ASCO-ATS",
    "EATON-ATS",
  ]);
  if (!validDevices.has(mode)) {
    throw new Error("Unsupported islanding device");
  }

  const prev = config.islanding?.device;
  config.islanding = { device: mode as any };
  return {
    changed: prev !== mode,
    path: "islanding.device",
    classification: "hot",
  };
}

function setPath(
  target: any,
  dotPath: string,
  value: unknown,
  classification: ApplyClassification
): ApplyArgResult {
  const segments = dotPath.split(".");
  const leaf = segments.pop() as string;

  let cursor = target;
  for (const segment of segments) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  const prev = cursor[leaf];
  const changed = !isDeepStrictEqual(prev, value);
  cursor[leaf] = value;

  return {
    changed,
    path: dotPath,
    classification,
  };
}

function mustString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string value");
  }
  return value;
}

function mustNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Expected numeric value");
  }
  return parsed;
}

function mustNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function mustPositiveNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be > 0`);
  }
  return parsed;
}

function mustPort(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${label} must be 1..65535`);
  }
  return parsed;
}

function parsePositiveIntegerArrayJson(value: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Expected JSON array");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array");
  }

  const output: number[] = [];
  for (const entry of parsed) {
    const num = Number(entry);
    if (!Number.isInteger(num) || num <= 0) {
      throw new Error("JSON array must contain only positive integers");
    }
    output.push(num);
  }
  return output;
}

function parseAcInvertersJson(value: string): SiteConfig["pv"]["acInverters"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Expected JSON array for AC inverters");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array for AC inverters");
  }

  return parsed.map((entry, index) => normalizeAcInverter(entry, index));
}

function normalizeAcInverter(
  entry: unknown,
  index: number
): SiteConfig["pv"]["acInverters"][number] {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`AC inverter ${index} must be an object`);
  }

  const raw = entry as Record<string, unknown>;
  return {
    ...(raw.id != null
      ? { id: mustNonEmptyString(raw.id, `AC inverter ${index} id`) }
      : {}),
    type: mustNonEmptyString(raw.type, `AC inverter ${index} type`),
    model: mustNonEmptyString(raw.model, `AC inverter ${index} model`),
    ratedKwAc: mustPositiveNumber(
      raw.ratedKwAc,
      `AC inverter ${index} ratedKwAc`
    ),
    ip: mustNonEmptyString(raw.ip, `AC inverter ${index} ip`),
    port: mustPort(raw.port, `AC inverter ${index} port`),
    modbusProfile: mustNonEmptyString(
      raw.modbusProfile,
      `AC inverter ${index} modbusProfile`
    ),
  };
}

function parseCustomGridProfile(value: string): CustomGridProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Expected JSON object for custom grid profile");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object for custom grid profile");
  }

  const profile = parsed as Partial<CustomGridProfile>;
  const requiredKeys: Array<keyof CustomGridProfile> = [
    "gridProfile",
    "voltageRideThrough",
    "frequencyRideThrough",
    "voltVar",
    "freqWatt",
    "voltWatt",
    "rampRates",
    "reconnection",
  ];

  for (const key of requiredKeys) {
    if (!(key in profile)) {
      throw new Error(`custom grid profile missing ${key}`);
    }
  }

  if (typeof profile.gridProfile !== "string" || !profile.gridProfile.trim()) {
    throw new Error("custom grid profile requires gridProfile");
  }
  if (!Array.isArray(profile.voltageRideThrough)) {
    throw new Error("custom grid profile voltageRideThrough must be an array");
  }
  if (!Array.isArray(profile.frequencyRideThrough)) {
    throw new Error("custom grid profile frequencyRideThrough must be an array");
  }

  return profile as CustomGridProfile;
}

function labelToBoolean(label: string): boolean {
  switch (label) {
    case "true":
    case "enable":
      return true;
    case "false":
    case "disable":
      return false;
    default:
      throw new Error(`Unsupported boolean enum label: ${label}`);
  }
}

function ensurePcs(config: SiteConfig) {
  if (config.pcs) return;
  config.pcs = {
    pcsDaisyChain: [],
    maxChargeKw: 0,
    maxDischargeKw: 0,
  };
}

function ensure280TopologyArg(config: SiteConfig, arg: string) {
  if (config.system.systemProfile === "eSpire280") return;
  throw new Error(`${arg} is only valid for eSpire280`);
}

function ensureGenerator(config: SiteConfig) {
  if (config.generator) return;
  config.generator = {
    maxKw: 0,
    chargeFromGenerator: false,
    chargeKwLimit: 0,
    startSoc: 0,
    stopSoc: 0,
    controlType: "RemoteIO",
  };
}

export function validateSiteConfig(config: SiteConfig): SiteConfigValidationIssue[] {
  const issues: SiteConfigValidationIssue[] = [];

  if (!config.system?.systemProfile) {
    issues.push({ path: "system.systemProfile", message: "systemProfile is required" });
  } else if (
    config.system.systemProfile !== "eSpire280" &&
    !parseMiniModel(config.system.systemProfile) &&
    !isNanoModel(config.system.systemProfile)
  ) {
    issues.push({
      path: "system.systemProfile",
      message: "systemProfile must be eSpire280, NANO, or a valid MINI-* profile",
    });
  }
  if (!config.system?.controllerTimezone) {
    issues.push({
      path: "system.controllerTimezone",
      message: "controllerTimezone is required",
    });
  } else if (!isValidTimeZone(config.system.controllerTimezone)) {
    issues.push({
      path: "system.controllerTimezone",
      message: "controllerTimezone must be a valid IANA timezone",
    });
  }

  if (!config.network?.controller?.ip) {
    issues.push({ path: "network.controller.ip", message: "controller.ip is required" });
  }

  const mbPort = config.network?.controller?.modbusServer?.port;
  if (!Number.isFinite(mbPort) || mbPort < 1 || mbPort > 65535) {
    issues.push({
      path: "network.controller.modbusServer.port",
      message: "modbusServer port must be 1..65535",
    });
  }
  for (let index = 0; index < (config.network?.serverSlots || []).length; index++) {
    const slot = config.network!.serverSlots![index];
    const basePath = `network.serverSlots.${index}`;
    if (!slot.key) {
      issues.push({ path: `${basePath}.key`, message: "server slot key is required" });
    }
    if (!slot.ip) {
      issues.push({ path: `${basePath}.ip`, message: "server slot ip is required" });
    }
    if (!Number.isInteger(slot.port) || slot.port < 1 || slot.port > 65535) {
      issues.push({ path: `${basePath}.port`, message: "server slot port must be 1..65535" });
    }
  }
  const serverSlotKeys = new Set(
    (config.network?.serverSlots || []).map((slot) => slot.key).filter(Boolean)
  );
  for (let index = 0; index < (config.network?.assets || []).length; index++) {
    const asset = config.network!.assets![index];
    const basePath = `network.assets.${index}`;
    if (!asset.id) {
      issues.push({ path: `${basePath}.id`, message: "asset id is required" });
    }
    if (!asset.role) {
      issues.push({ path: `${basePath}.role`, message: "asset role is required" });
    }
    if (!asset.ip) {
      issues.push({ path: `${basePath}.ip`, message: "asset ip is required" });
    }
    if (!Number.isInteger(asset.port) || asset.port < 1 || asset.port > 65535) {
      issues.push({ path: `${basePath}.port`, message: "asset port must be 1..65535" });
    }
    if (!Number.isInteger(asset.unitId) || asset.unitId < 1 || asset.unitId > 247) {
      issues.push({ path: `${basePath}.unitId`, message: "asset unitId must be 1..247" });
    }
    if (asset.serverSlot && serverSlotKeys.size && !serverSlotKeys.has(asset.serverSlot)) {
      issues.push({
        path: `${basePath}.serverSlot`,
        message: "asset serverSlot must reference network.serverSlots",
      });
    }
  }

  const validGridCodes = new Set([
    "IEEE1547-2018",
    "Rule21",
    "Rule14H",
    "PREPA-MTR",
    "Ontario-ESA",
    "ISO",
    "Custom",
  ]);
  if (!validGridCodes.has(config.operation.gridCode)) {
    issues.push({ path: "operation.gridCode", message: "unsupported gridCode" });
  }

  const validCrdModes = new Set([
    "no-restriction",
    "no-import",
    "no-export",
    "no-exchange",
  ]);
  if (!validCrdModes.has(config.operation.crdMode)) {
    issues.push({ path: "operation.crdMode", message: "unsupported CRD mode" });
  }

  const validSiteExportModes = new Set([
    "no-restriction",
    "no-export",
    undefined,
  ]);
  if (!validSiteExportModes.has(config.operation.siteExportMode)) {
    issues.push({
      path: "operation.siteExportMode",
      message: "unsupported site export mode",
    });
  }
  if (
    config.operation.siteExportTargetImportKw != null &&
    (!Number.isFinite(config.operation.siteExportTargetImportKw) ||
      config.operation.siteExportTargetImportKw < 0)
  ) {
    issues.push({
      path: "operation.siteExportTargetImportKw",
      message: "siteExportTargetImportKw must be >= 0",
    });
  }
  if (
    config.operation.siteExportDeadbandKw != null &&
    (!Number.isFinite(config.operation.siteExportDeadbandKw) ||
      config.operation.siteExportDeadbandKw < 0)
  ) {
    issues.push({
      path: "operation.siteExportDeadbandKw",
      message: "siteExportDeadbandKw must be >= 0",
    });
  }

  if (config.operation.gridCode === "Custom" && !config.operation.customGridProfile) {
    issues.push({
      path: "operation.customGridProfile",
      message: "customGridProfile required when gridCode=Custom",
    });
  }
  if (
    config.operation.gridCode !== "Custom" &&
    config.operation.customGridProfile
  ) {
    issues.push({
      path: "operation.customGridProfile",
      message: "customGridProfile is only valid when gridCode=Custom",
    });
  }

  if (!Number.isFinite(config.battery.minSoc) || config.battery.minSoc < 0 || config.battery.minSoc > 1) {
    issues.push({ path: "battery.minSoc", message: "minSoc must be between 0 and 1" });
  }
  if (!Number.isFinite(config.battery.maxSoc) || config.battery.maxSoc < 0 || config.battery.maxSoc > 1) {
    issues.push({ path: "battery.maxSoc", message: "maxSoc must be between 0 and 1" });
  }
  if (config.battery.minSoc > config.battery.maxSoc) {
    issues.push({ path: "battery", message: "minSoc must be <= maxSoc" });
  }
  validateOptionalFraction(config.battery.socLow, "battery.socLow", issues);
  validateOptionalFraction(
    config.battery.socLowRecover,
    "battery.socLowRecover",
    issues
  );
  validateOptionalFraction(config.battery.socHigh, "battery.socHigh", issues);
  validateOptionalFraction(
    config.battery.socHighRecover,
    "battery.socHighRecover",
    issues
  );
  validateOptionalFraction(
    config.battery.forceGridChargeSoc,
    "battery.forceGridChargeSoc",
    issues
  );
  validateOptionalNonNegativeNumber(
    config.battery.forceGridChargeMinCellVoltageV,
    "battery.forceGridChargeMinCellVoltageV",
    issues
  );
  validateOptionalNonNegativeNumber(
    config.battery.forceGridChargeKw,
    "battery.forceGridChargeKw",
    issues
  );
  validateOptionalNonNegativeNumber(
    config.battery.powerHeadroomKw,
    "battery.powerHeadroomKw",
    issues
  );
  validateOptionalNonNegativeNumber(
    config.battery.commandRampKwPerSec,
    "battery.commandRampKwPerSec",
    issues
  );
  validateCellVoltagePolicy(config.battery.cellVoltagePolicy, issues);

  if (config.system.systemProfile === "eSpire280") {
    if (!config.pcs) {
      issues.push({ path: "pcs", message: "pcs required for eSpire280" });
    } else {
      validatePositiveIntegerArray(
        config.pcs.pcsDaisyChain,
        "pcs.pcsDaisyChain",
        "pcsDaisyChain must contain positive integer PCS counts",
        issues
      );
    }
    if (!config.mbmu) {
      issues.push({ path: "mbmu", message: "mbmu required for eSpire280" });
    } else {
      validatePositiveIntegerArray(
        config.mbmu.sbmuStrings,
        "mbmu.sbmuStrings",
        "sbmuStrings must contain positive integer string counts",
        issues
      );
    }
  }

  if (parseMiniModel(config.system.systemProfile)) {
    if (config.mbmu) {
      issues.push({
        path: "mbmu",
        message: "mbmu topology is only valid for eSpire280",
      });
    }
    if ((config.pcs?.pcsDaisyChain || []).length > 0) {
      issues.push({
        path: "pcs.pcsDaisyChain",
        message: "pcsDaisyChain is only valid for eSpire280",
      });
    }
  }

  if (config.pcs) {
    if (!Number.isFinite(config.pcs.maxChargeKw) || config.pcs.maxChargeKw < 0) {
      issues.push({
        path: "pcs.maxChargeKw",
        message: "maxChargeKw must be >= 0",
      });
    }
    if (
      !Number.isFinite(config.pcs.maxDischargeKw) ||
      config.pcs.maxDischargeKw < 0
    ) {
      issues.push({
        path: "pcs.maxDischargeKw",
        message: "maxDischargeKw must be >= 0",
      });
    }
  }

  for (let index = 0; index < (config.pv?.acInverters || []).length; index++) {
    const inverter = config.pv.acInverters[index];
    const basePath = `pv.acInverters.${index}`;
    if (!inverter.type) {
      issues.push({ path: `${basePath}.type`, message: "type is required" });
    }
    if (!inverter.model) {
      issues.push({ path: `${basePath}.model`, message: "model is required" });
    }
    if (!Number.isFinite(inverter.ratedKwAc) || inverter.ratedKwAc <= 0) {
      issues.push({
        path: `${basePath}.ratedKwAc`,
        message: "ratedKwAc must be > 0",
      });
    }
    if (!inverter.ip) {
      issues.push({ path: `${basePath}.ip`, message: "ip is required" });
    }
    if (
      !Number.isInteger(inverter.port) ||
      inverter.port < 1 ||
      inverter.port > 65535
    ) {
      issues.push({ path: `${basePath}.port`, message: "port must be 1..65535" });
    }
    if (!inverter.modbusProfile) {
      issues.push({
        path: `${basePath}.modbusProfile`,
        message: "modbusProfile is required",
      });
    }
  }

  const validPvCurtailment = new Set([
    "modbus",
    "frequency-shifting",
    null,
    undefined,
  ]);
  if (!validPvCurtailment.has(config.pv?.curtailmentMethod)) {
    issues.push({
      path: "pv.curtailmentMethod",
      message: "unsupported PV curtailment method",
    });
  }

  if (config.islanding) {
    const validIslandingDevices = new Set([
      "SEL351",
      "SEL751",
      "SEL851",
      "ASCO-ATS",
      "EATON-ATS",
    ]);
    if (!validIslandingDevices.has(config.islanding.device)) {
      issues.push({
        path: "islanding.device",
        message: "unsupported islanding device",
      });
    }
  }

  const configuredMeters = Array.isArray(config.metering?.meters)
    ? config.metering.meters
    : [];
  if (!config.metering?.meterType && configuredMeters.length === 0) {
    issues.push({ path: "metering.meterType", message: "meterType is required" });
  }
  if (!config.metering?.modbusProfile && configuredMeters.length === 0) {
    issues.push({
      path: "metering.modbusProfile",
      message: "metering.modbusProfile is required",
    });
  }
  if (!config.metering?.ip && configuredMeters.length === 0) {
    issues.push({ path: "metering.ip", message: "metering.ip is required" });
  }
  if (!config.metering?.reads) {
    issues.push({ path: "metering.reads", message: "metering reads are required" });
  } else {
    for (const key of ["pv", "pvFromInverter", "utility", "load"] as const) {
      if (typeof config.metering.reads[key] !== "boolean") {
        issues.push({
          path: `metering.reads.${key}`,
          message: `${key} read flag must be boolean`,
        });
      }
    }
    if (config.metering.reads.pv && config.metering.reads.pvFromInverter) {
      issues.push({
        path: "metering.reads",
        message: "PV can be sourced from meter or inverter, not both",
      });
    }
  }
  configuredMeters.forEach((meter, meterIndex) => {
    const base = `metering.meters.${meterIndex}`;
    if (!meter?.id || typeof meter.id !== "string") {
      issues.push({ path: `${base}.id`, message: "meter id is required" });
    }
    if (!meter?.meterType || typeof meter.meterType !== "string") {
      issues.push({ path: `${base}.meterType`, message: "meterType is required" });
    }
    if (!meter?.ip || typeof meter.ip !== "string") {
      issues.push({ path: `${base}.ip`, message: "meter ip is required" });
    }
    if (meter.port !== undefined && (!Number.isInteger(meter.port) || meter.port < 1 || meter.port > 65535)) {
      issues.push({ path: `${base}.port`, message: "port must be between 1 and 65535" });
    }
    if (meter.unitId !== undefined && (!Number.isInteger(meter.unitId) || meter.unitId < 1 || meter.unitId > 247)) {
      issues.push({ path: `${base}.unitId`, message: "unitId must be between 1 and 247" });
    }
    if (!Array.isArray(meter.registerMap) || meter.registerMap.length === 0) {
      issues.push({ path: `${base}.registerMap`, message: "registerMap must have at least one row" });
      return;
    }
    meter.registerMap.forEach((row, rowIndex) => {
      const rowBase = `${base}.registerMap.${rowIndex}`;
      if (!row?.signal || typeof row.signal !== "string") {
        issues.push({ path: `${rowBase}.signal`, message: "signal is required" });
      }
      if (!Number.isInteger(row?.register) || row.register < 0) {
        issues.push({ path: `${rowBase}.register`, message: "register must be a non-negative integer" });
      }
      if (!row?.function || typeof row.function !== "string") {
        issues.push({ path: `${rowBase}.function`, message: "function is required" });
      }
      if (row.scale !== undefined && !Number.isFinite(row.scale)) {
        issues.push({ path: `${rowBase}.scale`, message: "scale must be a number" });
      }
    });
  });

  if (config.generator) {
    if (!Number.isFinite(config.generator.maxKw) || config.generator.maxKw < 0) {
      issues.push({ path: "generator.maxKw", message: "maxKw must be >= 0" });
    }
    if (
      !Number.isFinite(config.generator.chargeKwLimit) ||
      config.generator.chargeKwLimit < 0
    ) {
      issues.push({
        path: "generator.chargeKwLimit",
        message: "chargeKwLimit must be >= 0",
      });
    }
    if (config.generator.startSoc < 0 || config.generator.startSoc > 1) {
      issues.push({ path: "generator.startSoc", message: "startSoc must be between 0 and 1" });
    }
    if (config.generator.stopSoc < 0 || config.generator.stopSoc > 1) {
      issues.push({ path: "generator.stopSoc", message: "stopSoc must be between 0 and 1" });
    }
    if (config.generator.startSoc >= config.generator.stopSoc) {
      issues.push({
        path: "generator",
        message: "startSoc must be < stopSoc",
      });
    }
    if (
      config.generator.controlType !== "RemoteIO" &&
      config.generator.controlType !== "SEL"
    ) {
      issues.push({
        path: "generator.controlType",
        message: "unsupported generator control type",
      });
    }
  }

  return issues;
}

function validatePositiveIntegerArray(
  value: unknown,
  path: string,
  message: string,
  issues: SiteConfigValidationIssue[]
) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => !Number.isInteger(entry) || entry <= 0)
  ) {
    issues.push({ path, message });
  }
}

function validateOptionalFraction(
  value: unknown,
  path: string,
  issues: SiteConfigValidationIssue[]
) {
  if (value == null) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    issues.push({ path, message: `${path} must be between 0 and 1` });
  }
}

function validateOptionalNonNegativeNumber(
  value: unknown,
  path: string,
  issues: SiteConfigValidationIssue[]
) {
  if (value == null) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    issues.push({ path, message: `${path} must be >= 0` });
  }
}

function validateCellVoltagePolicy(
  value: SiteConfig["battery"]["cellVoltagePolicy"],
  issues: SiteConfigValidationIssue[]
) {
  if (!value) return;
  const basePath = "battery.cellVoltagePolicy";
  const numericFields = [
    "maxCellVoltageChargeBlockV",
    "maxCellVoltageChargeRecoverV",
    "minCellVoltageDischargeBlockV",
    "minCellVoltageDischargeRecoverV",
    "chargeTaperStartV",
    "chargeTaperEndV",
  ] as const;

  for (const field of numericFields) {
    const fieldValue = value[field];
    if (fieldValue == null) continue;
    if (!Number.isFinite(Number(fieldValue)) || Number(fieldValue) <= 0) {
      issues.push({
        path: `${basePath}.${field}`,
        message: `${field} must be a positive voltage`,
      });
    }
  }

  const minFraction = value.chargeTaperMinFraction;
  if (
    minFraction != null &&
    (!Number.isFinite(Number(minFraction)) ||
      Number(minFraction) < 0 ||
      Number(minFraction) > 1)
  ) {
    issues.push({
      path: `${basePath}.chargeTaperMinFraction`,
      message: "chargeTaperMinFraction must be between 0 and 1",
    });
  }

  if (
    value.maxCellVoltageChargeBlockV != null &&
    value.maxCellVoltageChargeRecoverV != null &&
    value.maxCellVoltageChargeRecoverV > value.maxCellVoltageChargeBlockV
  ) {
    issues.push({
      path: basePath,
      message: "maxCellVoltageChargeRecoverV must be <= maxCellVoltageChargeBlockV",
    });
  }
  if (
    value.minCellVoltageDischargeBlockV != null &&
    value.minCellVoltageDischargeRecoverV != null &&
    value.minCellVoltageDischargeRecoverV < value.minCellVoltageDischargeBlockV
  ) {
    issues.push({
      path: basePath,
      message: "minCellVoltageDischargeRecoverV must be >= minCellVoltageDischargeBlockV",
    });
  }
  if (
    value.chargeTaperStartV != null &&
    value.chargeTaperEndV != null &&
    value.chargeTaperStartV >= value.chargeTaperEndV
  ) {
    issues.push({
      path: basePath,
      message: "chargeTaperStartV must be < chargeTaperEndV",
    });
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
