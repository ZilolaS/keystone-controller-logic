import type { Ss40kEquipmentConfig } from "./ss40k";
import {
  resolveTelemetryTemplate,
  type TelemetryTemplateDocument,
  type TelemetryTemplateEntry,
} from "./templateAdapter";

export interface AmpaceBcu42kTemplateOptions {
  bcuIndex: number;
  modelName?: string;
  manufacturer?: string;
}

export interface AmpaceBcu42kEquipmentOptions {
  count: number;
  route?: string;
  modelName?: string;
  manufacturer?: string;
  equipmentPrefix?: string;
}

const BCU_BASE_ADDRESS = 50000;
const BCU_ADDRESS_STRIDE = 200;
export const MINI_MAX_BCU_COUNT = 2;
const TEMPLATE_PROFILE = "AMPACE_Mini_BCU_42k";

export function buildAmpaceBcu42kTemplate(
  options: AmpaceBcu42kTemplateOptions
): TelemetryTemplateDocument {
  const bcuIndex = clampBcuIndex(options.bcuIndex);
  const bcuNumber = bcuIndex + 1;
  const baseAddress = BCU_BASE_ADDRESS + bcuIndex * BCU_ADDRESS_STRIDE;
  const modelName = options.modelName || "eSpire Mini AMPACE BCU";
  const manufacturer = options.manufacturer || "Ampace";
  const template = cloneTemplate(resolveTelemetryTemplate(TEMPLATE_PROFILE));

  template.device = {
    ...template.device,
    model: `BCU ${bcuNumber}`,
    name: `${TEMPLATE_PROFILE}_BCU${bcuNumber}`,
    sourceFormat: "json-offset-template",
  };

  template.telemetry = template.telemetry.map((entry) =>
    instantiateEntry(entry, {
      baseAddress,
      batteryId: bcuNumber,
      manufacturer,
      modelName,
    })
  );

  return template;
}

export function buildAmpaceBcu42kEquipmentConfig(
  options: AmpaceBcu42kEquipmentOptions
): Ss40kEquipmentConfig {
  const count = Math.max(
    0,
    Math.min(MINI_MAX_BCU_COUNT, Math.trunc(Number(options.count) || 0))
  );
  const prefix = options.equipmentPrefix || "AMPACE_BCU";
  const route = options.route || "AMPACE";
  const out: Ss40kEquipmentConfig = {};

  for (let bcuIndex = 0; bcuIndex < count; bcuIndex += 1) {
    const equipmentId = `${prefix}_${bcuIndex + 1}`;
    out[equipmentId] = {
      profileName: `AMPACE_Mini_BCU${bcuIndex + 1}_42k`,
      route,
      template: buildAmpaceBcu42kTemplate({
        bcuIndex,
        modelName: options.modelName,
        manufacturer: options.manufacturer,
      }),
    };
  }

  return out;
}

function instantiateEntry(
  entry: TelemetryTemplateEntry,
  values: {
    baseAddress: number;
    batteryId: number;
    manufacturer: string;
    modelName: string;
  }
): TelemetryTemplateEntry {
  const out: TelemetryTemplateEntry = { ...entry };

  if (typeof out.address === "number") {
    out.address = values.baseAddress + out.address;
  }

  if (out.constant === "${batteryId}") out.constant = values.batteryId;
  if (out.constant === "${manufacturer}") out.constant = values.manufacturer;
  if (out.constant === "${modelName}") out.constant = values.modelName;

  return out;
}

function clampBcuIndex(value: number): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function cloneTemplate(template: TelemetryTemplateDocument): TelemetryTemplateDocument {
  return JSON.parse(JSON.stringify(template)) as TelemetryTemplateDocument;
}
