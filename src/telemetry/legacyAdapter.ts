import type { Ss40kTelemetrySample, Ss40kTelemetryStore } from "./ss40k";

type LegacyAdapterConfig = Record<string, any>;

export interface LegacyTelemetryAdapter {
  equipmentId: string;
  source: "legacyGlobal";
  legacyEquipment: string;
  profileName?: string;
  staleMs?: number;
  tagMap?: Record<string, string | string[]>;
  supplements?: {
    bcuTelemetry?: {
      enabled?: boolean;
      source?: "modbus";
      pollMs?: number;
    };
  };
}

export interface LegacyTelemetryAdapterResult {
  telemetry: Ss40kTelemetryStore;
  applied: Array<{
    equipmentId: string;
    legacyEquipment: string;
    count: number;
    stale: boolean;
  }>;
  errors: Array<{ equipmentId: string; message: string }>;
}

export interface UnifiedToLegacyTelemetryBridge {
  equipmentId: string;
  legacyEquipment: string;
  tagMap?: Record<string, string | string[]>;
}

export interface UnifiedToLegacyTelemetryBridgeResult {
  legacyTelemetry: Ss40kTelemetryStore;
  applied: Array<{
    equipmentId: string;
    legacyEquipment: string;
    count: number;
  }>;
  errors: Array<{ equipmentId: string; message: string }>;
}

const MINI_AMPACE_DEFAULT_TAG_MAP: Record<string, string | string[]> = {
  BcuCount: ["BcuCount", "BMSCount", "BcuQty"],
  BamsVoltage: ["BamsVoltage", "BamsTotalVol", "bamsVoltage(V)"],
  BamsCurrent: ["BamsCurrent", "bamsCurrent(A)"],
  BamsPower: ["BamsPower", "bamsPower(Kw)", "BamsPowerKw"],
  BamsTotalOutEng: ["BamsTotalOutEng", "BamsDischargedEnergy", "BamsTotalDischgEng"],
  BamsTotalInEng: ["BamsTotalInEng", "BamsChargedEnergy", "BamsTotalChgEng"],
  BamsSoc: ["BamsSoc", "BamsSOC", "bamsSoc(%)"],
  BamsSoh: ["BamsSoh", "BamsSOH", "bamsSoh(%)"],
  BamsPermitChgPower: ["BamsPermitChgPower", "bamsPermitChgPower(Kw)"],
  BamsPermitDsgPower: ["BamsPermitDsgPower", "bamsPermitDsgPower(Kw)"],
  BamsPermitChgCurrent: ["BamsPermitChgCurrent", "bamsPermitChgCurrent(A)"],
  BamsPermitDsgCurrent: ["BamsPermitDsgCurrent", "bamsPermitDsgCurrent(A)"],
  BamsBcuSocDiff: ["BamsBcuSocDiff", "bamsBcuSocDiff(%)"],
  BamsBcuMinSoc: ["BamsBcuMinSoc", "bamsBcuMinSoc(%)"],
  BamsBcuMinSocNo: ["BamsBcuMinSocNo", "bamsBcuMinSoc(No)"],
  BamsBcuMaxSoc: ["BamsBcuMaxSoc", "bamsBcuMaxSoc(%)"],
  BamsBcuMaxSocNo: ["BamsBcuMaxSocNo", "bamsBcuMaxSoc(No)"],
  BamsMaxCellVol: ["BamsMaxCellVol", "BamsMaxCellV", "bamsMaxCellVol(V)"],
  BamsMaxCellVBcuBmuNo: ["BamsMaxCellVBcuBmuNo", "bamsMaxCellVBcuBmuNo"],
  BamsMaxCellVNo: ["BamsMaxCellVNo", "bamsMaxCellVNo"],
  BamsMinCellVol: ["BamsMinCellVol", "BamsMinCellV", "bamsMinCellVol(V)"],
  BamsMinCellVBcuBmuNo: ["BamsMinCellVBcuBmuNo", "bamsMinCellVBcuBmuNo"],
  BamsMinCellVNo: ["BamsMinCellVNo", "bamsMinCellVNo"],
  BamsAvgCellVol: ["BamsAvgCellVol", "bamsAvgCellVol(V)"],
  BamsCellVolDiff: ["BamsCellVolDiff", "bamsCellVolDiff"],
  BamsMaxCellT: ["BamsMaxCellT", "BamsMaxCellTemp", "bamsMaxCellTemp(℃)"],
  BamsMaxCellTBcuBmuNo: ["BamsMaxCellTBcuBmuNo", "bamsMaxCellTBcuBmuNo"],
  BamsMaxCellTNo: ["BamsMaxCellTNo", "bamsMaxCellTNo"],
  BamsMinCellT: ["BamsMinCellT", "BamsMinCellTemp", "bamsMinCellTemp(℃)"],
  BamsMinCellTBcuBmuNo: ["BamsMinCellTBcuBmuNo", "bamsMinCellTBcuBmuNo"],
  BamsMinCellTNo: ["BamsMinCellTNo", "bamsMinCellTNo"],
  BamsAvgCellT: ["BamsAvgCellT", "BamsAvgCellTemp", "bamsAvgCellTemp(℃)"],
  BamsProtAlarm0_8: ["BamsProtAlarm0_8", "BaProtAlarm0_8"],
  BamsSysFaultCode0_8: ["BamsSysFaultCode0_8", "BaSysFaultCode0_8"],
  BamsOtherErrCode0_8: ["BamsOtherErrCode0_8", "BaOtherErrCode0_8"],
  BamsHwErrCode0_8: ["BamsHwErrCode0_8", "BaHwErrCode0_8"],
  BamsHwStaCode0_8: ["BamsHwStaCode0_8", "BaHwStaCode0_8"],
  BamsFaultCode0_8: ["BamsFaultCode0_8", "BaFaultCode0_8"],
  BamsFaultNotAllowHvFlg: ["BamsFaultNotAllowHvFlg", "FaHvNotAllowOnFlg"],
  BamsFaultNotAllowLvFlg: ["BamsFaultNotAllowLvFlg", "FaLvNotAllowOnFlg"],
  BcuOnlineMap: ["BcuOnlineMap"],
  MsBamsCommState: ["MsBamsCommState"],
  BamsAllowHvOnMap: ["BamsAllowHvOnMap"],
  ProductType: ["ProductType"],
  AirType: ["AirType"],
};

export function legacyTelemetryAdaptersFromConfig(
  config: LegacyAdapterConfig
): LegacyTelemetryAdapter[] {
  const adapters: LegacyTelemetryAdapter[] = [];
  const sourceBlocks = [
    readRecord(config.equipmentSources),
    readRecord(config.telemetrySources),
    readRecord(config.signalMapping?.sources),
  ];

  for (const block of sourceBlocks) {
    if (!block) continue;
    for (const [equipmentId, value] of Object.entries(block)) {
      const source = readRecord(value);
      if (!source || sourceKind(source) !== "legacyGlobal") continue;
      if (adapters.some((adapter) => adapter.equipmentId === equipmentId)) {
        continue;
      }
      adapters.push({
        equipmentId,
        source: "legacyGlobal",
        legacyEquipment:
          readString(source.legacyEquipment) ||
          readString(source.legacyKey) ||
          defaultLegacyEquipment(equipmentId),
        profileName:
          readString(source.profileName) ||
          readString(source.profile) ||
          readString(source.modbusProfile) ||
          undefined,
        staleMs: readNumber(source.staleMs),
        tagMap: readTagMap(source.tagMap),
        supplements: readSupplements(source.supplements),
      });
    }
  }

  return adapters.filter((adapter) => adapter.legacyEquipment);
}

export function isLegacyTelemetrySource(
  config: LegacyAdapterConfig,
  equipmentId: string
): boolean {
  return legacyTelemetryAdaptersFromConfig(config).some(
    (adapter) => adapter.equipmentId === equipmentId
  );
}

export function legacySourceAllowsBcuTelemetry(
  config: LegacyAdapterConfig,
  equipmentId: string
): boolean {
  const adapter = legacyTelemetryAdaptersFromConfig(config).find(
    (item) => item.equipmentId === equipmentId
  );
  if (!adapter) return true;
  return adapter.supplements?.bcuTelemetry?.enabled === true;
}

export function applyLegacyTelemetryAdapters(options: {
  telemetry?: Ss40kTelemetryStore;
  legacyTelemetry?: Ss40kTelemetryStore | Record<string, unknown>;
  config?: LegacyAdapterConfig;
  nowMs?: number;
}): LegacyTelemetryAdapterResult {
  const telemetry = cloneStore(options.telemetry || {});
  const legacyTelemetry = readRecord(options.legacyTelemetry) || {};
  const config = options.config || {};
  const nowMs = options.nowMs ?? Date.now();
  const applied: LegacyTelemetryAdapterResult["applied"] = [];
  const errors: LegacyTelemetryAdapterResult["errors"] = [];

  for (const adapter of legacyTelemetryAdaptersFromConfig(config)) {
    const legacySamples = readLegacySamples(legacyTelemetry, adapter.legacyEquipment);
    if (!legacySamples.length) {
      errors.push({
        equipmentId: adapter.equipmentId,
        message: `legacy equipment ${adapter.legacyEquipment} not found`,
      });
      continue;
    }

    const tagMap =
      adapter.tagMap ||
      (isMiniAmpace(adapter) ? MINI_AMPACE_DEFAULT_TAG_MAP : undefined);
    const converted = convertLegacySamples(
      legacySamples,
      adapter.equipmentId,
      adapter.legacyEquipment,
      tagMap,
      adapter.staleMs,
      nowMs
    );

    if (!converted.samples.length) {
      errors.push({
        equipmentId: adapter.equipmentId,
        message: `legacy equipment ${adapter.legacyEquipment} had no matching samples`,
      });
      continue;
    }

    telemetry[adapter.equipmentId] = mergeSamples(
      telemetry[adapter.equipmentId] || [],
      converted.samples
    );
    applied.push({
      equipmentId: adapter.equipmentId,
      legacyEquipment: adapter.legacyEquipment,
      count: converted.samples.length,
      stale: converted.stale,
    });
  }

  return { telemetry, applied, errors };
}

export function unifiedToLegacyTelemetryBridgesFromConfig(
  config: LegacyAdapterConfig
): UnifiedToLegacyTelemetryBridge[] {
  const bridges: UnifiedToLegacyTelemetryBridge[] = [];

  const pushBridge = (
    equipmentId: string,
    raw: Record<string, unknown> | undefined
  ) => {
    if (!equipmentId || !raw || raw.enabled === false) return;
    const legacyEquipment =
      readString(raw.legacyEquipment) ||
      readString(raw.legacyKey) ||
      defaultLegacyEquipment(equipmentId);
    if (!legacyEquipment) return;
    if (
      bridges.some(
        (bridge) =>
          bridge.equipmentId === equipmentId &&
          bridge.legacyEquipment === legacyEquipment
      )
    ) {
      return;
    }
    bridges.push({
      equipmentId,
      legacyEquipment,
      tagMap: readTagMap(raw.tagMap),
    });
  };

  const compatibility = readRecord(config.telemetryCompatibility);
  const configured = compatibility?.publishUnifiedToLegacy;
  if (Array.isArray(configured)) {
    for (const item of configured) {
      const raw = readRecord(item);
      const equipmentId = readString(raw?.equipmentId);
      pushBridge(equipmentId, raw);
    }
  } else {
    const record = readRecord(configured);
    if (record) {
      for (const [equipmentId, value] of Object.entries(record)) {
        pushBridge(equipmentId, readRecord(value));
      }
    }
  }

  const sourceBlocks = [
    readRecord(config.equipmentSources),
    readRecord(config.telemetrySources),
    readRecord(config.signalMapping?.sources),
  ];
  for (const block of sourceBlocks) {
    if (!block) continue;
    for (const [equipmentId, value] of Object.entries(block)) {
      const source = readRecord(value);
      if (!source) continue;
      const bridge =
        source.publishToLegacy ||
        readRecord(source.legacyPublish) ||
        readRecord(source.publishUnifiedToLegacy);
      if (Array.isArray(bridge)) {
        for (const item of bridge) {
          pushBridge(equipmentId, readRecord(item));
        }
      } else {
        pushBridge(equipmentId, readRecord(bridge));
      }
    }
  }

  return bridges;
}

export function publishUnifiedTelemetryToLegacy(options: {
  telemetry?: Ss40kTelemetryStore;
  legacyTelemetry?: Ss40kTelemetryStore | Record<string, unknown>;
  config?: LegacyAdapterConfig;
  nowMs?: number;
}): UnifiedToLegacyTelemetryBridgeResult {
  const telemetry = readRecord(options.telemetry) || {};
  const legacyTelemetry = cloneReadableStore(options.legacyTelemetry || {});
  const config = options.config || {};
  const nowMs = options.nowMs ?? Date.now();
  const applied: UnifiedToLegacyTelemetryBridgeResult["applied"] = [];
  const errors: UnifiedToLegacyTelemetryBridgeResult["errors"] = [];

  for (const bridge of unifiedToLegacyTelemetryBridgesFromConfig(config)) {
    const sourceSamples = readLegacySamples(telemetry, bridge.equipmentId);
    if (!sourceSamples.length) {
      errors.push({
        equipmentId: bridge.equipmentId,
        message: `unified equipment ${bridge.equipmentId} not found`,
      });
      continue;
    }

    const converted = convertUnifiedSamplesToLegacy(
      sourceSamples,
      bridge.equipmentId,
      bridge.legacyEquipment,
      bridge.tagMap || defaultUnifiedToLegacyTagMap(bridge.equipmentId),
      nowMs
    );
    if (!converted.length) {
      errors.push({
        equipmentId: bridge.equipmentId,
        message: `unified equipment ${bridge.equipmentId} had no matching samples`,
      });
      continue;
    }

    const existing = readLegacySamples(
      legacyTelemetry,
      bridge.legacyEquipment
    );
    legacyTelemetry[bridge.legacyEquipment] = mergeSamples(
      existing,
      converted
    );
    applied.push({
      equipmentId: bridge.equipmentId,
      legacyEquipment: bridge.legacyEquipment,
      count: converted.length,
    });
  }

  return { legacyTelemetry, applied, errors };
}

function convertUnifiedSamplesToLegacy(
  sourceSamples: Ss40kTelemetrySample[],
  equipmentId: string,
  legacyEquipment: string,
  tagMap: Record<string, string | string[]> | undefined,
  nowMs: number
): Ss40kTelemetrySample[] {
  const bySuffix = new Map<string, Ss40kTelemetrySample>();
  const byFull = new Map<string, Ss40kTelemetrySample>();
  for (const sample of sourceSamples) {
    const tagID = readString(sample.tagID);
    if (!tagID) continue;
    byFull.set(tagID, sample);
    bySuffix.set(stripEquipment(tagID), sample);
  }

  const specs =
    tagMap ||
    Object.fromEntries(Array.from(bySuffix.keys()).map((key) => [key, key]));
  const out: Ss40kTelemetrySample[] = [];

  for (const [targetTag, rawSources] of Object.entries(specs)) {
    const sample = firstMappedSample(rawSources, bySuffix, byFull, equipmentId);
    if (!sample) continue;
    out.push({
      ...sample,
      tagID: `${legacyEquipment}.${targetTag}`,
      timestamp: normalizeTimestamp(sample.timestamp, nowMs),
      source: "unifiedTelemetry",
      sourceEquipment: equipmentId,
    });
  }

  return out;
}

function convertLegacySamples(
  legacySamples: Ss40kTelemetrySample[],
  equipmentId: string,
  legacyEquipment: string,
  tagMap: Record<string, string | string[]> | undefined,
  staleMs: number | undefined,
  nowMs: number
): { samples: Ss40kTelemetrySample[]; stale: boolean } {
  const bySuffix = new Map<string, Ss40kTelemetrySample>();
  const byFull = new Map<string, Ss40kTelemetrySample>();
  for (const sample of legacySamples) {
    const tagID = readString(sample.tagID);
    if (!tagID) continue;
    byFull.set(tagID, sample);
    bySuffix.set(stripEquipment(tagID), sample);
  }

  const out: Ss40kTelemetrySample[] = [];
  const specs = tagMap || Object.fromEntries(
    Array.from(bySuffix.keys()).map((key) => [key, key])
  );
  let stale = false;

  for (const [targetTag, rawSources] of Object.entries(specs)) {
    const sample = firstMappedSample(rawSources, bySuffix, byFull, legacyEquipment);
    if (!sample) continue;
    const timestamp = normalizeTimestamp(sample.timestamp, nowMs);
    const ageMs = nowMs - Date.parse(timestamp);
    const isStale = Number.isFinite(ageMs) && staleMs !== undefined && staleMs > 0 && ageMs > staleMs;
    stale = stale || isStale;
    out.push({
      ...sample,
      tagID: `${equipmentId}.${targetTag}`,
      timestamp,
      source: "legacyGlobal",
      sourceEquipment: legacyEquipment,
      stale: isStale,
    });
  }

  return { samples: out, stale };
}

function firstMappedSample(
  rawSources: string | string[],
  bySuffix: Map<string, Ss40kTelemetrySample>,
  byFull: Map<string, Ss40kTelemetrySample>,
  legacyEquipment: string
): Ss40kTelemetrySample | undefined {
  const sources = Array.isArray(rawSources) ? rawSources : [rawSources];
  for (const source of sources) {
    const key = String(source || "");
    if (!key) continue;
    const fullKey = key.includes(".") ? key : `${legacyEquipment}.${key}`;
    const sample = byFull.get(fullKey) || bySuffix.get(key);
    if (sample) return sample;
  }
  return undefined;
}

function mergeSamples(
  existing: Ss40kTelemetrySample[],
  incoming: Ss40kTelemetrySample[]
): Ss40kTelemetrySample[] {
  const byTag = new Map<string, Ss40kTelemetrySample>();
  for (const sample of existing) {
    if (sample?.tagID) byTag.set(sample.tagID, sample);
  }
  for (const sample of incoming) {
    if (sample?.tagID) byTag.set(sample.tagID, sample);
  }
  return Array.from(byTag.values()).sort((a, b) =>
    String(a.tagID).localeCompare(String(b.tagID))
  );
}

function readLegacySamples(
  legacyTelemetry: Record<string, unknown>,
  legacyEquipment: string
): Ss40kTelemetrySample[] {
  const value = legacyTelemetry[legacyEquipment];
  if (Array.isArray(value)) return value as Ss40kTelemetrySample[];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([tag, raw]) => {
      const sample = readRecord(raw);
      if (sample && "value" in sample) {
        return {
          ...sample,
          tagID: readString(sample.tagID) || `${legacyEquipment}.${tag}`,
        } as Ss40kTelemetrySample;
      }
      return { tagID: `${legacyEquipment}.${tag}`, value: raw };
    });
  }
  return [];
}

function cloneStore(store: Ss40kTelemetryStore): Ss40kTelemetryStore {
  const out: Ss40kTelemetryStore = {};
  for (const [key, value] of Object.entries(store || {})) {
    out[key] = Array.isArray(value) ? value.slice() : value;
  }
  return out;
}

function cloneReadableStore(
  store: Ss40kTelemetryStore | Record<string, unknown>
): Ss40kTelemetryStore {
  const out: Ss40kTelemetryStore = {};
  const record = readRecord(store) || {};
  for (const key of Object.keys(record)) {
    out[key] = readLegacySamples(record, key);
  }
  return out;
}

function sourceKind(source: Record<string, unknown>): "modbus" | "legacyGlobal" {
  const value = readString(source.source) || readString(source.sourceType);
  return value === "legacyGlobal" ? "legacyGlobal" : "modbus";
}

function defaultLegacyEquipment(equipmentId: string): string {
  if (equipmentId === "AMPACE" || equipmentId === "Battery") return "Battery_A";
  return equipmentId;
}

function isMiniAmpace(adapter: LegacyTelemetryAdapter): boolean {
  return (
    adapter.equipmentId === "AMPACE" ||
    adapter.profileName === "AMPACE_Mini_ss40k" ||
    adapter.profileName === "Battery_Mini"
  );
}

function defaultUnifiedToLegacyTagMap(
  equipmentId: string
): Record<string, string | string[]> | undefined {
  if (
    equipmentId === "AMPACE" ||
    equipmentId === "Battery" ||
    equipmentId.endsWith("_Battery")
  ) {
    return Object.fromEntries(
      Object.keys(MINI_AMPACE_DEFAULT_TAG_MAP).map((key) => [key, key])
    );
  }
  return undefined;
}

function stripEquipment(tagID: string): string {
  const index = tagID.indexOf(".");
  return index >= 0 ? tagID.slice(index + 1) : tagID;
}

function normalizeTimestamp(value: unknown, nowMs: number): string {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date(nowMs).toISOString();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readTagMap(value: unknown): Record<string, string | string[]> | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string") out[key] = raw;
    else if (Array.isArray(raw)) {
      out[key] = raw.map(String).filter(Boolean);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function readSupplements(value: unknown): LegacyTelemetryAdapter["supplements"] {
  const record = readRecord(value);
  const bcu = readRecord(record?.bcuTelemetry);
  if (!bcu) return undefined;
  return {
    bcuTelemetry: {
      enabled: bcu.enabled === true,
      source: readString(bcu.source) === "modbus" ? "modbus" : undefined,
      pollMs: readNumber(bcu.pollMs),
    },
  };
}
