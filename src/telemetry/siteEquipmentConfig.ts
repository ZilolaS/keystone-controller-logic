import type { SiteConfig } from "../config";
import { MINI_MAX_BCU_COUNT, buildAmpaceBcu42kEquipmentConfig } from "./ampaceBcu42k";
import { buildConfiguredEgaugeTemplates } from "./egaugeConfigTemplate";
import type { Ss40kEquipmentConfig } from "./ss40k";

export function buildSiteTelemetryEquipmentConfig(
  config: SiteConfig
): Ss40kEquipmentConfig {
  const equipmentConfig: Ss40kEquipmentConfig = {};

  for (const [equipmentId, source] of Object.entries(
    config.signalMapping?.sources || {}
  )) {
    const profileName = source.profileName || source.profile || source.modbusProfile;
    if (!profileName) continue;
    equipmentConfig[equipmentId] = {
      profileName,
      route: source.route || equipmentId,
    };
  }

  Object.assign(
    equipmentConfig,
    buildConfiguredEgaugeTemplates(config.metering)
  );

  Object.assign(equipmentConfig, buildMiniBcuEquipmentConfig(config, equipmentConfig));

  return equipmentConfig;
}

function buildMiniBcuEquipmentConfig(
  config: SiteConfig,
  equipmentConfig: Ss40kEquipmentConfig
): Ss40kEquipmentConfig {
  const rawConfig = config as any;
  const systemProfile = String(rawConfig.system?.systemProfile || "");
  if (!/^MINI-/i.test(systemProfile)) return {};

  const parents = miniBmsParents(rawConfig, equipmentConfig);
  const out: Ss40kEquipmentConfig = {};

  for (const parent of parents) {
    const count = configuredBcuCount(rawConfig, parent.equipmentId);
    if (count <= 0) continue;
    Object.assign(
      out,
      buildAmpaceBcu42kEquipmentConfig({
        count,
        route: parent.route || parent.equipmentId,
        equipmentPrefix:
          parent.equipmentId === "AMPACE"
            ? "AMPACE_BCU"
            : `${parent.equipmentId}_BCU`,
        modelName: systemProfile || "eSpire-Mini-BMS",
        manufacturer: "fortress",
      })
    );
  }

  return out;
}

function miniBmsParents(
  config: any,
  equipmentConfig: Ss40kEquipmentConfig
): Array<{ equipmentId: string; route: string }> {
  const parents = new Map<string, string>();

  for (const [equipmentId, entry] of Object.entries(equipmentConfig)) {
    const normalized =
      typeof entry === "string" ? { profileName: entry, route: equipmentId } : entry;
    if (
      normalized.profileName === "AMPACE_Mini_ss40k" ||
      normalized.profileName === "Battery_Mini"
    ) {
      parents.set(equipmentId, normalized.route || equipmentId);
    }
  }

  for (const [index, cabinet] of miniCabinets(config).entries()) {
    const equipmentId = String(
      cabinet.batteryEquipmentId ||
        cabinet.bmsEquipmentId ||
        `${cabinetId(cabinet, index)}_Battery`
    );
    parents.set(equipmentId, parents.get(equipmentId) || equipmentId);
  }

  return Array.from(parents, ([equipmentId, route]) => ({ equipmentId, route }));
}

function configuredBcuCount(config: any, parentEquipment: string): number {
  const cabinet = miniCabinets(config).find(
    (item, index) =>
      String(
        item.batteryEquipmentId ||
          item.bmsEquipmentId ||
          `${cabinetId(item, index)}_Battery`
      ) === parentEquipment
  );
  const direct = firstPositiveNumber(
    cabinet?.bcuCount,
    cabinet?.bcuQuantity,
    cabinet?.bcuQty,
    cabinet?.moduleCount,
    cabinet?.rackCount,
    cabinet?.battery?.bcuCount,
    config.battery?.bcuCount,
    config.battery?.bcuQuantity,
    config.battery?.bcuQty,
    config.system?.bcuCount
  );
  if (direct > 0) return direct;

  const match = String(config.system?.systemProfile || "").match(
    /^MINI-(\d+)-(\d+)-(\d+)(?:-|$)/i
  );
  const batteryKwh = match ? Number(match[3]) : 0;
  if (!Number.isFinite(batteryKwh) || batteryKwh <= 0) return 0;
  return Math.max(1, Math.min(MINI_MAX_BCU_COUNT, Math.round(batteryKwh / 41)));
}

function miniCabinets(config: any): any[] {
  return Array.isArray(config.mini?.cabinets)
    ? config.mini.cabinets.filter((item: any) => item && typeof item === "object")
    : [];
}

function cabinetId(cabinet: any, index: number): string {
  return String(cabinet.id || cabinet.name || `Mini${index + 1}`).replace(
    /[^A-Za-z0-9_]/g,
    "_"
  );
}

function firstPositiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      return Math.max(0, Math.min(MINI_MAX_BCU_COUNT, Math.trunc(n)));
    }
  }
  return 0;
}
