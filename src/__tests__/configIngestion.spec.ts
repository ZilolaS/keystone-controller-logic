import * as fs from "fs";
import * as path from "path";
import type { CustomGridProfile, SiteConfig } from "../config";
import {
  applyCloudConfigUpdates,
  loadSiteConfigCommandSpec,
  validateSiteConfig,
  type CloudConfigUpdate,
} from "../cloudConfig/engine";

function makeBaseConfig(): SiteConfig {
  return {
    system: {
      systemProfile: "eSpire280",
      controllerTimezone: "America/Los_Angeles",
      nominal: {
        voltageVll: 480,
        frequencyHz: 60,
      },
    },
    network: {
      controller: {
        ip: "192.168.1.10",
        modbusServer: {
          ip: "192.168.1.20",
          port: 502,
        },
      },
    },
    operation: {
      mode: "grid-tied",
      gridCode: "IEEE1547-2018",
      crdMode: "no-restriction",
      scheduledControlEnabled: false,
    },
    pcs: {
      pcsDaisyChain: [1, 1],
      maxChargeKw: 250,
      maxDischargeKw: 250,
    },
    mbmu: {
      sbmuStrings: [2, 2],
    },
    battery: {
      minSoc: 0.1,
      maxSoc: 0.9,
    },
    pv: {
      acInverters: [],
      curtailmentMethod: "modbus",
    },
    metering: {
      meterType: "eGauge-4015",
      modbusProfile: "udt_eGauge_V1",
      ip: "192.168.1.88",
      reads: {
        pv: true,
        pvFromInverter: false,
        utility: true,
        load: true,
      },
    },
    generator: {
      maxKw: 100,
      chargeFromGenerator: true,
      chargeKwLimit: 50,
      startSoc: 0.2,
      stopSoc: 0.8,
      controlType: "RemoteIO",
    },
  };
}

function makeCustomGridProfile(): CustomGridProfile {
  return {
    gridProfile: "site-custom-rule21",
    voltageRideThrough: [],
    frequencyRideThrough: [],
    voltVar: {
      enabled: false,
      points: [],
    },
    freqWatt: {
      enabled: false,
      droopPercent: 5,
      deadbandHz: 0.036,
      minHz: 57,
      maxHz: 62,
    },
    voltWatt: {
      enabled: false,
      points: [],
    },
    rampRates: {
      startupPctPerSec: 10,
      normalPctPerSec: 20,
    },
    reconnection: {
      delaySec: 300,
      vMinPu: 0.88,
      vMaxPu: 1.1,
      fMinHz: 59.3,
      fMaxHz: 60.5,
    },
  };
}

function makeAcInverters() {
  return [
    {
      type: "Chint",
      model: "CPS-60",
      ratedKwAc: 60,
      ip: "192.168.1.201",
      port: 502,
      modbusProfile: "chint_cps_v1",
    },
    {
      type: "SMA",
      model: "SunnyTripower",
      ratedKwAc: 50,
      ip: "192.168.1.202",
      port: 1502,
      modbusProfile: "sma_stp_v1",
    },
  ];
}

describe("Cloud SiteConfig ingestion", () => {
  test("loads authoritative command spec from YAML", () => {
    const spec = loadSiteConfigCommandSpec(true);

    expect(spec.commands["SITE.SystemProfile"]).toBeDefined();
    expect(spec.commands["SITE.ControllerNetwork"]).toBeDefined();
    expect(
      spec.commands["SITE.ControllerNetwork"].fields["ModbusServerPort"].dtype
    ).toBe("Number");
  });

  test("maps representative command args into SiteConfig", () => {
    const base = makeBaseConfig();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.ControllerNetwork",
        values: {
          ControllerIp: "10.20.30.40",
          ModbusServerIp: "10.20.30.50",
          ModbusServerPort: 1502,
        },
      },
    ];

    const result = applyCloudConfigUpdates(base, updates);
    expect(result.success).toBe(true);
    expect(result.nextConfig.network.controller.ip).toBe("10.20.30.40");
    expect(result.nextConfig.network.controller.modbusServer.ip).toBe(
      "10.20.30.50"
    );
    expect(result.nextConfig.network.controller.modbusServer.port).toBe(1502);
    expect(result.restartRequired).toBe(false);
  });

  test("site options validate profile, timezone, and network fields", () => {
    const base = makeBaseConfig();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.SystemProfile",
        values: {
          SystemProfile: "MINI-60-90-163-480",
        },
      },
      {
        commandId: "SITE.ControllerTimezone",
        values: {
          ControllerTimezone: "America/New_York",
        },
      },
      {
        commandId: "SITE.ControllerNetwork",
        values: {
          ControllerIp: "10.10.0.20",
          ModbusServerIp: "10.10.0.21",
          ModbusServerPort: 1502,
        },
      },
    ];

    const result = applyCloudConfigUpdates(base, updates);

    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.nextConfig.system.systemProfile).toBe("MINI-60-90-163-480");
    expect(result.nextConfig.system.controllerTimezone).toBe("America/New_York");
    expect(result.nextConfig.network.controller.ip).toBe("10.10.0.20");
    expect(result.nextConfig.network.controller.modbusServer).toEqual({
      ip: "10.10.0.21",
      port: 1502,
    });
    expect(result.nextConfig.pcs).toBeUndefined();
    expect(result.nextConfig.mbmu).toBeUndefined();
    expect(result.nextConfig.system.nominal.voltageVll).toBe(480);
    expect(result.nextCapabilities.isMini).toBe(true);
    expect(result.nextCapabilities.miniModelInfo).toMatchObject({
      modelCode: "MINI-60-90-163-480",
      pcsKw: 60,
      maxChargeKw: 60,
      maxDischargeKw: 60,
      dcPvKw: 90,
      batteryKwh: 163,
      voltageVll: 480,
    });
  });

  test("rejects invalid site profile and timezone during post-apply validation", () => {
    const badProfile = makeBaseConfig();
    badProfile.system.systemProfile = "custom-unknown";

    expect(validateSiteConfig(badProfile)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "system.systemProfile",
        }),
      ])
    );

    const result = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.ControllerTimezone",
        values: {
          ControllerTimezone: "Mars/Olympus_Mons",
        },
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.nextConfig.system.controllerTimezone).toBe(
      "America/Los_Angeles"
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "system.controllerTimezone",
          status: "rejected",
        }),
      ])
    );
  });

  test("accepts NANO system profile and removes eSpire280-only topology", () => {
    const result = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.SystemProfile",
        values: { SystemProfile: "NANO" },
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.nextConfig.system.systemProfile).toBe("NANO");
    expect(result.nextConfig.pcs).toBeUndefined();
    expect(result.nextConfig.mbmu).toBeUndefined();
    expect(result.nextCapabilities).toMatchObject({
      isNano: true,
      isMini: false,
      is280: false,
      hasPcs: true,
      hasMbmu: false,
    });
  });

  test("validates Mini model profile size options", () => {
    const invalidPcs = makeBaseConfig();
    invalidPcs.system.systemProfile = "MINI-40-90-163-480";
    expect(validateSiteConfig(invalidPcs)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "system.systemProfile",
          message: "systemProfile must be eSpire280, NANO, or a valid MINI-* profile",
        }),
      ])
    );

    const invalidPv = makeBaseConfig();
    invalidPv.system.systemProfile = "MINI-60-120-163-480";
    expect(validateSiteConfig(invalidPv)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "system.systemProfile",
        }),
      ])
    );

    const invalidVoltage = makeBaseConfig();
    invalidVoltage.system.systemProfile = "MINI-60-90-163-240";
    expect(validateSiteConfig(invalidVoltage)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "system.systemProfile",
        }),
      ])
    );
  });

  test("rejects invalid enum and number range values", () => {
    const base = makeBaseConfig();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.GridCode",
        values: {
          GridCode: 99,
        },
      },
      {
        commandId: "SITE.ControllerNetwork",
        values: {
          ModbusServerPort: 99999,
        },
      },
    ];

    const result = applyCloudConfigUpdates(base, updates);
    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "SITE.GridCode",
          arg: "GridCode",
          status: "rejected",
        }),
        expect.objectContaining({
          commandId: "SITE.ControllerNetwork",
          arg: "ModbusServerPort",
          status: "rejected",
        }),
      ])
    );
  });

  test("microgrid options apply grid compliance and operation policy", () => {
    const customProfile = makeCustomGridProfile();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.GridCode",
        values: {
          GridCode: "Custom",
        },
      },
      {
        commandId: "SITE.CustomGridProfileJson",
        values: {
          CustomGridProfileJson: JSON.stringify(customProfile),
        },
      },
      {
        commandId: "SITE.CRDMode",
        values: {
          CRDMode: "no-exchange",
        },
      },
      {
        commandId: "SITE.SiteExportPolicy",
        values: {
          SiteExportMode: "no-export",
          SiteExportTargetImportKw: 0.5,
          SiteExportDeadbandKw: 0.8,
        },
      },
      {
        commandId: "SITE.ScheduledControlEnabled",
        values: {
          ScheduledControlEnabled: 1,
        },
      },
    ];

    const result = applyCloudConfigUpdates(makeBaseConfig(), updates);

    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(false);
    expect(result.nextConfig.operation.gridCode).toBe("Custom");
    expect(result.nextConfig.operation.customGridProfile).toEqual(customProfile);
    expect(result.nextConfig.operation.crdMode).toBe("no-exchange");
    expect(result.nextConfig.operation.siteExportMode).toBe("no-export");
    expect(result.nextConfig.operation.siteExportTargetImportKw).toBe(0.5);
    expect(result.nextConfig.operation.siteExportDeadbandKw).toBe(0.8);
    expect(result.nextConfig.operation.scheduledControlEnabled).toBe(true);
    expect(result.nextCapabilities.usesCustomGrid).toBe(true);
    expect(result.nextCapabilities.crdRestricted).toBe(true);
    expect(result.nextCapabilities.siteExportRestricted).toBe(true);
    expect(result.nextCapabilities.scheduledControlEnabled).toBe(true);
  });

  test("microgrid validation requires well-formed custom grid profile only for Custom grid code", () => {
    const missingProfile = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.GridCode",
        values: {
          GridCode: "Custom",
        },
      },
    ]);

    expect(missingProfile.success).toBe(false);
    expect(missingProfile.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "operation.customGridProfile",
          status: "rejected",
        }),
      ])
    );

    const malformedProfile = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.CustomGridProfileJson",
        values: {
          CustomGridProfileJson: JSON.stringify({ gridProfile: "incomplete" }),
        },
      },
    ]);

    expect(malformedProfile.success).toBe(true);
    expect(malformedProfile.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arg: "CustomGridProfileJson",
          status: "rejected",
        }),
      ])
    );

    const baseWithCustom = makeBaseConfig();
    baseWithCustom.operation.gridCode = "Custom";
    baseWithCustom.operation.customGridProfile = makeCustomGridProfile();
    const standardGrid = applyCloudConfigUpdates(baseWithCustom, [
      {
        commandId: "SITE.GridCode",
        values: {
          GridCode: "Rule21",
        },
      },
    ]);

    expect(standardGrid.success).toBe(true);
    expect(standardGrid.nextConfig.operation.gridCode).toBe("Rule21");
    expect(standardGrid.nextConfig.operation.customGridProfile).toBeUndefined();
  });

  test("classifies topology updates as restart-required", () => {
    const base = makeBaseConfig();
    const updates: CloudConfigUpdate[] = [
      {
        commandId: "SITE.PcsDaisyChain",
        values: {
          PcsDaisyChain: "[1,2,1]",
        },
      },
    ];

    const result = applyCloudConfigUpdates(base, updates);
    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "SITE.PcsDaisyChain",
          arg: "PcsDaisyChain",
          status: "applied-restart-required",
          classification: "restart",
        }),
      ])
    );
  });

  test("battery options apply 280 topology, site limits, and SOC policy", () => {
    const result = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.PcsDaisyChain",
        values: {
          PcsDaisyChain: "[1,2,1]",
        },
      },
      {
        commandId: "SITE.PcsSiteLimits",
        values: {
          SiteMaxChargekW: 125,
          SiteMaxDischargekW: 175,
        },
      },
      {
        commandId: "SITE.SbmuStrings",
        values: {
          SbmuStrings: "[2,3,2]",
        },
      },
      {
        commandId: "SITE.ControllerSocPolicy",
        values: {
          ControllerMinSOC: 0.2,
          ControllerMaxSOC: 0.85,
          ControllerSocLow: 0.3,
          ControllerSocLowRecover: 0.34,
          ControllerSocHigh: 0.95,
          ControllerSocHighRecover: 0.92,
          ForceGridChargeSoc: 0.15,
          ForceGridChargeMinCellVoltageV: 2.95,
          ForceGridChargeKw: 10,
          BatteryPowerHeadroomKw: 2,
          BatteryCommandRampKwPerSec: 25,
        },
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.nextConfig.pcs).toEqual({
      pcsDaisyChain: [1, 2, 1],
      maxChargeKw: 125,
      maxDischargeKw: 175,
    });
    expect(result.nextConfig.mbmu).toEqual({
      sbmuStrings: [2, 3, 2],
    });
    expect(result.nextConfig.battery).toEqual({
      minSoc: 0.2,
      maxSoc: 0.85,
      socLow: 0.3,
      socLowRecover: 0.34,
      socHigh: 0.95,
      socHighRecover: 0.92,
      forceGridChargeSoc: 0.15,
      forceGridChargeMinCellVoltageV: 2.95,
      forceGridChargeKw: 10,
      powerHeadroomKw: 2,
      commandRampKwPerSec: 25,
    });
  });

  test("battery topology is eSpire-only while site limits can cap Mini dispatch", () => {
    const miniBase = makeBaseConfig();
    miniBase.system.systemProfile = "MINI-60-90-163-480";
    delete miniBase.pcs;
    delete miniBase.mbmu;

    const rejectedTopology = applyCloudConfigUpdates(miniBase, [
      {
        commandId: "SITE.PcsDaisyChain",
        values: {
          PcsDaisyChain: "[1]",
        },
      },
      {
        commandId: "SITE.SbmuStrings",
        values: {
          SbmuStrings: "[2]",
        },
      },
    ]);

    expect(rejectedTopology.success).toBe(true);
    expect(rejectedTopology.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arg: "PcsDaisyChain",
          status: "rejected",
        }),
        expect.objectContaining({
          arg: "SbmuStrings",
          status: "rejected",
        }),
      ])
    );
    expect(rejectedTopology.nextConfig.pcs).toBeUndefined();
    expect(rejectedTopology.nextConfig.mbmu).toBeUndefined();

    const cappedMini = applyCloudConfigUpdates(miniBase, [
      {
        commandId: "SITE.PcsSiteLimits",
        values: {
          SiteMaxChargekW: 40,
          SiteMaxDischargekW: 50,
        },
      },
    ]);

    expect(cappedMini.success).toBe(true);
    expect(cappedMini.nextConfig.pcs).toEqual({
      pcsDaisyChain: [],
      maxChargeKw: 40,
      maxDischargeKw: 50,
    });
    expect(cappedMini.nextCapabilities.isMini).toBe(true);
  });

  test("battery validation rejects malformed topology and SOC policy", () => {
    const invalidTopology = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.PcsDaisyChain",
        values: {
          PcsDaisyChain: "[1,0,2]",
        },
      },
      {
        commandId: "SITE.SbmuStrings",
        values: {
          SbmuStrings: "[2,-1]",
        },
      },
    ]);

    expect(invalidTopology.success).toBe(true);
    expect(invalidTopology.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arg: "PcsDaisyChain",
          status: "rejected",
        }),
        expect.objectContaining({
          arg: "SbmuStrings",
          status: "rejected",
        }),
      ])
    );

    const invalidSoc = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.ControllerSocPolicy",
        values: {
          ControllerMinSOC: 0.9,
          ControllerMaxSOC: 0.3,
        },
      },
    ]);

    expect(invalidSoc.success).toBe(false);
    expect(invalidSoc.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "battery",
          status: "rejected",
        }),
      ])
    );
  });

  test("AC-coupled PV options apply inverter inventory and curtailment method", () => {
    const inverters = makeAcInverters();
    const result = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.AcInvertersJson",
        values: {
          AcInvertersJson: JSON.stringify(inverters),
        },
      },
      {
        commandId: "SITE.PvCurtailmentMethod",
        values: {
          PvCurtailmentMethod: "frequency-shifting",
        },
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.nextConfig.pv.acInverters).toEqual(inverters);
    expect(result.nextConfig.pv.curtailmentMethod).toBe("frequency-shifting");
    expect(result.nextCapabilities.hasACPV).toBe(true);
    expect(result.nextCapabilities.pvCurtailmentViaFrequencyShift).toBe(true);
  });

  test("AC-coupled PV validation rejects malformed inverter inventory and curtailment method", () => {
    const malformedInventory = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.AcInvertersJson",
        values: {
          AcInvertersJson: JSON.stringify([
            {
              type: "Chint",
              model: "CPS-60",
              ratedKwAc: 0,
              ip: "192.168.1.201",
              port: 502,
              modbusProfile: "chint_cps_v1",
            },
          ]),
        },
      },
    ]);

    expect(malformedInventory.success).toBe(true);
    expect(malformedInventory.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arg: "AcInvertersJson",
          status: "rejected",
        }),
      ])
    );

    const invalid = makeBaseConfig();
    invalid.pv.curtailmentMethod = "volt-watt" as any;
    expect(validateSiteConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "pv.curtailmentMethod",
        }),
      ])
    );

    const invalidSiteExport = makeBaseConfig();
    invalidSiteExport.operation.siteExportMode = "export-limit" as any;
    invalidSiteExport.operation.siteExportTargetImportKw = -1;
    expect(validateSiteConfig(invalidSiteExport)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "operation.siteExportMode",
        }),
        expect.objectContaining({
          path: "operation.siteExportTargetImportKw",
        }),
      ])
    );
  });

  test("protection option applies and clears islanding device", () => {
    const applied = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.IslandingDevice",
        values: {
          IslandingDevice: "SEL851",
        },
      },
    ]);

    expect(applied.success).toBe(true);
    expect(applied.restartRequired).toBe(false);
    expect(applied.nextConfig.islanding).toEqual({
      device: "SEL851",
    });
    expect(applied.nextCapabilities.hasIslanding).toBe(true);

    const cleared = applyCloudConfigUpdates(applied.nextConfig, [
      {
        commandId: "SITE.IslandingDevice",
        values: {
          IslandingDevice: "None",
        },
      },
    ]);

    expect(cleared.success).toBe(true);
    expect(cleared.nextConfig.islanding).toBeUndefined();
    expect(cleared.nextCapabilities.hasIslanding).toBe(false);
  });

  test("protection validation rejects unsupported islanding device", () => {
    const invalid = makeBaseConfig();
    invalid.islanding = {
      device: "GENERIC-RELAY" as any,
    };

    expect(validateSiteConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "islanding.device",
        }),
      ])
    );
  });

  test("metering option applies primary meter integration and read sources", () => {
    const result = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.PrimaryMeterIntegration",
        values: {
          PrimaryMeterModel: "Accuenergy-AcuRev",
          MeterModbusProfile: "acurev_v1",
          MeterIp: "10.2.3.4",
          ReadsPV: 0,
          PVFromInverter: 1,
          ReadsUtility: 1,
          ReadsLoad: 1,
        },
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.nextConfig.metering).toEqual({
      meterType: "Accuenergy-AcuRev",
      modbusProfile: "acurev_v1",
      ip: "10.2.3.4",
      reads: {
        pv: false,
        pvFromInverter: true,
        utility: true,
        load: true,
      },
    });
    expect(result.nextCapabilities.hasMeterIntegration).toBe(true);
  });

  test("metering validation rejects ambiguous or malformed read source flags", () => {
    const ambiguous = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.PrimaryMeterIntegration",
        values: {
          ReadsPV: 1,
          PVFromInverter: 1,
        },
      },
    ]);

    expect(ambiguous.success).toBe(false);
    expect(ambiguous.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "metering.reads",
          status: "rejected",
        }),
      ])
    );

    const invalid = makeBaseConfig();
    invalid.metering.reads.utility = "yes" as any;
    expect(validateSiteConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "metering.reads.utility",
        }),
      ])
    );
  });

  test("generator option applies dispatch and charging policy", () => {
    const result = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.GeneratorPolicy",
        values: {
          GeneratorMaxkW: 120,
          ChargeFromGenerator: 1,
          GeneratorChargekWLimit: 80,
          GeneratorStartSOC: 0.25,
          GeneratorStopSOC: 0.85,
          GeneratorControlType: "SEL",
        },
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.restartRequired).toBe(false);
    expect(result.nextConfig.generator).toEqual({
      maxKw: 120,
      chargeFromGenerator: true,
      chargeKwLimit: 80,
      startSoc: 0.25,
      stopSoc: 0.85,
      controlType: "SEL",
    });
    expect(result.nextCapabilities.hasGenerator).toBe(true);
  });

  test("generator validation rejects invalid policy values", () => {
    const invalidSoc = applyCloudConfigUpdates(makeBaseConfig(), [
      {
        commandId: "SITE.GeneratorPolicy",
        values: {
          GeneratorStartSOC: 0.9,
          GeneratorStopSOC: 0.4,
        },
      },
    ]);

    expect(invalidSoc.success).toBe(false);
    expect(invalidSoc.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "generator",
          status: "rejected",
        }),
      ])
    );

    const invalid = makeBaseConfig();
    invalid.generator!.maxKw = -1;
    invalid.generator!.chargeKwLimit = -2;
    invalid.generator!.controlType = "CAN" as any;

    expect(validateSiteConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "generator.maxKw",
        }),
        expect.objectContaining({
          path: "generator.chargeKwLimit",
        }),
        expect.objectContaining({
          path: "generator.controlType",
        }),
      ])
    );
  });

  test("end-to-end fixture updates recompute capabilities", () => {
    const fixturePath = path.resolve(
      __dirname,
      "fixtures",
      "cloudConfigUpdates.json"
    );
    const fixtureUpdates = JSON.parse(
      fs.readFileSync(fixturePath, "utf8")
    ) as CloudConfigUpdate[];

    const result = applyCloudConfigUpdates(makeBaseConfig(), fixtureUpdates);

    expect(result.success).toBe(true);
    expect(result.nextCapabilities.scheduledControlEnabled).toBe(true);
    expect(result.nextCapabilities.crdRestricted).toBe(true);
    expect(result.restartRequired).toBe(true);
  });

  test("validateSiteConfig catches structural errors", () => {
    const invalid = makeBaseConfig();
    invalid.battery.minSoc = 0.95;
    invalid.battery.maxSoc = 0.2;

    const issues = validateSiteConfig(invalid);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "battery",
        }),
      ])
    );
  });

  test("validates configured Modbus assets and server slots", () => {
    const valid = makeBaseConfig();
    valid.network.serverSlots = [
      { key: "server_1", ip: "192.168.1.20", port: 502 },
    ];
    valid.network.assets = [
      {
        id: "PCS",
        role: "pcs",
        template: "Delta_280_ss40k",
        ip: "192.168.1.20",
        port: 502,
        unitId: 1,
        serverSlot: "server_1",
      },
    ];

    expect(validateSiteConfig(valid)).toEqual([]);

    const invalid = makeBaseConfig();
    invalid.network.serverSlots = [
      { key: "server_1", ip: "192.168.1.20", port: 502 },
    ];
    invalid.network.assets = [
      {
        id: "PCS",
        role: "pcs",
        ip: "192.168.1.21",
        port: 70000,
        unitId: 300,
        serverSlot: "server_99",
      },
    ];

    expect(validateSiteConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "network.assets.0.port" }),
        expect.objectContaining({ path: "network.assets.0.unitId" }),
        expect.objectContaining({ path: "network.assets.0.serverSlot" }),
      ])
    );
  });

  test("validates site-configured meter register maps", () => {
    const valid = makeBaseConfig();
    valid.metering.meters = [
      {
        id: "Meter2",
        meterType: "eGauge",
        baseProfile: "eGauge_Mission_Energy_Meter2_ss40k",
        ip: "192.168.1.65",
        route: "Meter2",
        registerMap: [
          {
            signal: "acCoupledPvKw",
            tagID: "Meter2.Solar",
            register: 9004,
            function: "IRF",
            scale: 0.001,
          },
        ],
      },
    ];

    expect(validateSiteConfig(valid)).toEqual([]);

    const invalid = makeBaseConfig();
    invalid.metering.meters = [
      {
        id: "",
        meterType: "eGauge",
        ip: "",
        port: 70000,
        unitId: 300,
        registerMap: [
          {
            signal: "custom",
            tagID: "Meter.Bad",
            register: -1,
            function: "" as any,
            scale: Number.NaN,
          },
        ],
      },
    ];

    expect(validateSiteConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "metering.meters.0.id" }),
        expect.objectContaining({ path: "metering.meters.0.ip" }),
        expect.objectContaining({ path: "metering.meters.0.port" }),
        expect.objectContaining({ path: "metering.meters.0.unitId" }),
        expect.objectContaining({ path: "metering.meters.0.registerMap.0.register" }),
        expect.objectContaining({ path: "metering.meters.0.registerMap.0.function" }),
        expect.objectContaining({ path: "metering.meters.0.registerMap.0.scale" }),
      ])
    );
  });

  test("validates battery cell voltage policy ordering", () => {
    const invalid = makeBaseConfig();
    invalid.battery.cellVoltagePolicy = {
      maxCellVoltageChargeBlockV: 3.5,
      maxCellVoltageChargeRecoverV: 3.6,
      minCellVoltageDischargeBlockV: 3.1,
      minCellVoltageDischargeRecoverV: 3.0,
      chargeTaperStartV: 3.6,
      chargeTaperEndV: 3.5,
      chargeTaperMinFraction: 1.2,
    };

    expect(validateSiteConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "maxCellVoltageChargeRecoverV must be <= maxCellVoltageChargeBlockV",
        }),
        expect.objectContaining({
          message:
            "minCellVoltageDischargeRecoverV must be >= minCellVoltageDischargeBlockV",
        }),
        expect.objectContaining({
          message: "chargeTaperStartV must be < chargeTaperEndV",
        }),
        expect.objectContaining({
          path: "battery.cellVoltagePolicy.chargeTaperMinFraction",
        }),
      ])
    );
  });
});
