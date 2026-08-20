import type { SiteConfig } from "../config";
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

  return equipmentConfig;
}
