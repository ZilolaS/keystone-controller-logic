import type { IslandingDeviceType, SiteConfig } from "../config";
import {
  deriveCapabilities,
  parseMiniModel,
  type MiniModelInfo,
  type SiteCapabilities,
} from "../capabilities";
import {
  loadSiteConfigCommandSpec,
  type CloudCommandSpec,
  type CloudConfigSpec,
} from "../cloudConfig/engine";

export type ControlProductLine = "280" | "Mini" | "NANO" | "unknown";

export type ControlDesignRole =
  | "site-identity"
  | "network-integration"
  | "grid-compliance"
  | "dispatch-policy"
  | "dispatch-limit"
  | "battery-topology"
  | "pv-integration"
  | "pv-control"
  | "protection-integration"
  | "telemetry-source"
  | "generator-control";

export type PcsLimitSource =
  | "site-config"
  | "mini-profile"
  | "mini-profile-capped"
  | "disabled";
export type ProtectionStrategy = "none" | "sel-relay" | "transfer-switch";
export type ReadingSource = "meter" | "inverter" | "not-configured";

export interface ControlCommandDesign {
  commandId: string;
  title: string;
  sectionId?: string;
  subsectionId?: string;
  access?: string;
  role: ControlDesignRole;
  args: string[];
}

export interface UnifiedControlDesign {
  productLine: ControlProductLine;
  capabilities: SiteCapabilities;
  commands: ControlCommandDesign[];
  site: {
    systemProfile: string;
    miniModel?: MiniModelInfo;
    controllerTimezone: string;
    controllerNetwork: {
      controllerIp: string;
      modbusServerIp: string;
      modbusServerPort: number;
    };
  };
  gridCompliance: {
    gridCode: SiteConfig["operation"]["gridCode"];
    usesCustomGrid: boolean;
    customGridProfileName?: string;
  };
  battery: {
    topology: {
      pcsDaisyChain: number[];
      sbmuStrings: number[];
      pcsCount: number;
      sbmuStringCount: number;
    };
  };
  pv: {
    acInverterCount: number;
    totalRatedKwAc: number;
    curtailmentMethod: "modbus" | "frequency-shifting" | "none";
    dcCoupledToMiniPcs: boolean;
  };
  protection: {
    islandingDevice?: IslandingDeviceType;
    strategy: ProtectionStrategy;
    outageSignalSource: "none" | "sel-bitfield" | "ats-state";
    controlsPcsRunMode: boolean;
    controlsRemoteInterlock: boolean;
  };
  metering: {
    meterType: string;
    modbusProfile: string;
    ip: string;
    calculatedReadings: string[];
    sources: {
      utilityPowerKw: ReadingSource;
      siteLoadKw: ReadingSource;
      pvKw: ReadingSource;
    };
  };
  policies: {
    crdMode: SiteConfig["operation"]["crdMode"];
    siteExport: {
      mode: NonNullable<SiteConfig["operation"]["siteExportMode"]>;
      targetImportKw: number;
      deadbandKw: number;
    };
    scheduledControlEnabled: boolean;
    soc: {
      min: number;
      max: number;
      low?: number;
      lowRecover?: number;
      high?: number;
      highRecover?: number;
      forceGridChargeSoc?: number;
      forceGridChargeMinCellVoltageV?: number;
      forceGridChargeKw?: number;
      powerHeadroomKw?: number;
      commandRampKwPerSec?: number;
    };
  };
  limits: {
    pcs: {
      maxChargeKw: number;
      maxDischargeKw: number;
      source: PcsLimitSource;
    };
    generator?: {
      maxKw: number;
      chargeFromGenerator: boolean;
      chargeKwLimit: number;
      startSoc: number;
      stopSoc: number;
      controlType: string;
    };
  };
  routing: {
    pcsDispatch: "site-pcs" | "mini-pcs" | "none";
    pvCurtailment: "modbus" | "frequency-shifting" | "none";
    generator: "RemoteIO" | "SEL" | "none";
  };
  telemetryRequirements: {
    utilityPowerKw: boolean;
    siteLoadKw: boolean;
    pvKw: boolean;
    protectionState: boolean;
    generatorState: boolean;
  };
}

const COMMAND_ROLES: Record<string, ControlDesignRole> = {
  "SITE.SystemProfile": "site-identity",
  "SITE.ControllerTimezone": "site-identity",
  "SITE.ControllerNetwork": "network-integration",
  "SITE.GridCode": "grid-compliance",
  "SITE.CustomGridProfileJson": "grid-compliance",
  "SITE.CRDMode": "dispatch-policy",
  "SITE.SiteExportPolicy": "pv-control",
  "SITE.ScheduledControlEnabled": "dispatch-policy",
  "SITE.PcsDaisyChain": "battery-topology",
  "SITE.PcsSiteLimits": "dispatch-limit",
  "SITE.SbmuStrings": "battery-topology",
  "SITE.ControllerSocPolicy": "dispatch-policy",
  "SITE.AcInvertersJson": "pv-integration",
  "SITE.PvCurtailmentMethod": "pv-control",
  "SITE.IslandingDevice": "protection-integration",
  "SITE.PrimaryMeterIntegration": "telemetry-source",
  "SITE.GeneratorPolicy": "generator-control",
};

export function buildUnifiedControlDesign(
  config: SiteConfig,
  spec: CloudConfigSpec = loadSiteConfigCommandSpec()
): UnifiedControlDesign {
  const capabilities = deriveCapabilities(config);
  const productLine = resolveProductLine(capabilities);
  const pcsLimits = resolvePcsLimits(config, capabilities);
  const pvCurtailment = config.pv.curtailmentMethod || "none";
  const metering = resolveMeteringDesign(config);

  return {
    productLine,
    capabilities,
    commands: Object.values(spec.commands)
      .map(toControlCommandDesign)
      .sort((a, b) => a.commandId.localeCompare(b.commandId)),
    site: {
      systemProfile: config.system.systemProfile,
      miniModel: capabilities.miniModelInfo || undefined,
      controllerTimezone: config.system.controllerTimezone,
      controllerNetwork: {
        controllerIp: config.network.controller.ip,
        modbusServerIp: config.network.controller.modbusServer.ip,
        modbusServerPort: config.network.controller.modbusServer.port,
      },
    },
    gridCompliance: {
      gridCode: config.operation.gridCode,
      usesCustomGrid: config.operation.gridCode === "Custom",
      customGridProfileName: config.operation.customGridProfile?.gridProfile,
    },
    battery: {
      topology: {
        pcsDaisyChain: config.pcs?.pcsDaisyChain || [],
        sbmuStrings: config.mbmu?.sbmuStrings || [],
        pcsCount: sum(config.pcs?.pcsDaisyChain),
        sbmuStringCount: sum(config.mbmu?.sbmuStrings),
      },
    },
    pv: {
      acInverterCount: config.pv.acInverters.length,
      totalRatedKwAc: sum(
        config.pv.acInverters.map((inverter) => inverter.ratedKwAc)
      ),
      curtailmentMethod:
        config.pv.curtailmentMethod === "modbus" ||
        config.pv.curtailmentMethod === "frequency-shifting"
          ? config.pv.curtailmentMethod
          : "none",
      dcCoupledToMiniPcs: resolveMiniDcCoupledPv(config, productLine),
    },
    protection: resolveProtectionDesign(config),
    metering,
    policies: {
      crdMode: config.operation.crdMode,
      siteExport: {
        mode: config.operation.siteExportMode || "no-restriction",
        targetImportKw: config.operation.siteExportTargetImportKw ?? 0.5,
        deadbandKw: config.operation.siteExportDeadbandKw ?? 0.8,
      },
      scheduledControlEnabled: config.operation.scheduledControlEnabled,
      soc: {
        min: config.battery.minSoc,
        max: config.battery.maxSoc,
        low: config.battery.socLow,
        lowRecover: config.battery.socLowRecover,
        high: config.battery.socHigh,
        highRecover: config.battery.socHighRecover,
        forceGridChargeSoc: config.battery.forceGridChargeSoc,
        forceGridChargeMinCellVoltageV:
          config.battery.forceGridChargeMinCellVoltageV,
        forceGridChargeKw: config.battery.forceGridChargeKw,
        powerHeadroomKw: config.battery.powerHeadroomKw,
        commandRampKwPerSec: config.battery.commandRampKwPerSec,
      },
    },
    limits: {
      pcs: pcsLimits,
      generator: config.generator
        ? {
            maxKw: config.generator.maxKw,
            chargeFromGenerator: config.generator.chargeFromGenerator,
            chargeKwLimit: config.generator.chargeKwLimit,
            startSoc: config.generator.startSoc,
            stopSoc: config.generator.stopSoc,
            controlType: config.generator.controlType,
          }
        : undefined,
    },
    routing: {
      pcsDispatch:
        productLine === "280"
          ? "site-pcs"
          : productLine === "NANO"
            ? "site-pcs"
          : productLine === "Mini"
            ? "mini-pcs"
            : "none",
      pvCurtailment:
        pvCurtailment === "modbus" || pvCurtailment === "frequency-shifting"
          ? pvCurtailment
          : "none",
      generator: config.generator?.controlType || "none",
    },
    telemetryRequirements: {
      utilityPowerKw:
        (config.operation.crdMode !== "no-restriction" ||
          config.operation.siteExportMode === "no-export") &&
        metering.sources.utilityPowerKw !== "not-configured",
      siteLoadKw:
        metering.sources.siteLoadKw !== "not-configured" &&
        capabilities.hasACPV &&
        (config.operation.mode === "off-grid" ||
          config.pv.curtailmentMethod === "frequency-shifting"),
      pvKw:
        (capabilities.hasACPV || resolveMiniDcCoupledPv(config, productLine)) &&
        metering.sources.pvKw !== "not-configured",
      protectionState: capabilities.hasIslanding,
      generatorState: capabilities.hasGenerator,
    },
  };
}

export function assertUnifiedControlDesignCoverage(
  spec: CloudConfigSpec = loadSiteConfigCommandSpec()
): string[] {
  return Object.keys(spec.commands)
    .filter((commandId) => !COMMAND_ROLES[commandId])
    .sort();
}

function toControlCommandDesign(command: CloudCommandSpec): ControlCommandDesign {
  return {
    commandId: command.commandId,
    title: command.title,
    sectionId: command.sectionId,
    subsectionId: command.subsectionId,
    access: command.access,
    role: COMMAND_ROLES[command.commandId] || "site-identity",
    args: Object.keys(command.fields).sort(),
  };
}

function resolveProductLine(capabilities: SiteCapabilities): ControlProductLine {
  if (capabilities.is280) return "280";
  if (capabilities.isMini) return "Mini";
  if (capabilities.isNano) return "NANO";
  return "unknown";
}

function resolveProtectionDesign(
  config: SiteConfig
): UnifiedControlDesign["protection"] {
  const device = config.islanding?.device;
  if (!device) {
    return {
      strategy: "none",
      outageSignalSource: "none",
      controlsPcsRunMode: false,
      controlsRemoteInterlock: false,
    };
  }

  if (device === "ASCO-ATS" || device === "EATON-ATS") {
    return {
      islandingDevice: device,
      strategy: "transfer-switch",
      outageSignalSource: "ats-state",
      controlsPcsRunMode: true,
      controlsRemoteInterlock: false,
    };
  }

  return {
    islandingDevice: device,
    strategy: "sel-relay",
    outageSignalSource: "sel-bitfield",
    controlsPcsRunMode: true,
    controlsRemoteInterlock: device === "SEL851",
  };
}

function resolveMeteringDesign(
  config: SiteConfig
): UnifiedControlDesign["metering"] {
  const reads = config.metering.reads;
  return {
    meterType: config.metering.meterType,
    modbusProfile: config.metering.modbusProfile,
    ip: config.metering.ip,
    calculatedReadings: Object.keys(config.metering.calculations || {}).sort(),
    sources: {
      utilityPowerKw:
        reads.utility || config.metering.calculations?.utilityPowerKw
          ? "meter"
          : "not-configured",
      siteLoadKw:
        reads.load || config.metering.calculations?.siteLoadKw
          ? "meter"
          : "not-configured",
      pvKw: reads.pv
        ? "meter"
        : reads.pvFromInverter
          ? "inverter"
          : config.metering.calculations?.pvKw
            ? "meter"
          : "not-configured",
    },
  };
}

function resolveMiniDcCoupledPv(
  config: SiteConfig,
  productLine: ControlProductLine
): boolean {
  if (productLine !== "Mini") return false;
  if (config.pv.dcCoupledToMiniPcs != null) {
    return config.pv.dcCoupledToMiniPcs;
  }
  return parseMiniModel(config.system.systemProfile)?.hasDcPvConverter ?? false;
}

function resolvePcsLimits(
  config: SiteConfig,
  capabilities: SiteCapabilities
): UnifiedControlDesign["limits"]["pcs"] {
  if (capabilities.miniModelInfo) {
    const profileKw = capabilities.miniModelInfo.pcsKw;
    const siteMaxChargeKw = config.pcs?.maxChargeKw;
    const siteMaxDischargeKw = config.pcs?.maxDischargeKw;
    const maxChargeKw =
      siteMaxChargeKw != null && siteMaxChargeKw > 0
        ? Math.min(profileKw, siteMaxChargeKw)
        : profileKw;
    const maxDischargeKw =
      siteMaxDischargeKw != null && siteMaxDischargeKw > 0
        ? Math.min(profileKw, siteMaxDischargeKw)
        : profileKw;

    return {
      maxChargeKw,
      maxDischargeKw,
      source:
        maxChargeKw !== profileKw || maxDischargeKw !== profileKw
          ? "mini-profile-capped"
          : "mini-profile",
    };
  }

  if (config.pcs) {
    return {
      maxChargeKw: Math.max(0, config.pcs.maxChargeKw),
      maxDischargeKw: Math.max(0, config.pcs.maxDischargeKw),
      source: "site-config",
    };
  }

  return {
    maxChargeKw: 0,
    maxDischargeKw: 0,
    source: "disabled",
  };
}

function sum(values?: number[]): number {
  return (values || []).reduce((total, value) => total + value, 0);
}
