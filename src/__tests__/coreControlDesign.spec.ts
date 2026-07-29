import type { SiteConfig } from "../config";
import { initCoreControl } from "../coreControl";
import {
  assertUnifiedControlDesignCoverage,
  buildUnifiedControlDesign,
} from "../coreControl/design";
import { buildUnifiedControlRoutePlan } from "../coreControl/routes";
import { loadSiteConfigCommandSpec } from "../cloudConfig/engine";

function makeBase280Config(): SiteConfig {
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
      crdMode: "no-export",
      scheduledControlEnabled: true,
    },
    pcs: {
      pcsDaisyChain: [1, 1],
      maxChargeKw: 250,
      maxDischargeKw: 300,
    },
    mbmu: {
      sbmuStrings: [2, 2],
    },
    battery: {
      minSoc: 0.1,
      maxSoc: 0.9,
    },
    pv: {
      acInverters: [
        {
          type: "Fronius",
          model: "Eco",
          ratedKwAc: 60,
          ip: "192.168.1.90",
          port: 502,
          modbusProfile: "fronius_ac_v1",
        },
      ],
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

describe("Unified core control design", () => {
  test("assigns every YAML SiteConfig command to a control-design role", () => {
    const spec = loadSiteConfigCommandSpec(true);
    expect(assertUnifiedControlDesignCoverage(spec)).toEqual([]);

    const design = buildUnifiedControlDesign(makeBase280Config(), spec);
    expect(design.commands).toHaveLength(Object.keys(spec.commands).length);
    expect(design.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "SITE.CRDMode",
          sectionId: "microgrid",
          role: "dispatch-policy",
          args: ["CRDMode"],
        }),
        expect.objectContaining({
          commandId: "SITE.PcsSiteLimits",
          sectionId: "battery",
          role: "dispatch-limit",
          args: ["SiteMaxChargekW", "SiteMaxDischargekW"],
        }),
        expect.objectContaining({
          commandId: "SITE.PrimaryMeterIntegration",
          sectionId: "metering",
          role: "telemetry-source",
        }),
      ])
    );
  });

  test("builds a 280 design from YAML-backed SiteConfig policy", () => {
    const design = buildUnifiedControlDesign(makeBase280Config());

    expect(design.productLine).toBe("280");
    expect(design.site).toEqual({
      systemProfile: "eSpire280",
      controllerTimezone: "America/Los_Angeles",
      controllerNetwork: {
        controllerIp: "192.168.1.10",
        modbusServerIp: "192.168.1.20",
        modbusServerPort: 502,
      },
    });
    expect(design.gridCompliance).toEqual({
      gridCode: "IEEE1547-2018",
      usesCustomGrid: false,
      customGridProfileName: undefined,
    });
    expect(design.battery.topology).toEqual({
      pcsDaisyChain: [1, 1],
      sbmuStrings: [2, 2],
      pcsCount: 2,
      sbmuStringCount: 4,
    });
    expect(design.pv).toEqual({
      acInverterCount: 1,
      totalRatedKwAc: 60,
      curtailmentMethod: "modbus",
      dcCoupledToMiniPcs: false,
    });
    expect(design.protection).toEqual({
      strategy: "none",
      outageSignalSource: "none",
      controlsPcsRunMode: false,
      controlsRemoteInterlock: false,
    });
    expect(design.metering).toEqual({
      meterType: "eGauge-4015",
      modbusProfile: "udt_eGauge_V1",
      ip: "192.168.1.88",
      calculatedReadings: [],
      sources: {
        utilityPowerKw: "meter",
        siteLoadKw: "meter",
        pvKw: "meter",
      },
    });
    expect(design.policies.crdMode).toBe("no-export");
    expect(design.policies.siteExport).toEqual({
      mode: "no-restriction",
      targetImportKw: 0.5,
      deadbandKw: 0.8,
    });
    expect(design.policies.scheduledControlEnabled).toBe(true);
    expect(design.routing.pcsDispatch).toBe("site-pcs");
    expect(design.routing.pvCurtailment).toBe("modbus");
    expect(design.routing.generator).toBe("RemoteIO");
    expect(design.limits.pcs).toEqual({
      maxChargeKw: 250,
      maxDischargeKw: 300,
      source: "site-config",
    });
    expect(design.limits.generator).toEqual({
      maxKw: 100,
      chargeFromGenerator: true,
      chargeKwLimit: 50,
      startSoc: 0.2,
      stopSoc: 0.8,
      controlType: "RemoteIO",
    });
    expect(design.telemetryRequirements.utilityPowerKw).toBe(true);
    expect(design.telemetryRequirements.pvKw).toBe(true);
    expect(design.telemetryRequirements.protectionState).toBe(false);
    expect(design.telemetryRequirements.generatorState).toBe(true);
  });

  test("derives Mini PCS limits from SystemProfile when no 280 PCS topology exists", () => {
    const miniConfig = makeBase280Config();
    miniConfig.system.systemProfile = "MINI-60-90-163-480";
    delete miniConfig.pcs;
    delete miniConfig.mbmu;
    miniConfig.pv.acInverters = [];
    miniConfig.pv.curtailmentMethod = null;

    const design = buildUnifiedControlDesign(miniConfig);

    expect(design.productLine).toBe("Mini");
    expect(design.site.miniModel).toMatchObject({
      modelCode: "MINI-60-90-163-480",
      pcsKw: 60,
      maxChargeKw: 60,
      maxDischargeKw: 60,
      dcPvKw: 90,
      pvDcKw: 90,
      hasDcPvConverter: true,
      batteryKwh: 163,
      batteryKWh: 163,
      voltageVll: 480,
      voltage: 480,
    });
    expect(design.capabilities.hasPcs).toBe(true);
    expect(design.routing.pcsDispatch).toBe("mini-pcs");
    expect(design.routing.pvCurtailment).toBe("none");
    expect(design.pv.dcCoupledToMiniPcs).toBe(true);
    expect(design.limits.pcs).toEqual({
      maxChargeKw: 60,
      maxDischargeKw: 60,
      source: "mini-profile",
    });
    expect(design.battery.topology).toEqual({
      pcsDaisyChain: [],
      sbmuStrings: [],
      pcsCount: 0,
      sbmuStringCount: 0,
    });
  });

  test("Mini model with zero PV segment is AC PV only", () => {
    const miniConfig = makeBase280Config();
    miniConfig.system.systemProfile = "MINI-60-0-163-480";
    delete miniConfig.pcs;
    delete miniConfig.mbmu;
    miniConfig.pv.acInverters = [
      {
        id: "PV1",
        type: "SMA",
        model: "STP",
        ratedKwAc: 90,
        ip: "192.168.1.51",
        port: 502,
        modbusProfile: "sma-sunspec",
      },
    ];

    const design = buildUnifiedControlDesign(miniConfig);

    expect(design.productLine).toBe("Mini");
    expect(design.site.miniModel).toEqual(
      expect.objectContaining({
        modelCode: "MINI-60-0-163-480",
        dcPvKw: 0,
        pvDcKw: 0,
        hasDcPvConverter: false,
      })
    );
    expect(design.pv).toEqual(
      expect.objectContaining({
        acInverterCount: 1,
        totalRatedKwAc: 90,
        dcCoupledToMiniPcs: false,
      })
    );
  });

  test("Mini site limits cap profile-derived PCS capacity", () => {
    const miniConfig = makeBase280Config();
    miniConfig.system.systemProfile = "MINI-60-90-163-480";
    miniConfig.pcs = {
      pcsDaisyChain: [],
      maxChargeKw: 40,
      maxDischargeKw: 50,
    };
    delete miniConfig.mbmu;

    const design = buildUnifiedControlDesign(miniConfig);

    expect(design.productLine).toBe("Mini");
    expect(design.limits.pcs).toEqual({
      maxChargeKw: 40,
      maxDischargeKw: 50,
      source: "mini-profile-capped",
    });

    const command = initCoreControl(miniConfig).evaluate({
      soc: 0.5,
      gridStatus: "normal",
      machineStatus: {
        batteryVoltageV: 500,
        maxChargeCurrentAllowedA: 100,
        maxDischargeCurrentAllowedA: 120,
        maxCellVoltageV: 3.4,
        minCellVoltageV: 3.2,
      },
      realtimeActivePowerKwRequest: 55,
    });

    expect(command.pcsActivePowerKw).toBe(50);
    expect(command.reasons).toEqual(expect.arrayContaining(["pcs-limit-clamp"]));
  });

  test("dispatch uses unified Mini limits instead of clamping to zero", () => {
    const miniConfig = makeBase280Config();
    miniConfig.system.systemProfile = "MINI-60-90-163-480";
    miniConfig.operation.crdMode = "no-restriction";
    miniConfig.operation.scheduledControlEnabled = false;
    delete miniConfig.pcs;
    delete miniConfig.mbmu;

    const controller = initCoreControl(miniConfig);
    const command = controller.evaluate({
      soc: 0.5,
      gridStatus: "normal",
      machineStatus: {
        batteryVoltageV: 500,
        maxChargeCurrentAllowedA: 100,
        maxDischargeCurrentAllowedA: 120,
        maxCellVoltageV: 3.4,
        minCellVoltageV: 3.2,
      },
      realtimeActivePowerKwRequest: 75,
    });

    expect(command.controlMode).toBe("realtime");
    expect(command.pcsActivePowerKw).toBe(60);
    expect(command.reasons).toEqual(
      expect.arrayContaining(["realtime-active-setpoint", "pcs-limit-clamp"])
    );
  });

  test("scheduled control flag selects schedule before realtime request", () => {
    const config = makeBase280Config();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const controller = initCoreControl(config);
    const command = controller.evaluate(
      {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 10,
      },
      {
        activePowerKwSetpoint: 25,
      }
    );

    expect(command.controlMode).toBe("scheduled");
    expect(command.pcsActivePowerKw).toBe(25);
    expect(command.reasons).toEqual(
      expect.arrayContaining(["scheduled-active-setpoint"])
    );
  });

  test("disabled scheduled control falls back to realtime request", () => {
    const config = makeBase280Config();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;

    const controller = initCoreControl(config);
    const command = controller.evaluate(
      {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 10,
      },
      {
        activePowerKwSetpoint: 25,
      }
    );

    expect(command.controlMode).toBe("realtime");
    expect(command.pcsActivePowerKw).toBe(10);
    expect(command.reasons).toEqual(
      expect.arrayContaining(["realtime-active-setpoint"])
    );
  });

  test("CRD modes adjust dispatch from utility meter sign convention", () => {
    const config = makeBase280Config();
    config.operation.scheduledControlEnabled = false;
    const telemetry = {
      soc: 0.5,
      gridStatus: "normal" as const,
      realtimeActivePowerKwRequest: 0,
    };

    config.operation.crdMode = "no-import";
    let command = initCoreControl(config).evaluate({
      ...telemetry,
      utilityPowerKw: 30,
    });
    expect(command.pcsActivePowerKw).toBe(30);
    expect(command.reasons).toEqual(expect.arrayContaining(["crd-no-import"]));

    config.operation.crdMode = "no-export";
    command = initCoreControl(config).evaluate({
      ...telemetry,
      utilityPowerKw: -20,
    });
    expect(command.pcsActivePowerKw).toBe(-20);
    expect(command.reasons).toEqual(expect.arrayContaining(["crd-no-export"]));

    config.operation.crdMode = "no-exchange";
    command = initCoreControl(config).evaluate({
      ...telemetry,
      utilityPowerKw: 12,
    });
    expect(command.pcsActivePowerKw).toBe(12);
    expect(command.reasons).toEqual(expect.arrayContaining(["crd-no-exchange"]));
  });

  test("PV curtailment uses Modbus command when configured", () => {
    const config = makeBase280Config();
    config.operation.mode = "off-grid";
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const command = initCoreControl(config).evaluate({
      soc: 0.95,
      gridStatus: "island",
      siteLoadKw: 20,
      pvKw: 75,
      realtimeActivePowerKwRequest: 0,
    });

    expect(command.pvCurtailmentKw).toBe(55);
    expect(command.frequencyShiftRequested).toBeUndefined();
    expect(command.reasons).toEqual(
      expect.arrayContaining(["pv-curtailment-modbus"])
    );
  });

  test("PCS CRD no-export does not curtail PV unless site export is enabled", () => {
    const config = makeBase280Config();
    config.operation.mode = "grid-tied";
    config.operation.crdMode = "no-export";
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const command = initCoreControl(config).evaluate({
      soc: 0.5,
      gridStatus: "normal",
      utilityPowerKw: -25,
      pvKw: 80,
      realtimeActivePowerKwRequest: 0,
    });

    expect(command.pcsActivePowerKw).toBe(-25);
    expect(command.pvCurtailmentKw).toBeUndefined();
    expect(command.pvActivePowerLimitPct).toBeUndefined();
    expect(command.reasons).toEqual(expect.arrayContaining(["crd-no-export"]));
    expect(command.reasons).not.toEqual(
      expect.arrayContaining(["site-no-export", "pv-curtailment-modbus"])
    );
  });

  test("site-level no-export curtails PV independently of PCS CRD", () => {
    const config = makeBase280Config();
    config.operation.mode = "grid-tied";
    config.operation.crdMode = "no-restriction";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0.5;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const command = initCoreControl(config).evaluate({
      soc: 0.5,
      gridStatus: "normal",
      utilityPowerKw: -10,
      siteLoadKw: 40,
      pvKw: 50,
      realtimeActivePowerKwRequest: 0,
    });

    expect(command.pcsActivePowerKw).toBe(0);
    expect(command.pvCurtailmentKw).toBe(44);
    expect(command.pvActivePowerLimitPct).toBeCloseTo(0.1, 6);
    expect(command.reasons).toEqual(
      expect.arrayContaining(["site-no-export", "pv-curtailment-modbus"])
    );
  });

  test("site-level no-export accounts for existing BESS output before curtailing PV", () => {
    const config = makeBase280Config();
    config.operation.mode = "grid-tied";
    config.operation.crdMode = "no-export";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const command = initCoreControl(config).evaluate({
      soc: 0.5,
      gridStatus: "normal",
      utilityPowerKw: 18.8,
      pcsActivePowerKw: 41.8,
      pvKw: 30,
      realtimeActivePowerKwRequest: 40.5,
    });

    expect(command.pcsActivePowerKw).toBe(40.5);
    expect(command.predictedUtilityPowerKw).toBeCloseTo(20.1, 6);
    expect(command.pvCurtailmentKw).toBeUndefined();
    expect(command.pvActivePowerLimitPct).toBeUndefined();
    expect(command.reasons).not.toEqual(
      expect.arrayContaining(["site-no-export", "pv-curtailment-modbus"])
    );
  });

  test("PV curtailment protects islanded eSpire280 charge power limit", () => {
    const config = makeBase280Config();
    config.operation.mode = "off-grid";
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const command = initCoreControl(config).evaluate({
      soc: 0.5,
      gridStatus: "island",
      siteLoadKw: 40,
      pvKw: 200,
      realtimeActivePowerKwRequest: 0,
      machineStatus: {
        batteryVoltageV: 1100,
        maxChargeCurrentAllowedA: -100,
        maxDischargeCurrentAllowedA: 100,
        bmsStatus: 1,
      },
    });

    expect(command.pvCurtailmentKw).toBe(52);
    expect(command.reasons).toEqual(
      expect.arrayContaining(["pv-curtailment-modbus"])
    );
  });

  test("PV curtailment requests frequency shifting when configured", () => {
    const config = makeBase280Config();
    config.operation.mode = "off-grid";
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "frequency-shifting";

    const command = initCoreControl(config).evaluate({
      soc: 0.95,
      gridStatus: "island",
      siteLoadKw: 20,
      pvKw: 75,
      realtimeActivePowerKwRequest: 0,
    });

    expect(command.pvCurtailmentKw).toBeUndefined();
    expect(command.frequencyShiftRequested).toBe(true);
    expect(command.reasons).toEqual(
      expect.arrayContaining(["pv-curtailment-frequency-shift"])
    );
  });

  test("PV curtailment is disabled when method is none", () => {
    const config = makeBase280Config();
    config.operation.mode = "off-grid";
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = null;

    const design = buildUnifiedControlDesign(config);
    const command = initCoreControl(config).evaluate({
      soc: 0.95,
      gridStatus: "island",
      siteLoadKw: 20,
      pvKw: 75,
      realtimeActivePowerKwRequest: 0,
    });

    expect(design.pv.curtailmentMethod).toBe("none");
    expect(command.pvCurtailmentKw).toBeUndefined();
    expect(command.frequencyShiftRequested).toBeUndefined();
  });

  test("protection design maps SEL devices to relay-based islanding strategy", () => {
    const config = makeBase280Config();
    config.islanding = {
      device: "SEL851",
    };

    const design = buildUnifiedControlDesign(config);

    expect(design.capabilities.hasIslanding).toBe(true);
    expect(design.protection).toEqual({
      islandingDevice: "SEL851",
      strategy: "sel-relay",
      outageSignalSource: "sel-bitfield",
      controlsPcsRunMode: true,
      controlsRemoteInterlock: true,
    });
    expect(design.telemetryRequirements.protectionState).toBe(true);
  });

  test("protection design maps ATS devices to transfer-switch strategy", () => {
    const config = makeBase280Config();
    config.islanding = {
      device: "ASCO-ATS",
    };

    const design = buildUnifiedControlDesign(config);

    expect(design.protection).toEqual({
      islandingDevice: "ASCO-ATS",
      strategy: "transfer-switch",
      outageSignalSource: "ats-state",
      controlsPcsRunMode: true,
      controlsRemoteInterlock: false,
    });
  });

  test("metering design selects inverter PV source and adjusts telemetry requirements", () => {
    const config = makeBase280Config();
    config.operation.mode = "off-grid";
    config.operation.crdMode = "no-exchange";
    config.pv.curtailmentMethod = "frequency-shifting";
    config.metering.reads = {
      pv: false,
      pvFromInverter: true,
      utility: true,
      load: true,
    };

    const design = buildUnifiedControlDesign(config);

    expect(design.metering.sources).toEqual({
      utilityPowerKw: "meter",
      siteLoadKw: "meter",
      pvKw: "inverter",
    });
    expect(design.telemetryRequirements.utilityPowerKw).toBe(true);
    expect(design.telemetryRequirements.siteLoadKw).toBe(true);
    expect(design.telemetryRequirements.pvKw).toBe(true);
  });

  test("metering calculations enable readings even when direct meter flags are off", () => {
    const config = makeBase280Config();
    config.operation.crdMode = "no-export";
    config.metering.reads = {
      pv: false,
      pvFromInverter: false,
      utility: false,
      load: false,
    };
    config.metering.calculations = {
      utilityPowerKw: {
        source: "calc",
        inputs: {
          load: "Load.kW",
          pv: "PV.kW",
          pcs: "PCS.kW",
        },
        expr: "load - pv - pcs",
      },
      siteLoadKw: {
        source: "tag",
        tagID: "Load.kW",
      },
      pvKw: {
        source: "tag",
        tagID: "PV.kW",
      },
    };

    const design = buildUnifiedControlDesign(config);

    expect(design.metering.calculatedReadings).toEqual([
      "pvKw",
      "siteLoadKw",
      "utilityPowerKw",
    ]);
    expect(design.metering.sources).toEqual({
      utilityPowerKw: "meter",
      siteLoadKw: "meter",
      pvKw: "meter",
    });
    expect(design.telemetryRequirements.utilityPowerKw).toBe(true);
  });

  test("metering design disables unavailable telemetry requirements", () => {
    const config = makeBase280Config();
    config.operation.mode = "off-grid";
    config.operation.crdMode = "no-exchange";
    config.pv.curtailmentMethod = "frequency-shifting";
    config.metering.reads = {
      pv: false,
      pvFromInverter: false,
      utility: false,
      load: false,
    };

    const design = buildUnifiedControlDesign(config);

    expect(design.metering.sources).toEqual({
      utilityPowerKw: "not-configured",
      siteLoadKw: "not-configured",
      pvKw: "not-configured",
    });
    expect(design.telemetryRequirements.utilityPowerKw).toBe(false);
    expect(design.telemetryRequirements.siteLoadKw).toBe(false);
    expect(design.telemetryRequirements.pvKw).toBe(false);
  });

  test("generator policy starts during outage and stops from SOC thresholds", () => {
    const config = makeBase280Config();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    config.generator = {
      maxKw: 100,
      chargeFromGenerator: false,
      chargeKwLimit: 0,
      startSoc: 0.25,
      stopSoc: 0.75,
      controlType: "SEL",
    };

    let command = initCoreControl(config).evaluate({
      soc: 0.2,
      gridStatus: "island",
      generatorRunning: false,
      realtimeActivePowerKwRequest: 0,
    });

    expect(command.generatorStart).toBe(true);
    expect(command.generatorStop).toBeUndefined();
    expect(command.reasons).toEqual(expect.arrayContaining(["generator-start"]));

    command = initCoreControl(config).evaluate({
      soc: 0.2,
      gridStatus: "normal",
      generatorRunning: false,
      realtimeActivePowerKwRequest: 0,
    });

    expect(command.generatorStart).toBeUndefined();
    expect(command.reasons).toEqual(
      expect.arrayContaining(["generator-start-not-allowed"])
    );

    command = initCoreControl(config).evaluate({
      soc: 0.8,
      gridStatus: "normal",
      generatorRunning: true,
      realtimeActivePowerKwRequest: 0,
    });

    expect(command.generatorStop).toBe(true);
    expect(command.generatorStart).toBeUndefined();
    expect(command.reasons).toEqual(expect.arrayContaining(["generator-stop"]));
  });

  test("route plan enables Node-RED paths for a fully configured 280 site", () => {
    const design = buildUnifiedControlDesign(makeBase280Config());
    const routePlan = buildUnifiedControlRoutePlan(design);

    expect(routePlan.productPath).toBe("eSpire280");
    expect(routePlan.activeRouteIds).toEqual(
      expect.arrayContaining([
        "product-280",
        "metering",
        "scheduled-dispatch",
        "realtime-dispatch",
        "crd",
        "soc-policy",
        "pcs-dispatch",
        "pv-curtailment",
        "generator",
        "writer-pcs",
      ])
    );
    expect(routePlan.activeRouteIds).not.toContain("product-mini");
  });

  test("route plan selects Mini path and disables absent optional systems", () => {
    const config = makeBase280Config();
    config.system.systemProfile = "MINI-60-90-163-480";
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    delete config.pcs;
    delete config.mbmu;
    delete config.generator;
    config.pv.acInverters = [];
    config.pv.curtailmentMethod = null;

    const routePlan = buildUnifiedControlRoutePlan(
      buildUnifiedControlDesign(config)
    );

    expect(routePlan.productPath).toBe("Mini");
    expect(routePlan.activeRouteIds).toEqual(
      expect.arrayContaining([
        "product-mini",
        "metering",
        "realtime-dispatch",
        "soc-policy",
        "pcs-dispatch",
        "writer-pcs",
      ])
    );
    expect(routePlan.activeRouteIds).not.toEqual(
      expect.arrayContaining([
        "product-280",
        "scheduled-dispatch",
        "crd",
        "pv-curtailment",
        "generator",
        "protection",
      ])
    );
  });

  test("route plan selects NANO path without eSpire280 topology", () => {
    const config = makeBase280Config();
    config.system.systemProfile = "NANO";
    config.system.nominal.voltageVll = 240;
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    delete config.pcs;
    delete config.mbmu;
    delete config.generator;
    config.pv.acInverters = [];
    config.pv.curtailmentMethod = null;

    const design = buildUnifiedControlDesign(config);
    const routePlan = buildUnifiedControlRoutePlan(design);

    expect(design.productLine).toBe("NANO");
    expect(routePlan.productPath).toBe("NANO");
    expect(routePlan.activeRouteIds).toEqual(
      expect.arrayContaining(["product-nano", "metering"])
    );
    expect(routePlan.activeRouteIds).not.toEqual(
      expect.arrayContaining(["product-280", "product-mini", "pcs-dispatch"])
    );
  });

  test("generator charge support respects generator, PCS, and charge availability limits", () => {
    const config = makeBase280Config();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = false;
    config.pcs!.maxChargeKw = 40;
    config.generator = {
      maxKw: 60,
      chargeFromGenerator: true,
      chargeKwLimit: 50,
      startSoc: 0.2,
      stopSoc: 0.8,
      controlType: "RemoteIO",
    };

    let command = initCoreControl(config).evaluate({
      soc: 0.5,
      gridStatus: "normal",
      generatorRunning: true,
      realtimeActivePowerKwRequest: 10,
    });

    expect(command.generatorChargeKwLimit).toBe(40);
    expect(command.pcsActivePowerKw).toBe(-40);
    expect(command.reasons).toEqual(
      expect.arrayContaining(["generator-charge-support"])
    );

    command = initCoreControl(config).evaluate({
      soc: 0.5,
      gridStatus: "normal",
      generatorRunning: true,
      allowCharge: false,
      realtimeActivePowerKwRequest: 10,
    });

    expect(command.generatorChargeKwLimit).toBe(40);
    expect(command.pcsActivePowerKw).toBe(10);
    expect(command.reasons).not.toContain("generator-charge-support");
  });
});
