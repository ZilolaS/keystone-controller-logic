import {
  resolveTelemetryTemplate,
  type TelemetryTemplateDocument,
  type TelemetryTemplateEntry,
} from "./templateAdapter";
import type { SignalMappingConfig } from "../config";
import { evaluateSignalMapping } from "../coreControl/signalMapping";

export interface Ss40kEquipmentConfigEntry {
  profileName: string;
  route?: string;
  template?: TelemetryTemplateDocument;
}

export type Ss40kEquipmentConfig = Record<
  string,
  Ss40kEquipmentConfigEntry | string
>;

export interface Ss40kLookupEntry {
  equipment: string;
  sourceTagID: string;
  profileName: string;
  name: string;
  model: string;
  modelIndex: string;
  exportMultiplier: number;
  exportExpr?: string;
}

export interface Ss40kBuildLookupResult {
  lookup: Record<string, Ss40kLookupEntry>;
  equipmentToProfile: Record<string, string>;
  routeMap: Record<string, string>;
  modelIndexMap: Record<string, string>;
}

export interface Ss40kTelemetrySample {
  tagID: string;
  value: unknown;
  timestamp?: string | number | Date | null;
  [key: string]: unknown;
}

export type Ss40kTelemetryStore = Record<
  string,
  Ss40kTelemetrySample[] | undefined
>;

export interface Ss40kBuildPayloadOptions {
  lookup: Record<string, Ss40kLookupEntry>;
  telemetry: Ss40kTelemetryStore;
  topic: string;
  version?: string;
  fixedSerialNumber?: string;
  signalMapping?: SignalMappingConfig;
  mergeByModelIndex?: boolean;
  merge40kByModelIndex?: boolean;
  energyAccumulator?: Ss40kEnergyAccumulatorOptions;
  maxSampleAgeMs?: number;
  nowMs?: number;
}

export interface Ss40kPayloadMeta {
  equipment: string;
  model: string;
  modelIndex: string;
  timestamp: string | null;
  pointCount: number;
}

export interface Ss40kPayloadMessage {
  topic: string;
  payload: Record<
    string,
    {
      fixed: Record<string, unknown>;
      id: number;
      version: string;
    }
  >;
  ss40k: Ss40kPayloadMeta;
}

export interface Ss40kEnergyAccumulatorState {
  counters?: Record<string, number>;
  lastRaw?: Record<string, number>;
  lastGoodEnergyTotals?: Record<string, number>;
  daily?: {
    dateKey?: string;
    baselines?: Record<string, number>;
  };
  lastMs?: number | null;
  updatedAt?: string;
  lastInputs?: Record<string, unknown>;
  energyTotalGuards?: Record<string, unknown>;
}

export interface Ss40kEnergyAccumulatorSourceTags {
  utilityNetKwh?: string;
  acCoupledPvKwh?: string;
  generatorKwh?: string;
  batteryPowerKw?: string | string[];
}

export interface Ss40kEnergyAccumulatorOptions {
  enabled?: boolean;
  state?: Ss40kEnergyAccumulatorState;
  nowMs?: number;
  maxGapMs?: number;
  timezone?: string;
  dailyEnabled?: boolean;
  outputMultiplier?: number;
  sourceTagIDs?: Ss40kEnergyAccumulatorSourceTags;
}

type Ss40kPayloadGroup = {
  equipment: string;
  model: string;
  modelIndex: string;
  version: string;
  latestTimestamp: string | null;
  fixed: Record<string, unknown>;
};

export const DEFAULT_SS40K_MODEL_INDEX_MAP: Record<string, string> = {
  "40100": "0",
  "40101": "0",
  "40102": "0",
  "40103": "0",
  "40104": "10",
  "40200": "0",
  "40201": "0",
  "40204": "0",
  "40211": "0",
  "40214": "0",
  "42100": "0",
  "42101": "0",
  "42103": "0",
  "42104": "0",
  "50103": "0",
  "52103": "0",
};

const SS40K_KW_TO_W_POINTS = new Set([
  "pGridImpTot",
  "pGridExpTot",
  "pGridL1",
  "pGridL2",
  "pGridL3",
  "pLoad",
  "pLoadL1",
  "pLoadL2",
  "pLoadL3",
  "pBkupTot",
  "pPvTotal",
  "pAcCplTot",
  "pMppt1",
  "pMppt2",
  "pMppt3",
  "pBatChg",
  "pBatDischg",
]);

const SS40K_40102_DIRECT_POINTS = new Set([
  "ePvTdy",
  "ePvTot",
  "eAcCplTdy",
  "eAcCplTot",
  "eGridImpTdy",
  "eGridImpTot",
  "eGridExpTdy",
  "eGridExpTot",
  "eLoadTdy",
  "eLoadTot",
  "eGenTot",
  "eBkupTdy",
  "eBkupTot",
  "eBatChgTdy",
  "eBatChgTot",
  "eBatDischgTdy",
  "eBatDischgTot",
]);

const SS40K_DAILY_ENERGY_POINTS: Record<string, string> = {
  ePvTot: "ePvTdy",
  eAcCplTot: "eAcCplTdy",
  eGridImpTot: "eGridImpTdy",
  eGridExpTot: "eGridExpTdy",
  eLoadTot: "eLoadTdy",
  eGenTot: "eGenTdy",
  eBkupTot: "eBkupTdy",
  eBatChgTot: "eBatChgTdy",
  eBatDischgTot: "eBatDischgTdy",
};

export function buildSs40kLookup(
  equipmentConfig: Ss40kEquipmentConfig,
  modelIndexMap: Record<string, string> = DEFAULT_SS40K_MODEL_INDEX_MAP
): Ss40kBuildLookupResult {
  const templateCache: Record<string, TelemetryTemplateDocument> = {};
  const lookup: Record<string, Ss40kLookupEntry> = {};
  const equipmentToProfile: Record<string, string> = {};
  const routeMap: Record<string, string> = {};

  for (const [equipment, rawConfig] of Object.entries(equipmentConfig)) {
    const cfg = normalizeEquipmentConfigEntry(rawConfig);
    equipmentToProfile[equipment] = cfg.profileName;
    if (cfg.route) {
      routeMap[equipment] = cfg.route;
    }

    let template = cfg.template || templateCache[cfg.profileName];
    if (!template) {
      template = resolveTelemetryTemplate(cfg.profileName);
      templateCache[cfg.profileName] = template;
    }

    const telemetryEntries = Array.isArray(template.telemetry)
      ? template.telemetry
      : [];
    for (const entry of telemetryEntries) {
      const lookupEntry = toLookupEntry(equipment, cfg.profileName, entry, modelIndexMap);
      if (!lookupEntry) continue;
      const lookupKey = lookup[lookupEntry.sourceTagID]
        ? `${lookupEntry.sourceTagID}#${lookupEntry.model}.${lookupEntry.name}`
        : lookupEntry.sourceTagID;
      lookup[lookupKey] = lookupEntry;
    }
  }

  return {
    lookup,
    equipmentToProfile,
    routeMap,
    modelIndexMap: { ...modelIndexMap },
  };
}

export function buildSs40kFixedPayloads(
  options: Ss40kBuildPayloadOptions
): Ss40kPayloadMessage[] {
  const {
    lookup,
    telemetry: rawTelemetry,
    topic,
    version = "3.0",
    fixedSerialNumber,
    signalMapping,
    mergeByModelIndex = false,
    merge40kByModelIndex = false,
  } = options;
  const telemetry = filterTelemetryBySampleAge(
    rawTelemetry,
    options.maxSampleAgeMs,
    options.nowMs
  );
  const groups: Record<string, Ss40kPayloadGroup> = {};

  for (const [equipment, samples] of Object.entries(telemetry || {})) {
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (!sample || typeof sample.tagID !== "string" || !sample.tagID) continue;
      const metas = lookupEntriesForSourceTag(lookup, sample.tagID);
      if (!metas.length) continue;

      for (const meta of metas) {
        const shouldMergeByModelIndex =
          mergeByModelIndex ||
          (merge40kByModelIndex &&
            (meta.model.startsWith("40") || meta.model === "50103"));
        const groupKey = shouldMergeByModelIndex
          ? `${meta.modelIndex}::${meta.model}`
          : `${meta.equipment}::${meta.model}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            equipment: shouldMergeByModelIndex ? "site" : meta.equipment,
            model: meta.model,
            modelIndex: meta.modelIndex,
            version,
            latestTimestamp: null,
            fixed: {
              ID: Number(meta.model),
            },
          };
        }

        const exportValue =
          meta.exportExpr && meta.name !== "SN"
            ? evaluateExportExpr(meta.exportExpr, sample.value)
            : sample.value;
        const fixedValue =
          meta.name === "SN"
            ? normalizeSerialNumber(exportValue)
            : toFixedValue(exportValue, meta.exportMultiplier);
        setFixedValue(groups[groupKey].fixed, meta.name, fixedValue);

        const iso = toIsoTimestamp(sample.timestamp);
        if (iso && (!groups[groupKey].latestTimestamp || iso > groups[groupKey].latestTimestamp)) {
          groups[groupKey].latestTimestamp = iso;
        }
      }
    }
  }

  applySiteSignalOverrides(groups, telemetry, signalMapping, version);
  applyEnergyAccumulatorOverrides(groups, telemetry, version, options.energyAccumulator);
  applyDailyEnergyOverrides(groups, version, options.energyAccumulator);
  applyPerEquipmentIdentity(groups, lookup, telemetry);
  applyFixedSerialNumberToSystemModels(
    groups,
    fixedSerialNumber || findSystemSerialNumber(lookup, telemetry)
  );

  return Object.values(groups)
    .sort((a, b) =>
      `${a.equipment}.${a.model}`.localeCompare(`${b.equipment}.${b.model}`)
    )
    .map((group) => ({
      topic,
      payload: {
        [group.modelIndex]: {
          fixed: group.fixed,
          id: Number(group.model),
          version: group.version,
        },
      },
      ss40k: {
        equipment: group.equipment,
        model: group.model,
        modelIndex: group.modelIndex,
        timestamp: group.latestTimestamp,
        pointCount: Object.keys(group.fixed).length,
      },
    }));
}

function filterTelemetryBySampleAge(
  telemetry: Ss40kTelemetryStore,
  maxSampleAgeMs: number | undefined,
  nowMs: number | undefined
): Ss40kTelemetryStore {
  const maxAge = finitePositiveNumber(maxSampleAgeMs);
  if (maxAge === null) return telemetry;

  const now = finitePositiveNumber(nowMs) ?? Date.now();
  const filtered: Ss40kTelemetryStore = {};
  for (const [equipment, samples] of Object.entries(telemetry || {})) {
    if (!Array.isArray(samples)) continue;
    const freshSamples = samples.filter((sample) => {
      const timestampMs = timestampToMs(sample?.timestamp);
      return timestampMs !== null && now - timestampMs <= maxAge;
    });
    if (freshSamples.length) filtered[equipment] = freshSamples;
  }
  return filtered;
}

function timestampToMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function finitePositiveNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function setFixedValue(
  fixed: Record<string, unknown>,
  name: string,
  value: unknown
) {
  const existing = fixed[name];
  if (
    name === "pPvTotal" &&
    typeof existing === "number" &&
    Number.isFinite(existing) &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    fixed[name] = existing + value;
    return;
  }
  fixed[name] = value;
}

function applyFixedSerialNumberToSystemModels(
  groups: Record<string, { model: string; fixed: Record<string, unknown> }>,
  serialNumber: string | null
) {
  if (!serialNumber) return;
  for (const group of Object.values(groups)) {
    if (!group.model.startsWith("40") && group.model !== "50103") continue;
    group.fixed.SN = serialNumber;
  }
}

function lookupEntriesForSourceTag(
  lookup: Record<string, Ss40kLookupEntry>,
  sourceTagID: string
): Ss40kLookupEntry[] {
  const direct = lookup[sourceTagID];
  const duplicates = Object.entries(lookup)
    .filter(([key, value]) => key !== sourceTagID && value.sourceTagID === sourceTagID)
    .map(([, value]) => value);
  return direct ? [direct, ...duplicates] : duplicates;
}

function applyPerEquipmentIdentity(
  groups: Record<
    string,
    { equipment: string; model: string; fixed: Record<string, unknown> }
  >,
  lookup: Record<string, Ss40kLookupEntry>,
  telemetry: Ss40kTelemetryStore
) {
  const identityByEquipment = findIdentityByEquipment(lookup, telemetry);
  for (const group of Object.values(groups)) {
    if (!group.model.startsWith("42") && !group.model.startsWith("52")) continue;
    const identity = identityByEquipment[group.equipment];
    if (!identity) continue;
    if (identity.SN) group.fixed.SN = identity.SN;
    if (identity.Md) group.fixed.Md = identity.Md;
  }
}

function findIdentityByEquipment(
  lookup: Record<string, Ss40kLookupEntry>,
  telemetry: Ss40kTelemetryStore
): Record<string, { SN?: string; Md?: unknown }> {
  const out: Record<string, { SN?: string; Md?: unknown }> = {};
  for (const samples of Object.values(telemetry || {})) {
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (!sample || typeof sample.tagID !== "string") continue;
      const meta = lookup[sample.tagID];
      if (!meta || (!meta.model.startsWith("42") && !meta.model.startsWith("52"))) continue;
      const identity = (out[meta.equipment] ||= {});
      if (meta.name === "SN") {
        const serial = normalizeSerialNumber(sample.value);
        if (serial) identity.SN = serial;
      } else if (meta.name === "Md") {
        identity.Md = toFixedValue(sample.value, meta.exportMultiplier);
      }
    }
  }
  return out;
}

function findSystemSerialNumber(
  lookup: Record<string, Ss40kLookupEntry>,
  telemetry: Ss40kTelemetryStore
): string | null {
  const candidates: string[] = [];
  for (const samples of Object.values(telemetry || {})) {
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (!sample || typeof sample.tagID !== "string") continue;
      const meta = lookup[sample.tagID];
      const is40kSerial = meta?.name === "SN" && meta.model.startsWith("40");
      const isPcsSerial = /^PCS\.Serial(Number)?$/i.test(sample.tagID);
      if (!is40kSerial && !isPcsSerial) continue;
      const serial = normalizeSerialNumber(sample.value);
      if (!serial) continue;
      if (isPcsSerial) return serial;
      candidates.push(serial);
    }
  }
  return candidates[0] || null;
}

function normalizeSerialNumber(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function applySiteSignalOverrides(
  groups: Record<string, Ss40kPayloadGroup>,
  telemetry: Ss40kTelemetryStore,
  signalMapping: SignalMappingConfig | undefined,
  version: string
) {
  if (!signalMapping?.signals && !signalMapping?.ss40k) return;

  const result = evaluateSignalMapping(signalMapping, telemetry);
  const signals = result.signals;
  let fixed40101 = to40101FixedTargets(groups);
  if (!fixed40101.length && hasSitePowerSignals(signals)) {
    fixed40101 = [ensureGroupForModel(groups, "40101", version).fixed];
  }

  if (fixed40101.length) {
    const setAll = (name: string, value: unknown) => {
      for (const fixed of fixed40101) fixed[name] = value;
    };

    const pvKw = firstFiniteSignal(signals, "pvPowerKw", "pvKw");
    if (pvKw !== null) setAll("pPvTotal", Math.round(pvKw * 1000));

    const utilityPowerKw = firstFiniteSignal(signals, "gridPowerKw", "utilityPowerKw");
    if (utilityPowerKw !== null) {
      setAll("pGridImpTot", Math.round(Math.max(utilityPowerKw, 0) * 1000));
      setAll("pGridExpTot", Math.round(Math.max(-utilityPowerKw, 0) * 1000));
    }

    const siteLoadKw = firstFiniteSignal(signals, "loadPowerKw", "siteLoadKw");
    if (siteLoadKw !== null) setAll("pLoad", Math.round(siteLoadKw * 1000));

    const backupLoadKw = finiteNumber(signals.backupLoadKw);
    if (backupLoadKw !== null) setAll("pBkupTot", Math.round(backupLoadKw * 1000));

    const batteryPowerKw = finiteNumber(signals.batteryPowerKw);
    if (batteryPowerKw !== null) {
      setAll("pBatDischg", Math.round(Math.max(batteryPowerKw, 0) * 1000));
      setAll("pBatChg", Math.round(Math.max(-batteryPowerKw, 0) * 1000));
    }
  }

  applyDirectSs40kOverrides(groups, telemetry, signalMapping, version);
}

function hasSitePowerSignals(
  signals: Partial<Record<string, unknown>>
): boolean {
  return [
    "pvPowerKw",
    "pvKw",
    "gridPowerKw",
    "utilityPowerKw",
    "loadPowerKw",
    "siteLoadKw",
    "backupLoadKw",
    "batteryPowerKw",
  ].some((key) => finiteNumber(signals[key]) !== null);
}

function firstFiniteSignal(
  signals: Partial<Record<string, unknown>>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = finiteNumber(signals[key]);
    if (value !== null) return value;
  }
  return null;
}

function applyDirectSs40kOverrides(
  groups: Record<string, Ss40kPayloadGroup>,
  telemetry: Ss40kTelemetryStore,
  signalMapping: SignalMappingConfig,
  version: string
) {
  if (!signalMapping.ss40k) return;
  const scope = buildTelemetryExpressionScope(telemetry);
  for (const [point, spec] of Object.entries(signalMapping.ss40k)) {
    if (!point || !spec?.expr) continue;
    try {
      const value = evaluateMappingExpr(spec.expr, scope);
      const numeric = finiteNumber(value);
      if (numeric === null) continue;
      const signed = spec.invertSign ? -numeric : numeric;
      const fixedValue = SS40K_KW_TO_W_POINTS.has(point)
        ? Math.round(signed * 1000)
        : signed;
      const model = ss40kDirectModelForPoint(point, spec.model);
      for (const fixed of toDirectFixedTargets(groups, model, version, spec.modelIndex)) {
        fixed[point] = fixedValue;
      }
    } catch {
      continue;
    }
  }
}

function ss40kDirectModelForPoint(point: string, model?: string): string {
  if (model && /^40\d{3}$/.test(model)) return model;
  return SS40K_40102_DIRECT_POINTS.has(point) ? "40102" : "40101";
}

function buildTelemetryExpressionScope(
  telemetry: Ss40kTelemetryStore
): Record<string, Record<string, unknown>> {
  const roots: Record<string, Record<string, unknown>> = {};
  const put = (tagID: string, value: unknown) => {
    const parts = String(tagID).split(".");
    if (parts.length < 2) return;
    const root = parts.shift()!;
    const leaf = parts.join(".");
    roots[root] = roots[root] || {};
    roots[root][leaf] = value;
  };

  for (const [key, samples] of Object.entries(telemetry || {})) {
    if (Array.isArray(samples)) {
      for (const sample of samples) {
        if (sample?.tagID) put(sample.tagID, sample.value);
      }
    } else if (key.includes(".")) {
      put(key, samples);
    }
  }
  return roots;
}

function evaluateMappingExpr(
  expr: string,
  scope: Record<string, Record<string, unknown>>
): unknown {
  const deadband = (value: unknown, threshold: unknown) => {
    const numeric = Number(value);
    const limit = Math.abs(Number(threshold) || 0);
    return Math.abs(numeric || 0) < limit ? 0 : numeric;
  };
  const names = Object.keys(scope).concat([
    "deadband",
    "max",
    "min",
    "abs",
    "round",
    "Math",
  ]);
  const values: unknown[] = Object.keys(scope).map((name) => scope[name]);
  values.push(deadband, Math.max, Math.min, Math.abs, Math.round, Math);
  const fn = new Function(
    ...names,
    `"use strict"; return (${expr});`
  ) as (...args: unknown[]) => unknown;
  return fn(...values);
}

function to40101FixedTargets(
  groups: Record<string, { model: string; fixed: Record<string, unknown> }>
): Record<string, unknown>[] {
  return Object.values(groups)
    .filter((group) => group.model === "40101")
    .map((group) => group.fixed);
}

function toDirectFixedTargets(
  groups: Record<string, Ss40kPayloadGroup>,
  model: string,
  version: string,
  configuredModelIndex?: string
): Record<string, unknown>[] {
  const existing = Object.values(groups).filter((group) => group.model === model);
  if (existing.length) return existing.map((group) => group.fixed);

  const modelIndex = configuredModelIndex || DEFAULT_SS40K_MODEL_INDEX_MAP[model] || "0";
  const key = `${modelIndex}::${model}`;
  groups[key] = {
    equipment: "site",
    model,
    modelIndex,
    version,
    latestTimestamp: null,
    fixed: { ID: Number(model) },
  };
  return [groups[key].fixed];
}

function applyEnergyAccumulatorOverrides(
  groups: Record<string, Ss40kPayloadGroup>,
  telemetry: Ss40kTelemetryStore,
  version: string,
  options: Ss40kEnergyAccumulatorOptions | undefined
) {
  if (!options || options.enabled === false) return;

  const state = options.state || {};
  const counters = { ...(state.counters || {}) };
  const lastRaw = { ...(state.lastRaw || {}) };
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const lastMs = finiteNumber(state.lastMs);
  const dtMs = lastMs !== null && lastMs > 0 ? Math.max(0, nowMs - lastMs) : 0;
  const configuredMaxGapMs = finiteNumber(options.maxGapMs);
  const maxGapMs = configuredMaxGapMs !== null && configuredMaxGapMs > 0
    ? configuredMaxGapMs
    : 300000;
  const dtHours = Math.min(dtMs, maxGapMs) / 3600000;

  const power40101 = firstGroupForModel(groups, "40101");
  const energy40102 = ensureGroupForModel(groups, "40102", version);
  const fixed40101 = power40101?.fixed || {};
  const fixed40102 = energy40102.fixed;
  const sourceTags = options.sourceTagIDs || {};
  const outputMultiplier = normalizeEnergyOutputMultiplier(options.outputMultiplier);

  const utilityTag = sourceTags.utilityNetKwh || "Meter.Utility_Energy";
  const utilityEnergy = valueFromTelemetry(telemetry, utilityTag);
  const hasDirectGridImport = hasFiniteFixedValue(fixed40102, "eGridImpTot");
  const hasDirectGridExport = hasFiniteFixedValue(fixed40102, "eGridExpTot");
  if (utilityEnergy !== null && (!hasDirectGridImport || !hasDirectGridExport)) {
    seedCounter(counters, fixed40102, "eGridImpTot", outputMultiplier);
    seedCounter(counters, fixed40102, "eGridExpTot", outputMultiplier);
    const previous = lastRaw[utilityTag];
    if (Number.isFinite(previous)) {
      const delta = utilityEnergy - previous;
      if (delta > 0) counters.eGridImpTot = roundEnergyKwh(positiveCounter(counters.eGridImpTot) + delta);
      if (delta < 0) counters.eGridExpTot = roundEnergyKwh(positiveCounter(counters.eGridExpTot) + Math.abs(delta));
    }
    lastRaw[utilityTag] = utilityEnergy;
    if (!hasDirectGridImport) fixed40102.eGridImpTot = formatEnergyCounter(counters.eGridImpTot, outputMultiplier);
    if (!hasDirectGridExport) fixed40102.eGridExpTot = formatEnergyCounter(counters.eGridExpTot, outputMultiplier);
  }
  if (utilityEnergy === null && (!hasDirectGridImport || !hasDirectGridExport)) {
    if (!hasDirectGridImport) {
      seedCounter(counters, fixed40102, "eGridImpTot", outputMultiplier);
      if (dtHours > 0) {
        const importWatts = positiveNumber(fixed40101.pGridImpTot);
        counters.eGridImpTot = roundEnergyKwh(positiveCounter(counters.eGridImpTot) + (importWatts / 1000) * dtHours);
      }
      fixed40102.eGridImpTot = formatEnergyCounter(counters.eGridImpTot, outputMultiplier);
    }
    if (!hasDirectGridExport) {
      seedCounter(counters, fixed40102, "eGridExpTot", outputMultiplier);
      if (dtHours > 0) {
        const exportWatts = positiveNumber(fixed40101.pGridExpTot);
        counters.eGridExpTot = roundEnergyKwh(positiveCounter(counters.eGridExpTot) + (exportWatts / 1000) * dtHours);
      }
      fixed40102.eGridExpTot = formatEnergyCounter(counters.eGridExpTot, outputMultiplier);
    }
  }

  accumulatePositiveRawKwh(
    telemetry,
    sourceTags.acCoupledPvKwh || "Meter2.PV_Energy",
    counters,
    lastRaw,
    fixed40102,
    "eAcCplTot",
    outputMultiplier
  );
  accumulatePositiveRawKwh(
    telemetry,
    sourceTags.generatorKwh || "Meter.Generator_Energy",
    counters,
    lastRaw,
    fixed40102,
    "eGenTot",
    outputMultiplier
  );

  const hasDirectLoadEnergy = hasFiniteFixedValue(fixed40102, "eLoadTot");
  const loadWatts = positiveNumber(fixed40101.pLoad);
  if (!hasDirectLoadEnergy) {
    seedCounter(counters, fixed40102, "eLoadTot", outputMultiplier);
    if (dtHours > 0) {
      counters.eLoadTot = roundEnergyKwh(positiveCounter(counters.eLoadTot) + (loadWatts / 1000) * dtHours);
    }
    fixed40102.eLoadTot = formatEnergyCounter(counters.eLoadTot, outputMultiplier);
  }

  const hasDirectBatteryChargeEnergy = hasFiniteFixedValue(fixed40102, "eBatChgTot");
  const hasDirectBatteryDischargeEnergy = hasFiniteFixedValue(fixed40102, "eBatDischgTot");
  const batteryKw = resolveBatteryPowerKw(telemetry, fixed40101, sourceTags.batteryPowerKw);
  if (!hasDirectBatteryChargeEnergy || !hasDirectBatteryDischargeEnergy) {
    seedCounter(counters, fixed40102, "eBatChgTot", outputMultiplier);
    seedCounter(counters, fixed40102, "eBatDischgTot", outputMultiplier);
    if (batteryKw !== null && dtHours > 0) {
      if (batteryKw > 0) {
        counters.eBatDischgTot = roundEnergyKwh(positiveCounter(counters.eBatDischgTot) + batteryKw * dtHours);
      } else if (batteryKw < 0) {
        counters.eBatChgTot = roundEnergyKwh(positiveCounter(counters.eBatChgTot) + Math.abs(batteryKw) * dtHours);
      }
    }
    if (!hasDirectBatteryChargeEnergy) fixed40102.eBatChgTot = formatEnergyCounter(counters.eBatChgTot, outputMultiplier);
    if (!hasDirectBatteryDischargeEnergy) fixed40102.eBatDischgTot = formatEnergyCounter(counters.eBatDischgTot, outputMultiplier);
  }

  state.counters = counters;
  state.lastRaw = lastRaw;
  state.lastMs = nowMs;
  state.updatedAt = new Date(nowMs).toISOString();
  state.lastInputs = {
    utilityEnergy,
    acCoupledPvEnergy: valueFromTelemetry(telemetry, sourceTags.acCoupledPvKwh || "Meter2.PV_Energy"),
    generatorEnergy: valueFromTelemetry(telemetry, sourceTags.generatorKwh || "Meter.Generator_Energy"),
    loadWatts,
    batteryKw,
    dtHours,
    outputMultiplier,
  };
}

function applyDailyEnergyOverrides(
  groups: Record<string, Ss40kPayloadGroup>,
  version: string,
  options: Ss40kEnergyAccumulatorOptions | undefined
) {
  if (!options || options.enabled === false || options.dailyEnabled === false) return;

  const energy40102 = firstGroupForModel(groups, "40102");
  if (!energy40102) return;

  const state = options.state || {};
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const dateKey = localDateKey(nowMs, options.timezone);
  const previousDaily = state.daily || {};
  const sameDay = previousDaily.dateKey === dateKey;
  const baselines = sameDay ? { ...(previousDaily.baselines || {}) } : {};
  const lastGoodEnergyTotals = { ...(state.lastGoodEnergyTotals || {}) };
  const energyTotalGuards: Record<string, unknown> = {};
  let foundEnergy = false;

  for (const [totalPoint, todayPoint] of Object.entries(SS40K_DAILY_ENERGY_POINTS)) {
    const rawCurrent = finiteNumber(energy40102.fixed[totalPoint]);
    if (rawCurrent === null) continue;

    const previousGood = finiteNumber(lastGoodEnergyTotals[totalPoint]);
    const guarded = guardMonotonicEnergyTotal(rawCurrent, previousGood);
    if (guarded.action === "skip") {
      energyTotalGuards[totalPoint] = {
        action: "skip",
        raw: rawCurrent,
        previousGood,
      };
      continue;
    }

    const current = guarded.value;
    if (guarded.action === "hold") {
      energy40102.fixed[totalPoint] = current;
      energyTotalGuards[totalPoint] = {
        action: "hold",
        raw: rawCurrent,
        previousGood,
        value: current,
      };
    } else {
      lastGoodEnergyTotals[totalPoint] = current;
    }

    foundEnergy = true;
    const previousBaseline = baselines[totalPoint];
    const baseline = Number.isFinite(previousBaseline) && current >= previousBaseline
      ? previousBaseline
      : current;
    baselines[totalPoint] = baseline;
    energy40102.fixed[todayPoint] = roundDailyEnergy(current - baseline);
  }

  if (!foundEnergy) return;
  state.daily = { dateKey, baselines };
  state.lastGoodEnergyTotals = lastGoodEnergyTotals;
  state.energyTotalGuards = energyTotalGuards;
  state.updatedAt = new Date(nowMs).toISOString();

  if (!energy40102.latestTimestamp) {
    energy40102.latestTimestamp = new Date(nowMs).toISOString();
  }
}

function guardMonotonicEnergyTotal(
  current: number,
  previousGood: number | null
): { action: "accept" | "hold" | "skip"; value: number } {
  if (current > 0 && (previousGood === null || current >= previousGood)) {
    return { action: "accept", value: current };
  }

  if (previousGood !== null && previousGood > 0) {
    return { action: "hold", value: previousGood };
  }

  if (current >= 0) {
    return { action: "accept", value: current };
  }

  return { action: "skip", value: current };
}

function firstGroupForModel(
  groups: Record<string, Ss40kPayloadGroup>,
  model: string
): Ss40kPayloadGroup | null {
  return Object.values(groups).find((group) => group.model === model) || null;
}

function ensureGroupForModel(
  groups: Record<string, Ss40kPayloadGroup>,
  model: string,
  version: string
): Ss40kPayloadGroup {
  const existing = firstGroupForModel(groups, model);
  if (existing) return existing;
  const modelIndex = DEFAULT_SS40K_MODEL_INDEX_MAP[model] || "0";
  const key = `site::${model}`;
  groups[key] = {
    equipment: "site",
    model,
    modelIndex,
    version,
    latestTimestamp: null,
    fixed: { ID: Number(model) },
  };
  return groups[key];
}

function accumulatePositiveRawKwh(
  telemetry: Ss40kTelemetryStore,
  tagID: string,
  counters: Record<string, number>,
  lastRaw: Record<string, number>,
  fixed: Record<string, unknown>,
  point: string,
  outputMultiplier = 1
) {
  if (hasFiniteFixedValue(fixed, point)) return;

  const current = valueFromTelemetry(telemetry, tagID);
  if (current === null) return;
  seedCounter(counters, fixed, point, outputMultiplier);
  const previous = lastRaw[tagID];
  if (Number.isFinite(previous)) {
    const delta = current - previous;
    if (delta > 0) counters[point] = roundEnergyKwh(positiveCounter(counters[point]) + delta);
  }
  lastRaw[tagID] = current;
  fixed[point] = formatEnergyCounter(counters[point], outputMultiplier);
}

function seedCounter(
  counters: Record<string, number>,
  fixed: Record<string, unknown>,
  point: string,
  outputMultiplier = 1
) {
  if (Number.isFinite(counters[point])) return;
  const existing = finiteNumber(fixed[point]);
  counters[point] = existing !== null && existing >= 0 ? existing / outputMultiplier : 0;
}

function positiveCounter(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function positiveNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function roundEnergyKwh(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function roundDailyEnergy(value: number): number {
  return Math.round(Math.max(0, value) * 1000000) / 1000000;
}

function normalizeEnergyOutputMultiplier(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function formatEnergyCounter(value: unknown, outputMultiplier = 1): number {
  const numeric = positiveCounter(value);
  if (outputMultiplier === 1) return roundEnergyKwh(numeric);
  return Math.round(numeric * outputMultiplier);
}

function hasFiniteFixedValue(fixed: Record<string, unknown>, point: string): boolean {
  return finiteNumber(fixed[point]) !== null;
}

function localDateKey(nowMs: number, timezone?: string): string {
  const date = new Date(nowMs);
  if (!timezone) return date.toISOString().slice(0, 10);

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (values.year && values.month && values.day) {
      return `${values.year}-${values.month}-${values.day}`;
    }
  } catch {
    // Fall back to UTC below when the configured timezone is invalid.
  }

  return date.toISOString().slice(0, 10);
}

function resolveBatteryPowerKw(
  telemetry: Ss40kTelemetryStore,
  fixed40101: Record<string, unknown>,
  configuredTags: string | string[] | undefined
): number | null {
  const tags = Array.isArray(configuredTags)
    ? configuredTags
    : configuredTags
      ? [configuredTags]
      : ["MBMU.System_Power_kW"];
  let total = 0;
  let found = false;
  for (const tag of tags) {
    const value = valueFromTelemetry(telemetry, tag);
    if (value === null) continue;
    total += value;
    found = true;
  }
  if (found) return total;

  const dischargeWatts = positiveNumber(fixed40101.pBatDischg);
  const chargeWatts = positiveNumber(fixed40101.pBatChg);
  if (dischargeWatts || chargeWatts) return (dischargeWatts - chargeWatts) / 1000;
  return null;
}

function valueFromTelemetry(
  telemetry: Ss40kTelemetryStore,
  tagID: string
): number | null {
  if (!tagID) return null;
  const [equipment] = tagID.split(".");
  const samples = telemetry[equipment] || [];
  if (!Array.isArray(samples)) return null;
  const sample = samples.find((entry) => entry?.tagID === tagID);
  return finiteNumber(sample?.value);
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeEquipmentConfigEntry(
  rawConfig: Ss40kEquipmentConfigEntry | string
): Ss40kEquipmentConfigEntry {
  if (typeof rawConfig === "string") {
    return { profileName: rawConfig };
  }
  return rawConfig;
}

function toLookupEntry(
  equipment: string,
  profileName: string,
  entry: TelemetryTemplateEntry,
  modelIndexMap: Record<string, string>
): Ss40kLookupEntry | null {
  if (!entry.id || !entry.ss40k?.name || entry.ss40k.model == null) {
    return null;
  }

  const model = String(entry.ss40k.model);
  const exportMultiplier = Number(entry.ss40k.exportMultiplier);

  return {
    equipment,
    sourceTagID: entry.ss40k.sourceTagID || `${equipment}.${entry.id}`,
    profileName,
    name: entry.ss40k.name,
    model,
    modelIndex: modelIndexMap[model] || "0",
    exportMultiplier: Number.isFinite(exportMultiplier)
      ? exportMultiplier
      : 1,
    exportExpr:
      typeof entry.ss40k.exportExpr === "string" &&
      entry.ss40k.exportExpr.trim()
        ? entry.ss40k.exportExpr.trim()
        : undefined,
  };
}

function evaluateExportExpr(expr: string, value: unknown): unknown {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  const max = Math.max;
  const min = Math.min;
  const abs = Math.abs;
  const round = Math.round;
  const fn = new Function(
    "value",
    "max",
    "min",
    "abs",
    "round",
    "Math",
    `"use strict"; return (${expr});`
  );
  const result = fn(numeric, max, min, abs, round, Math);
  const out = Number(result);
  return Number.isFinite(out) ? out : value;
}

function toFixedValue(value: unknown, exportMultiplier: number): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }
  if (!Number.isFinite(exportMultiplier) || exportMultiplier === 1) {
    return value;
  }
  return Math.round(value * exportMultiplier);
}

function toIsoTimestamp(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return null;
}
