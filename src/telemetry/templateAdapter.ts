import * as fs from "fs";
import * as path from "path";

export interface TelemetryTemplateScale {
  mode?: string;
  rawLow?: number;
  rawHigh?: number;
  scaledLow?: number;
  scaledHigh?: number;
  engLow?: number;
  engHigh?: number;
  clamp?: boolean;
}

export interface TelemetryTemplateCalc {
  from?: string;
  inputs?: Record<string, string>;
  expr: string;
}

export interface TelemetryTemplateSs40k {
  name: string;
  model: string | number;
  exportMultiplier?: number;
  sourceTagID?: string;
  exportExpr?: string;
}

export interface TelemetryTemplateEntry {
  id: string;
  description?: string;
  function?: string | null;
  address?: number | null;
  length?: number;
  parser?: string;
  pollClass?: "fast" | "normal" | "slow" | "startup";
  constant?: string | number | boolean | null;
  calc?: TelemetryTemplateCalc;
  scale?: TelemetryTemplateScale;
  alarmFlag?: boolean;
  alarm?: boolean;
  supporting?: boolean;
  supportingTag?: boolean;
  statusFlag?: boolean;
  enumStatus?: Record<string, string>;
  bitfieldStatus?: boolean | Record<string, string>;
  status?: {
    enum?: Record<string, string>;
    bitfieldStatus?: boolean | Record<string, string>;
    flag?: boolean;
  };
  enum?: Record<string, string>;
  ss40k?: TelemetryTemplateSs40k;
  noMerge?: boolean;
}

export interface TelemetryTemplateCommandEntry extends TelemetryTemplateEntry {
  readback?: boolean;
}

export interface TelemetryTemplateDocument {
  version: string;
  device: {
    vendor: string;
    model: string;
    protocol: string;
    name?: string;
    sourceFormat?: string;
    notes?: string;
    defaultByteOrder?: "BE" | "LE";
    defaultWordOrder32?: "ABCD" | "CDAB" | "BADC" | "DCBA";
  };
  telemetry: TelemetryTemplateEntry[];
  commands?: TelemetryTemplateCommandEntry[];
}

export interface NormalizedTelemetryScale {
  mode: "Linear";
  rawLow: number;
  rawHigh: number;
  engLow: number;
  engHigh: number;
  clamp?: boolean;
}

export interface NormalizedTelemetryTag {
  name: string;
  function?: string;
  address?: number;
  length?: number;
  parser?: string;
  pollClass?: "fast" | "normal" | "slow" | "startup";
  constant?: string | number | boolean | null;
  calc?: {
    inputs: Record<string, string>;
    expr: string;
  };
  virtual?: true;
  scale?: NormalizedTelemetryScale;
  alarm?: "Yes" | "No";
  supportingTag?: "Yes" | "No";
  status?: string;
  enumStatus?: Record<string, string>;
  bitfieldStatus?: boolean | Record<string, string>;
  noMerge?: boolean;
}

export interface NormalizedTelemetryProfile {
  profileId: string;
  defaults: {
    byteOrder: "BE" | "LE";
    wordOrder32: "ABCD" | "CDAB" | "BADC" | "DCBA";
  };
  tags: NormalizedTelemetryTag[];
}

const TEMPLATE_FILE_ALIASES: Record<string, string> = {
  eGauge_280_ss40k: "eGauge_280_ss40k.json",
  egauge_280_ss40k: "eGauge_280_ss40k.json",
  egauge_280: "eGauge_280_ss40k.json",
  egauge: "eGauge_280_ss40k.json",
  udt_eGauge_V1: "eGauge_280_ss40k.json",
  eGauge_Assisted_Living_ss40k: "eGauge_Assisted_Living_ss40k.json",
  eGauge_Assisted_Living: "eGauge_Assisted_Living_ss40k.json",
  udt_eGauge_Assisted_Living_V1: "eGauge_Assisted_Living_ss40k.json",
  eGauge_Mission_Energy_ss40k: "eGauge_Mission_Energy_ss40k.json",
  eGauge_Mission_Energy: "eGauge_Mission_Energy_ss40k.json",
  eGauge_MissionEnergy: "eGauge_Mission_Energy_ss40k.json",
  udt_eGauge_Mission_Energy_V1: "eGauge_Mission_Energy_ss40k.json",
  eGauge_Mission_Energy_Meter2_ss40k: "eGauge_Mission_Energy_Meter2_ss40k.json",
  eGauge_Mission_Energy_Meter2: "eGauge_Mission_Energy_Meter2_ss40k.json",
  udt_eGauge_Mission_Energy_Meter2_V1: "eGauge_Mission_Energy_Meter2_ss40k.json",
  udt_solarEdge_V1: "udt_solarEdge_V1.json",
  solarEdge: "udt_solarEdge_V1.json",
  solaredge: "udt_solarEdge_V1.json",
  solaredge_ac_v1: "udt_solarEdge_V1.json",
  SEL851_ss40k: "SEL851_ss40k.json",
  SEL851: "SEL851_ss40k.json",
  sel851: "SEL851_ss40k.json",
  udt_SEL851_v1: "SEL851_ss40k.json",
  AMPACE_Mini_ss40k: "AMPACE_Mini_ss40k.json",
  AMPACE_Mini: "AMPACE_Mini_ss40k.json",
  Ampace_BMS_ss40k: "AMPACE_Mini_ss40k.json",
  Ampace_BMS: "AMPACE_Mini_ss40k.json",
  udt_Ampace_A_V3: "AMPACE_Mini_ss40k.json",
  ampace_bms: "AMPACE_Mini_ss40k.json",
  ampace_mini: "AMPACE_Mini_ss40k.json",
  Battery_Mini_ss40k: "AMPACE_Mini_ss40k.json",
  Battery_Mini: "AMPACE_Mini_ss40k.json",
  battery_mini: "AMPACE_Mini_ss40k.json",
  AMPACE_Mini_BCU_42k: "AMPACE_Mini_BCU_42k.json",
  AMPACE_Mini_BCU42k: "AMPACE_Mini_BCU_42k.json",
  ampace_mini_bcu_42k: "AMPACE_Mini_BCU_42k.json",
  Battery_Mini_BCU_42k: "AMPACE_Mini_BCU_42k.json",
  Battery_Mini_BCU42k: "AMPACE_Mini_BCU_42k.json",
  battery_mini_bcu_42k: "AMPACE_Mini_BCU_42k.json",
  CATL_280_SBMU_42k: "CATL_280_SBMU_42k.json",
  CATL_280_SBMU42k: "CATL_280_SBMU_42k.json",
  catl_280_sbmu_42k: "CATL_280_SBMU_42k.json",
  Sinexcel_Mini_PCS_ss40k: "Sinexcel_Mini_PCS_ss40k.json",
  Sinexcel_Mini_PCS: "Sinexcel_Mini_PCS_ss40k.json",
  udt_Sinexcel_Mini_PCS: "Sinexcel_Mini_PCS_ss40k.json",
  mini_pcs: "Sinexcel_Mini_PCS_ss40k.json",
  Sinexcel_Mini_ss40k: "Sinexcel_Mini_PCS_ss40k.json",
  Sinexcel_Mini_Load: "Sinexcel_Mini_Load_ss40k.json",
  udt_Sinexcel_Mini_Load: "Sinexcel_Mini_Load_ss40k.json",
  mini_load: "Sinexcel_Mini_Load_ss40k.json",
  Sinexcel_Mini_PVDC_Module1: "Sinexcel_Mini_PVDC_Module1_ss40k.json",
  Sinexcel_Mini_PVDC_Module2: "Sinexcel_Mini_PVDC_Module2_ss40k.json",
  Sinexcel_Mini_PVDC_Module3: "Sinexcel_Mini_PVDC_Module3_ss40k.json",
  udt_Sinexcel_PVDC_Module1: "Sinexcel_Mini_PVDC_Module1_ss40k.json",
  udt_Sinexcel_PVDC_Module2: "Sinexcel_Mini_PVDC_Module2_ss40k.json",
  udt_Sinexcel_PVDC_Module3: "Sinexcel_Mini_PVDC_Module3_ss40k.json",
  pvdc_module_1: "Sinexcel_Mini_PVDC_Module1_ss40k.json",
  pvdc_module_2: "Sinexcel_Mini_PVDC_Module2_ss40k.json",
  pvdc_module_3: "Sinexcel_Mini_PVDC_Module3_ss40k.json",
  NANO_Hybrid_PCS_ss40k: "NANO_Hybrid_PCS_ss40k.json",
  NANO_Hybrid_PCS: "NANO_Hybrid_PCS_ss40k.json",
  Nano_Hybrid_PCS: "NANO_Hybrid_PCS_ss40k.json",
  nano_hybrid_pcs: "NANO_Hybrid_PCS_ss40k.json",
  udt_NANO_HybridInverter_V15: "NANO_Hybrid_PCS_ss40k.json",
};

function templatesDir() {
  return path.resolve(__dirname, "..", "templates");
}

function fail(message: string): never {
  throw new Error(`Telemetry template error: ${message}`);
}

export function resolveTelemetryTemplatePath(profileName: string): string {
  const aliasCandidate = TEMPLATE_FILE_ALIASES[profileName];
  const directCandidates = [
    aliasCandidate,
    profileName,
    `${profileName}.json`,
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of directCandidates) {
    const filePath = path.join(templatesDir(), candidate);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  fail(`unknown telemetry profile "${profileName}"`);
}

export function resolveTelemetryTemplate(
  profileName: string
): TelemetryTemplateDocument {
  const filePath = resolveTelemetryTemplatePath(profileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return validateTelemetryTemplate(profileName, parsed);
}

function validateTelemetryTemplate(
  profileName: string,
  doc: unknown
): TelemetryTemplateDocument {
  if (!doc || typeof doc !== "object") {
    fail(`profile "${profileName}" is not a JSON object`);
  }

  const maybeDoc = doc as Partial<TelemetryTemplateDocument>;
  if (!maybeDoc.device || typeof maybeDoc.device !== "object") {
    fail(`profile "${profileName}" is missing device metadata`);
  }
  if (!Array.isArray(maybeDoc.telemetry)) {
    fail(`profile "${profileName}" is missing telemetry[]`);
  }

  maybeDoc.telemetry.forEach((entry, index) => {
    validateTemplateEntry(profileName, "telemetry", index, entry);
  });

  if (maybeDoc.commands !== undefined) {
    if (!Array.isArray(maybeDoc.commands)) {
      fail(`profile "${profileName}" commands is not an array`);
    }
    maybeDoc.commands.forEach((entry, index) => {
      validateTemplateEntry(profileName, "commands", index, entry);
    });
  }

  return maybeDoc as TelemetryTemplateDocument;
}

export function adaptTelemetryTemplateToReadProfile(
  profileName: string,
  template: TelemetryTemplateDocument
): NormalizedTelemetryProfile {
  return {
    profileId: profileName,
    defaults: {
      byteOrder: template.device.defaultByteOrder ?? "BE",
      wordOrder32: template.device.defaultWordOrder32 ?? "ABCD",
    },
    tags: [
      ...template.telemetry.map((entry, index) =>
        adaptTelemetryEntry(profileName, entry, index)
      ),
      ...(template.commands || []).map((entry, index) =>
        adaptTelemetryEntry(profileName, entry, index, "commands")
      ),
    ],
  };
}

function adaptTelemetryEntry(
  profileName: string,
  entry: TelemetryTemplateEntry,
  index: number,
  section: "telemetry" | "commands" = "telemetry"
): NormalizedTelemetryTag {
  const enumStatus = normalizeEnumStatus(entry);
  const bitfieldStatus = normalizeBitfieldStatus(entry);
  const hasImplicitStatus = !!enumStatus || bitfieldStatus !== undefined;
  const normalized: NormalizedTelemetryTag = {
    name: entry.id,
    alarm: (entry.alarmFlag ?? entry.alarm) ? "Yes" : "No",
    supportingTag: (entry.supporting ?? entry.supportingTag) ? "Yes" : "No",
    status:
      (entry.statusFlag ?? entry.status?.flag ?? hasImplicitStatus)
        ? "Yes"
        : "No",
  };
  if (enumStatus) {
    normalized.enumStatus = enumStatus;
  }
  if (bitfieldStatus !== undefined) {
    normalized.bitfieldStatus = bitfieldStatus;
  }
  if (entry.noMerge) {
    normalized.noMerge = true;
  }

  if (entry.constant !== undefined) {
    normalized.constant = entry.constant;
  } else if (entry.calc) {
    normalized.calc = {
      inputs: normalizeCalcInputs(entry.calc),
      expr: entry.calc.expr,
    };
  } else if (entry.function == null && entry.address == null) {
    normalized.virtual = true;
  } else {
    normalized.function = entry.function || undefined;
    normalized.address =
      typeof entry.address === "number" ? entry.address : undefined;
    if (typeof entry.length === "number" && entry.length > 0) {
      normalized.length = entry.length;
    }
    if (typeof entry.parser === "string" && entry.parser.trim()) {
      normalized.parser = entry.parser.trim();
    }
  }

  if (entry.pollClass) {
    normalized.pollClass = entry.pollClass;
  } else if (section === "commands") {
    normalized.pollClass = "normal";
  }

  const scale = normalizeScale(profileName, section, entry.scale, index);
  if (scale) {
    normalized.scale = scale;
  }

  return normalized;
}

function normalizeScale(
  profileName: string,
  section: "telemetry" | "commands",
  scale: TelemetryTemplateScale | undefined,
  index: number
): NormalizedTelemetryScale | undefined {
  if (!scale || !scale.mode || scale.mode === "none") {
    return undefined;
  }

  if (scale.mode !== "Linear") {
    fail(
      `profile "${profileName}" ${section}[${index}] uses unsupported scale mode "${scale.mode}"`
    );
  }

  const rawLow = Number(scale.rawLow);
  const rawHigh = Number(scale.rawHigh);
  const engLow = Number(scale.engLow ?? scale.scaledLow);
  const engHigh = Number(scale.engHigh ?? scale.scaledHigh);

  if (
    !Number.isFinite(rawLow) ||
    !Number.isFinite(rawHigh) ||
    !Number.isFinite(engLow) ||
    !Number.isFinite(engHigh)
  ) {
    fail(
      `profile "${profileName}" ${section}[${index}] has malformed Linear scale`
    );
  }

  return {
    mode: "Linear",
    rawLow,
    rawHigh,
    engLow,
    engHigh,
    clamp: scale.clamp,
  };
}

function normalizeCalcInputs(calc: TelemetryTemplateCalc): Record<string, string> {
  if (calc.inputs && typeof calc.inputs === "object") {
    return Object.fromEntries(
      Object.entries(calc.inputs).filter(
        ([key, value]) =>
          typeof key === "string" &&
          !!key.trim() &&
          typeof value === "string" &&
          !!value.trim()
      )
    );
  }

  if (typeof calc.from === "string" && calc.from.trim()) {
    return { x: calc.from };
  }

  return {};
}

function normalizeEnumStatus(
  entry: TelemetryTemplateEntry | TelemetryTemplateCommandEntry
): Record<string, string> | undefined {
  const candidate = entry.enumStatus ?? entry.enum ?? entry.status?.enum;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        typeof key === "string" &&
        !!key.trim() &&
        typeof value === "string" &&
        !!value.trim()
    )
  );

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeBitfieldStatus(
  entry: TelemetryTemplateEntry | TelemetryTemplateCommandEntry
): boolean | Record<string, string> | undefined {
  const candidate = entry.bitfieldStatus ?? entry.status?.bitfieldStatus;
  if (candidate === true) {
    return true;
  }
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        typeof key === "string" &&
        !!key.trim() &&
        typeof value === "string" &&
        !!value.trim()
    )
  );

  return Object.keys(normalized).length ? normalized : undefined;
}

function validateTemplateEntry(
  profileName: string,
  section: "telemetry" | "commands",
  index: number,
  entry: TelemetryTemplateEntry | TelemetryTemplateCommandEntry
) {
  if (!entry || typeof entry !== "object") {
    fail(`profile "${profileName}" ${section}[${index}] is not an object`);
  }
  if (typeof entry.id !== "string" || !entry.id.trim()) {
    fail(`profile "${profileName}" ${section}[${index}] is missing id`);
  }
  const hasConstant = Object.prototype.hasOwnProperty.call(entry, "constant");
  const hasCalc = !!entry.calc;
  const hasFunction = typeof entry.function === "string" && !!entry.function.trim();
  const hasAddress = typeof entry.address === "number" && Number.isFinite(entry.address);
  const hasPhysical = hasFunction && hasAddress;
  const isVirtualPlaceholder =
    entry.function == null &&
    entry.address == null &&
    !hasConstant &&
    !hasCalc;
  const sourceCount =
    Number(hasConstant) + Number(hasCalc) + Number(hasPhysical) + Number(isVirtualPlaceholder);

  if (sourceCount === 0) {
    fail(`profile "${profileName}" ${section}[${index}] is missing function/address, constant, or calc`);
  }
  if (sourceCount > 1) {
    fail(`profile "${profileName}" ${section}[${index}] mixes multiple source types`);
  }
  if (hasCalc) {
    const inputs = normalizeCalcInputs(entry.calc!);
    const expr = entry.calc?.expr;
    if (!Object.keys(inputs).length || typeof expr !== "string" || !expr.trim()) {
      fail(`profile "${profileName}" ${section}[${index}] has malformed calc`);
    }
  }
  if (!hasConstant && !hasCalc && !hasAddress && !isVirtualPlaceholder) {
    fail(`profile "${profileName}" ${section}[${index}] has invalid address`);
  }
  if (
    entry.scale !== undefined &&
    (!entry.scale || typeof entry.scale !== "object")
  ) {
    fail(`profile "${profileName}" ${section}[${index}] has invalid scale`);
  }
  if (
    entry.ss40k !== undefined &&
    (!entry.ss40k ||
      typeof entry.ss40k !== "object" ||
      typeof entry.ss40k.name !== "string" ||
      (typeof entry.ss40k.model !== "string" &&
        typeof entry.ss40k.model !== "number") ||
      (entry.ss40k.exportMultiplier !== undefined &&
        (typeof entry.ss40k.exportMultiplier !== "number" ||
          !Number.isFinite(entry.ss40k.exportMultiplier))))
  ) {
    fail(`profile "${profileName}" ${section}[${index}] has invalid ss40k metadata`);
  }
}
