// src/telemetry/espire290OlpCms.ts
//
// eSpire 290 battery side = OLiPower Omni BL 290 CMS (3-level BMS) with up to
// 16 BMU clusters, each with its own TMU (liquid-cooling unit). The CMS
// repeats a fixed block per cluster/TMU, so - same approach as
// ampaceBcu42k.ts - the per-cluster and per-TMU registers live in offset
// templates and are shifted to absolute addresses here.
// See docs/eSpire290_OLP_CMS_Modbus_Register_Map.md.

import type { Ss40kEquipmentConfig } from "./ss40k";
import {
  resolveTelemetryTemplate,
  type TelemetryTemplateDocument,
  type TelemetryTemplateEntry,
} from "./templateAdapter";

export interface Espire290ClusterTemplateOptions {
  clusterIndex: number;
}

export interface Espire290TmuTemplateOptions {
  tmuIndex: number;
}

export interface Espire290EquipmentOptions {
  /** Number of BMU clusters behind the CMS (1-16). TMU count is bound to it. */
  clusterCount: number;
  route?: string;
  equipmentPrefix?: string;
}

export const ESPIRE290_MAX_CLUSTERS = 16;
export const ESPIRE290_SYSTEM_PROFILE = "eSpire290_OLP_CMS_ss_TEMPLATE";

const CLUSTER_PROFILE = "eSpire290_OLP_BMS_Cluster_ss_TEMPLATE";
const CLUSTER_BASE_ADDRESS = 31981;
const CLUSTER_ADDRESS_STRIDE = 50;

const TMU_PROFILE = "eSpire290_OLP_TMU_ss_TEMPLATE";
const TMU_BASE_ADDRESS = 33162;
const TMU_ADDRESS_STRIDE = 28;

/** Holding-register control block per cluster: 40300 + 8 * clusterIndex. */
export function espire290ClusterControlBase(clusterIndex: number): number {
  return 40300 + 8 * clampIndex(clusterIndex);
}

export function buildEspire290ClusterTemplate(
  options: Espire290ClusterTemplateOptions
): TelemetryTemplateDocument {
  const clusterIndex = clampIndex(options.clusterIndex);
  const clusterNumber = clusterIndex + 1;
  return instantiate(CLUSTER_PROFILE, {
    baseAddress: CLUSTER_BASE_ADDRESS + clusterIndex * CLUSTER_ADDRESS_STRIDE,
    model: `BMS ${clusterNumber}`,
    name: `eSpire290_OLP_BMS${clusterNumber}`,
    constants: { "${clusterId}": clusterNumber },
  });
}

export function buildEspire290TmuTemplate(
  options: Espire290TmuTemplateOptions
): TelemetryTemplateDocument {
  const tmuIndex = clampIndex(options.tmuIndex);
  const tmuNumber = tmuIndex + 1;
  return instantiate(TMU_PROFILE, {
    baseAddress: TMU_BASE_ADDRESS + tmuIndex * TMU_ADDRESS_STRIDE,
    model: `TMU ${tmuNumber}`,
    name: `eSpire290_OLP_TMU${tmuNumber}`,
    constants: { "${tmuId}": tmuNumber },
  });
}

/**
 * One CMS system equipment plus one cluster + one TMU equipment per cluster,
 * all on the same Modbus connection (CMS ETH2 :503).
 */
export function buildEspire290EquipmentConfig(
  options: Espire290EquipmentOptions
): Ss40kEquipmentConfig {
  const count = Math.max(
    0,
    Math.min(ESPIRE290_MAX_CLUSTERS, Math.trunc(Number(options.clusterCount) || 0))
  );
  const prefix = options.equipmentPrefix || "E290";
  const route = options.route || "CMS";
  const out: Ss40kEquipmentConfig = {
    [`${prefix}_CMS`]: {
      profileName: ESPIRE290_SYSTEM_PROFILE,
      route,
      template: resolveTelemetryTemplate(ESPIRE290_SYSTEM_PROFILE),
    },
  };

  for (let index = 0; index < count; index += 1) {
    out[`${prefix}_BMS_${index + 1}`] = {
      profileName: `eSpire290_OLP_BMS${index + 1}`,
      route,
      template: buildEspire290ClusterTemplate({ clusterIndex: index }),
    };
    out[`${prefix}_TMU_${index + 1}`] = {
      profileName: `eSpire290_OLP_TMU${index + 1}`,
      route,
      template: buildEspire290TmuTemplate({ tmuIndex: index }),
    };
  }

  return out;
}

function instantiate(
  profile: string,
  values: {
    baseAddress: number;
    model: string;
    name: string;
    constants: Record<string, number>;
  }
): TelemetryTemplateDocument {
  const template = cloneTemplate(resolveTelemetryTemplate(profile));
  template.device = {
    ...template.device,
    model: values.model,
    name: values.name,
  };
  template.telemetry = template.telemetry.map((entry) => {
    const out: TelemetryTemplateEntry = { ...entry };
    if (typeof out.address === "number") {
      out.address = values.baseAddress + out.address;
    }
    if (typeof out.constant === "string" && out.constant in values.constants) {
      out.constant = values.constants[out.constant];
    }
    return out;
  });
  return template;
}

function clampIndex(value: number): number {
  return Math.max(
    0,
    Math.min(ESPIRE290_MAX_CLUSTERS - 1, Math.trunc(Number(value) || 0))
  );
}

function cloneTemplate(template: TelemetryTemplateDocument): TelemetryTemplateDocument {
  return JSON.parse(JSON.stringify(template)) as TelemetryTemplateDocument;
}
