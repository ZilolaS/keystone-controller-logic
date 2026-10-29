import type { Ss40kEquipmentConfig } from "./ss40k";
import {
  resolveTelemetryTemplate,
  type TelemetryTemplateDocument,
  type TelemetryTemplateEntry,
} from "./templateAdapter";

export interface CatlSbmu42kTemplateOptions {
  sbmuIndex: number;
  serialNumber?: string;
}

export interface CatlSbmu42kEquipmentOptions {
  count: number;
  route?: string;
  equipmentPrefix?: string;
  serialNumbers?: string[];
}

const SBMU_BASE_ADDRESS = 0x0400;
const SBMU_ADDRESS_STRIDE = 0x0400;
const TEMPLATE_PROFILE = "CATL_280_SBMU_42k";

export function buildCatlSbmu42kTemplate(
  options: CatlSbmu42kTemplateOptions
): TelemetryTemplateDocument {
  const sbmuIndex = clampSbmuIndex(options.sbmuIndex);
  const sbmuNumber = sbmuIndex + 1;
  const baseAddress = SBMU_BASE_ADDRESS + sbmuIndex * SBMU_ADDRESS_STRIDE;
  const serialNumber = options.serialNumber || "";
  const template = cloneTemplate(resolveTelemetryTemplate(TEMPLATE_PROFILE));

  template.device = {
    ...template.device,
    model: `SBMU ${sbmuNumber}`,
    name: `${TEMPLATE_PROFILE}_SBMU${sbmuNumber}`,
    sourceFormat: "json-offset-template",
  };

  template.telemetry = template.telemetry.map((entry) =>
    instantiateEntry(entry, {
      baseAddress,
      serialNumber,
    })
  );

  return template;
}

export function buildCatlSbmu42kEquipmentConfig(
  options: CatlSbmu42kEquipmentOptions
): Ss40kEquipmentConfig {
  const count = Math.max(0, Math.min(32, Math.trunc(Number(options.count) || 0)));
  const prefix = options.equipmentPrefix || "CATL_SBMU";
  const route = options.route || "MBMU";
  const out: Ss40kEquipmentConfig = {};

  for (let sbmuIndex = 0; sbmuIndex < count; sbmuIndex += 1) {
    const equipmentId = `${prefix}_${sbmuIndex + 1}`;
    out[equipmentId] = {
      profileName: `CATL_280_SBMU${sbmuIndex + 1}_42k`,
      route,
      template: buildCatlSbmu42kTemplate({
        sbmuIndex,
        serialNumber: options.serialNumbers?.[sbmuIndex],
      }),
    };
  }

  return out;
}

function instantiateEntry(
  entry: TelemetryTemplateEntry,
  values: {
    baseAddress: number;
    serialNumber: string;
  }
): TelemetryTemplateEntry {
  const out: TelemetryTemplateEntry = { ...entry };

  if (typeof out.address === "number") {
    out.address = values.baseAddress + out.address;
  }

  if (out.constant === "${serialNumber}") out.constant = values.serialNumber;

  return out;
}

function clampSbmuIndex(value: number): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function cloneTemplate(template: TelemetryTemplateDocument): TelemetryTemplateDocument {
  return JSON.parse(JSON.stringify(template)) as TelemetryTemplateDocument;
}
