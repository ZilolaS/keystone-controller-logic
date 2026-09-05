import type { SiteConfig } from "../config";
import { runUnifiedControlCycle } from "../coreControl";

function makeConfig(): SiteConfig {
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
      acInverters: [
        {
          type: "Chint",
          model: "CPS-60",
          ratedKwAc: 60,
          ip: "192.168.1.201",
          port: 502,
          modbusProfile: "chint_cps_v1",
        },
      ],
      curtailmentMethod: "modbus",
    },
    metering: {
      meterType: "eGauge-4015",
      modbusProfile: "udt_eGauge_V1",
      ip: "192.168.1.88",
      reads: {
        pv: false,
        pvFromInverter: true,
        utility: true,
        load: true,
      },
      calculations: {
        utilityPowerKw: {
          source: "tag",
          tagID: "Meter.POI_kW",
        },
        siteLoadKw: {
          source: "calc",
          inputs: {
            utility: "Meter.POI_kW",
            pcs: "PCS.SYSTEM_POWER_ACTIVE_ALL",
            pv: "Chint1.PAC",
          },
          expr: "utility + pcs + pv",
        },
        pvKw: {
          source: "tag",
          tagID: "Chint1.PAC",
        },
      },
    },
  };
}

function makeMiniConfig(): SiteConfig {
  return {
    system: {
      systemProfile: "MINI-60-90-163-480",
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
      scheduledControlEnabled: true,
    },
    battery: {
      minSoc: 0.1,
      maxSoc: 0.95,
      socLow: 0.1,
      socLowRecover: 0.12,
      socHigh: 0.95,
      socHighRecover: 0.92,
      forceGridChargeSoc: 0.02,
      powerHeadroomKw: 0,
      commandRampKwPerSec: 1000,
    },
    pv: {
      acInverters: [],
      curtailmentMethod: null,
    },
    metering: {
      meterType: "Mini internal",
      modbusProfile: "Sinexcel_Mini_PCS_ss40k",
      ip: "192.168.1.50",
      reads: {
        pv: true,
        pvFromInverter: false,
        utility: true,
        load: true,
      },
      calculations: {
        utilityPowerKw: {
          source: "tag",
          tagID: "Meter.POI_kW",
        },
        siteLoadKw: {
          source: "tag",
          tagID: "Meter.Load_kW",
        },
        pvKw: {
          source: "tag",
          tagID: "PCS.DcPv_kW",
        },
      },
    },
  };
}

function makeMiniAcPvConfig(): SiteConfig {
  const config = makeMiniConfig();
  config.system.systemProfile = "MINI-60-0-163-480";
  config.pv = {
    acInverters: [
      {
        id: "PV1",
        type: "SMA",
        model: "STP",
        ratedKwAc: 90,
        ip: "192.168.1.51",
        port: 502,
        modbusProfile: "sma-sunspec",
      },
    ],
    curtailmentMethod: "modbus",
    dcCoupledToMiniPcs: false,
  };
  config.metering = {
    meterType: "Site meter",
    modbusProfile: "site_meter",
    ip: "192.168.1.52",
    reads: {
      pv: true,
      pvFromInverter: false,
      utility: true,
      load: true,
    },
    calculations: {
      utilityPowerKw: {
        source: "tag",
        tagID: "Meter.POI_kW",
      },
      siteLoadKw: {
        source: "tag",
        tagID: "Meter.Load_kW",
      },
      pvKw: {
        source: "tag",
        tagID: "Meter.PV_kW",
      },
    },
  };
  return config;
}

function miniMachineStatus(overrides = {}) {
  return {
    batteryVoltageV: 500,
    maxChargeCurrentAllowedA: 100,
    maxDischargeCurrentAllowedA: 120,
    maxCellVoltageV: 3.4,
    minCellVoltageV: 3.2,
    minCellTemperatureC: 25,
    maxCellTemperatureC: 30,
    ...overrides,
  };
}

describe("unified control cycle", () => {
  test("uses site metering calculations before core dispatch and writer output", () => {
    const result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": -18,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 42,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
    });

    expect(result.telemetry).toEqual(
      expect.objectContaining({
        utilityPowerKw: -18,
        siteLoadKw: 24,
        pvKw: 42,
      })
    );
    expect(result.command.pcsActivePowerKw).toBe(-18);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["realtime-active-setpoint", "crd-no-export"])
    );
    expect(result.routePlan.productPath).toBe("eSpire280");
    expect(result.routePlan.activeRouteIds).toEqual(
      expect.arrayContaining([
        "product-280",
        "metering",
        "crd",
        "pcs-dispatch",
        "pv-curtailment",
        "writer-pcs",
      ])
    );
    expect(result.pipeline.blocked).toBe(false);
    expect(result.pipeline.activeStageIds).toEqual(
      expect.arrayContaining([
        "product-routing",
        "metering",
        "dispatch-source",
        "crd",
        "writer",
      ])
    );
    expect(result.pipeline.warnings).toEqual([]);
    expect(result.writerEnvelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          {
            tagID: "SYSTEM_ACTIVE_POWER_DEMAND",
            value: -18,
          },
        ],
      },
    ]);
    expect(result.diagnostics.metering).toEqual([]);
  });

  test("uses signal mapping to replace Mini gateway load calculation", () => {
    const config = makeMiniConfig();
    config.operation.crdMode = "no-export";
    config.metering.calculations = undefined;
    config.signalMapping = {
      sources: {
        Meter: { profile: "udt_eGauge_V1", role: "siteMeter" },
        PCS: { profile: "Sinexcel_Mini_PCS_ss40k", role: "pcs" },
      },
      signals: {
        utilityPowerKw: {
          expr: "Meter.Utility_Total_Power",
        },
        pcsActivePowerKw: {
          expr: "PCS.ACBusTotalActivePower",
          invertSign: true,
        },
        siteLoadKw: {
          expr: "utilityPowerKw - PCS.ACBusTotalActivePower",
        },
        pvKw: {
          expr: "PCS.DcPv_kW",
        },
      },
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        Meter: [{ tagID: "Meter.Utility_Total_Power", value: 40 }],
        PCS: [
          { tagID: "PCS.ACBusTotalActivePower", value: -12 },
          { tagID: "PCS.DcPv_kW", value: 18 },
        ],
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
    });

    expect(result.telemetry).toEqual(
      expect.objectContaining({
        utilityPowerKw: 40,
        pcsActivePowerKw: 12,
        siteLoadKw: 52,
        pvKw: 18,
      })
    );
    expect(result.diagnostics.metering).toEqual([]);
    expect(result.diagnostics.signalMapping).toEqual([]);
    expect(result.pipeline.warnings).toEqual([]);
  });

  test("accepts canonical Mini PCS and PVDC site signal mapping", () => {
    const config = makeMiniConfig();
    config.operation.crdMode = "no-export";
    config.metering.calculations = undefined;
    config.signalMapping = {
      sources: {
        PCS: { profile: "Sinexcel_Mini_PCS_ss40k", role: "pcs" },
        Load: { profile: "Sinexcel_Mini_Load_ss40k", role: "load" },
        PVDC1: { profile: "Sinexcel_Mini_PVDC_Module1_ss40k", role: "pvdc" },
        PVDC2: { profile: "Sinexcel_Mini_PVDC_Module2_ss40k", role: "pvdc" },
      },
      signals: {
        gridPowerKw: {
          expr: "PCS.GridTotalActivePower",
        },
        loadPowerKw: {
          expr: "Load.LoadTotalActivePower",
        },
        pvPowerKw: {
          expr: "PVDC1.PVBusSidePower + PVDC2.PVBusSidePower",
        },
        pcsPowerKw: {
          expr: "PCS.ACBusTotalActivePower",
          invertSign: true,
        },
      },
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        PCS: [
          { tagID: "PCS.GridTotalActivePower", value: -34.1 },
          { tagID: "PCS.ACBusTotalActivePower", value: -6.5 },
        ],
        Load: [{ tagID: "Load.LoadTotalActivePower", value: 2 }],
        PVDC1: [{ tagID: "PVDC1.PVBusSidePower", value: 16.4 }],
        PVDC2: [{ tagID: "PVDC2.PVBusSidePower", value: 17.9 }],
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
    });

    expect(result.telemetry).toMatchObject({
      utilityPowerKw: -34.1,
      pcsActivePowerKw: 6.5,
      siteLoadKw: 2,
      pvKw: 34.3,
    });
    expect(result.diagnostics.metering).toEqual([]);
    expect(result.diagnostics.signalMapping).toEqual([]);
    expect(result.pipeline.warnings).toEqual([]);
  });

  test("uses DC-only pvKw for Mini PCS dispatch", () => {
    const config = makeMiniConfig();
    config.metering.calculations = undefined;
    config.pv = {
      acInverters: [],
      curtailmentMethod: null,
      dcCoupledToMiniPcs: true,
    };
    config.signalMapping = {
      signals: {
        pvPowerKw: {
          expr: "PVDC1.Power + PVDC2.Power + Meter.AcPvPower",
        },
        pvKw: {
          expr: "PVDC1.Power + PVDC2.Power",
        },
      },
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        PVDC1: [{ tagID: "PVDC1.Power", value: 2 }],
        PVDC2: [{ tagID: "PVDC2.Power", value: 3 }],
        Meter: [{ tagID: "Meter.AcPvPower", value: 20 }],
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
    });

    expect(result.telemetry.pvKw).toBe(5);
    expect(result.command.pcsActivePowerKw).toBe(5);
  });

  test("keeps metering diagnostics with the cycle result", () => {
    const config = makeConfig();
    delete config.metering.calculations!.pvKw;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 12,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 2,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 5,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(5);
    expect(result.pipeline.blocked).toBe(false);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "metering",
          status: "warning",
          reasons: expect.arrayContaining([
            "siteLoadKw: missing-input",
            "pvKw: missing-config",
            "pvKw is required but unavailable",
          ]),
        }),
      ])
    );
    expect(result.pipeline.warnings).toEqual(
      expect.arrayContaining(["pvKw is required but unavailable"])
    );
    expect(result.diagnostics.metering).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reading: "siteLoadKw",
          status: "missing-input",
          tagID: "Chint1.PAC",
        }),
        expect.objectContaining({
          reading: "pvKw",
          status: "missing-config",
        }),
      ])
    );
  });

  test("blocks to safe zero when CRD utility feedback is required but unavailable", () => {
    const config = makeConfig();
    delete config.metering.calculations!.utilityPowerKw;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 2,
        "Chint1.PAC": 20,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 50,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "idle",
        pcsActivePowerKw: 0,
        reasons: expect.arrayContaining([
          "safe-zero",
          "crd-missing-utility-power",
        ]),
      })
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "safety-gates",
          status: "blocked",
          reasons: expect.arrayContaining(["crd-missing-utility-power"]),
        }),
      ])
    );
  });

  test("marks availability blocks when charge or discharge is explicitly disabled", () => {
    const result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        allowDischarge: false,
        realtimeActivePowerKwRequest: 25,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["discharge-disabled"])
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "availability",
          status: "blocked",
          reasons: ["discharge-disabled"],
        }),
      ])
    );
  });

  test("eSpire280 machine faults hard-gate to safe zero", () => {
    const result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 25,
        machineStatus: {
          bmsStatus: 2,
          pcsGlobalState: 7,
          epoActive: true,
          contactorsClosed: false,
        },
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "idle",
        pcsActivePowerKw: 0,
        reasons: expect.arrayContaining([
          "safe-zero",
          "e280-bms-not-normal",
          "e280-pcs-faulted",
          "e280-epo-active",
          "e280-contactors-open",
        ]),
      })
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "safety-gates",
          status: "blocked",
          reasons: expect.arrayContaining([
            "e280-bms-not-normal",
            "e280-pcs-faulted",
            "e280-epo-active",
            "e280-contactors-open",
          ]),
        }),
      ])
    );
  });

  test("eSpire280 cell-voltage gates block unsafe charge and discharge", () => {
    let result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -25,
        machineStatus: {
          bmsStatus: 1,
          maxCellVoltageV: 3.61,
          minCellVoltageV: 3.2,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-cell-high-charge-block"])
    );
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "availability",
          status: "blocked",
          reasons: ["e280-cell-high-charge-block"],
        }),
      ])
    );

    result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 25,
        machineStatus: {
          bmsStatus: 1,
          maxCellVoltageV: 3.4,
          minCellVoltageV: 2.89,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-cell-low-discharge-block"])
    );
  });

  test("eSpire280 voltage-current caps limit charge and discharge commands", () => {
    let result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -80,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(-38);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-charge-current-limit"])
    );
    expect(result.pipeline.blocked).toBe(false);

    result = runUnifiedControlCycle(makeConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 120,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -100,
          maxDischargeCurrentAllowedA: 50,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(38);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-discharge-current-limit"])
    );
  });

  test("uses configured SOC hysteresis and battery policy values", () => {
    const config = makeConfig();
    config.battery.maxSoc = 0.95;
    config.battery.socHigh = 0.95;
    config.battery.socHighRecover = 0.92;
    config.battery.powerHeadroomKw = 5;
    config.battery.commandRampKwPerSec = 100;

    const state = {};
    let result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.95,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -25,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
      state,
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["soc-high-no-charge"])
    );

    result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.93,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -25,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
      state,
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["soc-high-no-charge"])
    );

    result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.91,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: -80,
        machineStatus: {
          bmsStatus: 1,
          batteryVoltageV: 800,
          maxChargeCurrentAllowedA: -50,
          maxDischargeCurrentAllowedA: 100,
          maxCellVoltageV: 3.3,
          minCellVoltageV: 3.1,
        },
      },
      state,
    });

    expect(result.command.pcsActivePowerKw).toBe(-35);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["e280-charge-current-limit"])
    );
  });

  test("scheduled meter rule uses configured readings, SOC window, and BESS baseline", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 80,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 10,
        "Chint1.PAC": 20,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        pcsActivePowerKw: 10,
        realtimeActivePowerKwRequest: 0,
      },
      schedule: {
        activePlan: {
          plan: { planID: "may" },
          start: null,
          end: new Date("2026-05-03T00:00:00.000Z"),
          nowLocal: new Date("2026-05-02T12:00:00.000Z"),
          source: "local",
          via: "timed",
        },
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 40, unit: "kW" },
            },
            charge: {
              net_load_threshold: { value: 0, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.telemetry).toEqual(
      expect.objectContaining({
        utilityPowerKw: 80,
        siteLoadKw: 110,
        pvKw: 20,
      })
    );
    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(50);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge"])
    );
  });

  test("scheduled meter rule holds active discharge inside the threshold band", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 20,
        "Meter.Load_Total_Power": 98,
        "Meter.PV_Total_Power": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        pcsActivePowerKw: 78,
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 20, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(78);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-hold"])
    );
  });

  test("scheduled meter rule hold can use raw PCS measured telemetry", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 20,
        "Meter.Load_Total_Power": 98,
        "Meter.PV_Total_Power": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 78,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 20, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.telemetry.pcsActivePowerKw).toBe(78);
    expect(result.command.pcsActivePowerKw).toBe(78);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-hold"])
    );
  });

  test("scheduled meter rule holds active discharge when POI dips below threshold", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 17.5,
        "Meter.Load_Total_Power": 98,
        "Meter.PV_Total_Power": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        pcsActivePowerKw: 78,
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 20, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(75.5);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-hold"])
    );
  });

  test("scheduled meter rule SOC guard comes from SiteConfig, not plan constraints", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;
    config.battery.minSoc = 0.4;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 80,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 20,
      },
      baseTelemetry: {
        soc: 0.39,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 40, unit: "kW" },
            },
          },
        },
        constraints: {
          min_soc: { value: 10, unit: "%" },
        },
      },
    });

    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-blocked"])
    );
  });

  test("scheduled PV self-consumption uses configured load and PV readings", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.scheduledControlEnabled = true;

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": -15,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 60,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
      schedule: {
        strategy: {
          pv_rule: {
            mode: "selfconsumption",
          },
        },
      },
    });

    expect(result.telemetry).toEqual(
      expect.objectContaining({
        siteLoadKw: 45,
        pvKw: 60,
      })
    );
    expect(result.command.controlMode).toBe("scheduled");
    expect(result.command.pcsActivePowerKw).toBe(-15.5);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["scheduled-self-consumption"])
    );
  });

  test("site-level no-export emits PV curtailment writer envelopes", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0.5;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": -10,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 50,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 0,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.pvCurtailmentKw).toBe(44);
    expect(result.command.pvActivePowerLimitPct).toBeCloseTo(0.1, 6);
    expect(result.writerEnvelopes).toEqual(
      expect.arrayContaining([
        {
          topic: "Chint1",
          payload: [
            {
              tagID: "Chint1.Dynamic_Active_Power_Limit",
              value: result.command.pvActivePowerLimitPct,
            },
          ],
        },
      ])
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["site-no-export", "pv-curtailment-modbus"])
    );
  });

  test("site-level no-export emits PV release when export is already resolved", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-export";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 18.8,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 41.8,
        "Chint1.PAC": 30,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 40.5,
      },
    });

    expect(result.command.predictedUtilityPowerKw).toBeCloseTo(20.1, 6);
    expect(result.command.pvCurtailmentKw).toBe(24);
    expect(result.writerEnvelopes).toEqual(
      expect.arrayContaining([
        {
          topic: "Chint1",
          payload: [
            {
              tagID: "Chint1.Dynamic_Active_Power_Limit",
              value: 0.1,
            },
          ],
        },
      ])
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["site-no-export", "pv-curtailment-modbus"])
    );
  });

  test("site-level no-export refreshes SolarEdge limit every cycle", () => {
    const config = makeConfig();
    config.operation.crdMode = "no-restriction";
    config.operation.siteExportMode = "no-export";
    config.operation.siteExportTargetImportKw = 0.5;
    config.operation.siteExportDeadbandKw = 0.8;
    config.operation.scheduledControlEnabled = false;
    config.pv.curtailmentMethod = "modbus";

    const input = {
      telemetry: {
        "Meter.POI_kW": -10,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 50,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal" as const,
        realtimeActivePowerKwRequest: 0,
      },
    };

    const first = runUnifiedControlCycle(config, input);
    const second = runUnifiedControlCycle(config, input);

    const expectedSolarEdgeEnvelope = {
      topic: "Chint1",
      payload: [
        {
          tagID: "Chint1.Dynamic_Active_Power_Limit",
          value: first.command.pvActivePowerLimitPct,
        },
      ],
    };
    expect(first.writerEnvelopes).toEqual(
      expect.arrayContaining([expectedSolarEdgeEnvelope])
    );
    expect(second.writerEnvelopes).toEqual(
      expect.arrayContaining([expectedSolarEdgeEnvelope])
    );
  });

  test("allows islanding protection when normalized state is healthy", () => {
    const config = makeConfig();
    config.islanding = {
      device: "SEL851",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "island",
        protectionState: "islanded",
        pcsRunAllowed: true,
        remoteInterlockClosed: true,
        realtimeActivePowerKwRequest: 20,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(20);
    expect(result.command.pcsRunMode).toBeUndefined();
    expect(result.command.gridWireConnection).toBeUndefined();
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["pcs-mode-owned-by-islanding-sequencer"])
    );
    expect(result.writerEnvelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          {
            tagID: "SYSTEM_ACTIVE_POWER_DEMAND",
            value: 20,
          },
        ],
      },
    ]);
    expect(result.pipeline.blocked).toBe(false);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "protection",
          status: "active",
          reasons: ["sel-relay protection route configured"],
        }),
      ])
    );
  });

  test("requests PCS grid-tie mode when protection state is normal", () => {
    const config = makeConfig();
    config.islanding = {
      device: "ASCO-ATS",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        protectionState: "normal",
        pcsRunAllowed: true,
        realtimeActivePowerKwRequest: 0,
      },
    });

    expect(result.command.pcsRunMode).toBe("grid-tie");
    expect(result.command.gridWireConnection).toBe(false);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["pcs-mode-grid-tie"])
    );
    expect(result.writerEnvelopes[0].payload).toEqual(
      expect.arrayContaining([
        {
          tagID: "SYSTEM_RUN_MODE",
          value: 0,
        },
        {
          tagID: "GRID_WIRE_CONNECTION",
          value: 0,
        },
      ])
    );
  });

  test("blocks to safe zero when configured protection state is missing", () => {
    const config = makeConfig();
    config.islanding = {
      device: "ASCO-ATS",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        realtimeActivePowerKwRequest: 20,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "idle",
        pcsActivePowerKw: 0,
        reasons: expect.arrayContaining([
          "safe-zero",
          "protection-state-missing",
        ]),
      })
    );
    expect(result.pipeline.blocked).toBe(true);
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "protection",
          status: "blocked",
          reasons: ["protection-state-missing"],
        }),
      ])
    );
  });

  test("blocks to safe zero when SEL remote interlock is open", () => {
    const config = makeConfig();
    config.islanding = {
      device: "SEL851",
    };

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "PCS.SYSTEM_POWER_ACTIVE_ALL": 0,
        "Chint1.PAC": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        protectionState: "normal",
        pcsRunAllowed: true,
        remoteInterlockClosed: false,
        realtimeActivePowerKwRequest: 20,
      },
    });

    expect(result.command.pcsActivePowerKw).toBe(0);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["safe-zero", "remote-interlock-open"])
    );
    expect(result.pipeline.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "safety-gates",
          status: "blocked",
          reasons: expect.arrayContaining(["remote-interlock-open"]),
        }),
      ])
    );
  });

  test("Mini translates scheduled battery charge plus DC PV into AC setpoint", () => {
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": -30,
        "Meter.Load_kW": 10,
        "PCS.DcPv_kW": 40,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "scheduled",
        batteryActivePowerKw: -10,
        pcsActivePowerKw: 30,
        pcsActivePowerSetpointEnabled: true,
        maxChargeCurrentA: 100,
        maxDischargeCurrentA: 120,
      })
    );
    expect(result.design.site.miniModel).toEqual(
      expect.objectContaining({
        dcPvKw: 90,
        hasDcPvConverter: true,
      })
    );
    expect(result.design.pv.dcCoupledToMiniPcs).toBe(true);
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "scheduled-active-setpoint",
        "mini-dc-pv-ac-setpoint",
      ])
    );
    expect(result.writerEnvelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          { tagID: "ActivePowerSetpoint", value: -30 },
          { tagID: "MaxChgCurrent", value: 100 },
          { tagID: "MaxDsgCurrent", value: 120 },
        ],
      },
    ]);
  });

  test("Mini AC PV topology does not pass PV through the PCS setpoint", () => {
    const result = runUnifiedControlCycle(makeMiniAcPvConfig(), {
      telemetry: {
        "Meter.POI_kW": -30,
        "Meter.Load_kW": 10,
        "Meter.PV_kW": 40,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(result.design.pv.dcCoupledToMiniPcs).toBe(false);
    expect(result.design.site.miniModel).toEqual(
      expect.objectContaining({
        dcPvKw: 0,
        hasDcPvConverter: false,
      })
    );
    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "scheduled",
        batteryActivePowerKw: -10,
        pcsActivePowerKw: -10,
        pcsActivePowerSetpointEnabled: true,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["mini-ac-pv-battery-setpoint"])
    );
    expect(result.command.reasons).not.toEqual(
      expect.arrayContaining(["mini-dc-pv-ac-setpoint"])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: 10 },
      { tagID: "MaxChgCurrent", value: 100 },
      { tagID: "MaxDsgCurrent", value: 120 },
    ]);
  });

  test("Mini AC PV no-export uses battery command and skips DC PV load-follow", () => {
    const config = makeMiniAcPvConfig();
    config.operation.crdMode = "no-export";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": -20,
        "Meter.Load_kW": 10,
        "Meter.PV_kW": 30,
      },
      baseTelemetry: {
        soc: 0.96,
        gridStatus: "normal",
        pcsActivePowerKw: 0,
        machineStatus: miniMachineStatus(),
      },
      schedule: {},
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: 0,
        pcsActivePowerKw: 0,
        maxChargeCurrentA: 0,
      })
    );
    expect(result.command.reasons).not.toEqual(
      expect.arrayContaining(["mini-no-export-pv-load-follow"])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: 0 },
      { tagID: "MaxChgCurrent", value: 0 },
      { tagID: "MaxDsgCurrent", value: 120 },
    ]);
  });

  test("Mini no-export absorbs DC PV surplus into battery charge", () => {
    const config = makeMiniConfig();
    config.operation.crdMode = "no-export";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": -20,
        "Meter.Load_kW": 10,
        "PCS.DcPv_kW": 30,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        pcsActivePowerKw: 30,
        machineStatus: miniMachineStatus(),
      },
      schedule: {},
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: -20,
        pcsActivePowerKw: 10,
        pcsActivePowerSetpointEnabled: true,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["crd-no-export", "mini-dc-pv-ac-setpoint"])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: -10 },
      { tagID: "MaxChgCurrent", value: 100 },
      { tagID: "MaxDsgCurrent", value: 120 },
    ]);
  });

  test("Mini no-export at full battery zeros charge current and follows load", () => {
    const config = makeMiniConfig();
    config.operation.crdMode = "no-export";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": -20,
        "Meter.Load_kW": 10,
        "PCS.DcPv_kW": 30,
      },
      baseTelemetry: {
        soc: 0.96,
        gridStatus: "normal",
        pcsActivePowerKw: 30,
        machineStatus: miniMachineStatus(),
      },
      schedule: {},
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: 0,
        pcsActivePowerKw: 10,
        pcsActivePowerSetpointEnabled: true,
        maxChargeCurrentA: 0,
        maxDischargeCurrentA: 120,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "crd-no-export",
        "soc-high-charge-block",
        "mini-max-charge-current-zero-soc",
        "mini-no-export-pv-load-follow",
        "mini-dc-pv-ac-setpoint",
      ])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: -10 },
      { tagID: "MaxChgCurrent", value: 0 },
      { tagID: "MaxDsgCurrent", value: 120 },
    ]);
  });

  test("Mini no-export at full battery recovers load follow from curtailed PV import", () => {
    const config = makeMiniConfig();
    config.operation.crdMode = "no-export";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 42,
        "Meter.Load_kW": 50,
        "PCS.DcPv_kW": 8,
      },
      baseTelemetry: {
        soc: 0.96,
        gridStatus: "normal",
        pcsActivePowerKw: 8,
        machineStatus: miniMachineStatus(),
      },
      schedule: {},
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: 0,
        pcsActivePowerKw: 50,
        maxChargeCurrentA: 0,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-max-charge-current-zero-soc",
        "mini-no-export-pv-load-follow",
      ])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: -50 },
      { tagID: "MaxChgCurrent", value: 0 },
      { tagID: "MaxDsgCurrent", value: 120 },
    ]);
  });

  test("Mini scheduled meter rule charges DC PV surplus instead of holding PV as battery discharge", () => {
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": -68,
        "Meter.Load_kW": 38,
        "PCS.DcPv_kW": 90,
      },
      baseTelemetry: {
        soc: 0.61,
        gridStatus: "normal",
        pcsActivePowerKw: 107,
        machineStatus: miniMachineStatus(),
      },
      schedule: {
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 20, unit: "kW" },
            },
            charge: {
              net_load_threshold: { value: 1, unit: "kW" },
            },
          },
        },
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "scheduled",
        batteryActivePowerKw: -52,
        pcsActivePowerKw: 38,
        predictedUtilityPowerKw: 1,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "scheduled-meter-rule-charge",
        "mini-dc-pv-ac-setpoint",
      ])
    );
    expect(result.command.reasons).not.toEqual(
      expect.arrayContaining(["scheduled-meter-rule-discharge-hold"])
    );
  });

  test("Mini lets DC PV pass through when SOC blocks scheduled charge", () => {
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": -40,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 40,
      },
      baseTelemetry: {
        soc: 0.96,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: 0,
        pcsActivePowerKw: 40,
        maxChargeCurrentA: 0,
        maxDischargeCurrentA: 120,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "soc-high-no-charge",
        "mini-max-charge-current-zero-soc",
      ])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: -40 },
      { tagID: "MaxChgCurrent", value: 0 },
      { tagID: "MaxDsgCurrent", value: 120 },
    ]);
  });

  test("Mini cell-voltage high block stops battery charge but keeps DC PV passthrough", () => {
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": -40,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 40,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus({
          maxCellVoltageV: 3.58,
        }),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: 0,
        pcsActivePowerKw: 40,
        maxChargeCurrentA: 0,
        maxDischargeCurrentA: 120,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-cell-high-charge-block",
        "mini-max-charge-current-zero-cell-high",
      ])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: -40 },
      { tagID: "MaxChgCurrent", value: 0 },
      { tagID: "MaxDsgCurrent", value: 120 },
    ]);
  });

  test("Mini cell-voltage high charge block uses release hysteresis", () => {
    const state = {
      miniCellVoltageChargeBlocked: true,
    };

    const held = runUnifiedControlCycle(makeMiniConfig(), {
      state,
      telemetry: {
        "Meter.POI_kW": -40,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 40,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus({
          maxCellVoltageV: 3.4,
        }),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(held.command.batteryActivePowerKw).toBe(0);
    expect(held.command.maxChargeCurrentA).toBe(0);
    expect(held.command.reasons).toEqual(
      expect.arrayContaining(["mini-cell-high-charge-block"])
    );

    const released = runUnifiedControlCycle(makeMiniConfig(), {
      state,
      telemetry: {
        "Meter.POI_kW": -40,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 40,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus({
          maxCellVoltageV: 3.32,
        }),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(released.command.batteryActivePowerKw).toBe(-10);
    expect(released.command.maxChargeCurrentA).toBe(100);
  });

  test("Mini cell-voltage policy override changes charge release hysteresis", () => {
    const config = makeMiniConfig();
    config.battery.cellVoltagePolicy = {
      maxCellVoltageChargeBlockV: 3.6,
      maxCellVoltageChargeRecoverV: 3.42,
    };
    const state = {
      miniCellVoltageChargeBlocked: true,
    };

    const released = runUnifiedControlCycle(config, {
      state,
      telemetry: {
        "Meter.POI_kW": -40,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 40,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus({
          maxCellVoltageV: 3.4,
        }),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(released.command.batteryActivePowerKw).toBe(-10);
    expect(released.command.maxChargeCurrentA).toBe(100);
    expect(released.command.reasons).not.toContain(
      "mini-cell-high-charge-block"
    );
  });

  test("Mini missing cell-voltage telemetry fails safe for charge and discharge directions", () => {
    const charge = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus({
          maxCellVoltageV: undefined,
        }),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(charge.command.batteryActivePowerKw).toBe(0);
    expect(charge.command.maxChargeCurrentA).toBe(0);
    expect(charge.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-cell-voltage-max-missing",
        "mini-cell-high-charge-block",
      ])
    );

    const discharge = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 0,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: miniMachineStatus({
          minCellVoltageV: undefined,
        }),
      },
      schedule: {
        activePowerKwSetpoint: 10,
      },
    });

    expect(discharge.command.batteryActivePowerKw).toBe(0);
    expect(discharge.command.maxDischargeCurrentA).toBe(0);
    expect(discharge.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-cell-voltage-min-missing",
        "mini-cell-low-discharge-block",
      ])
    );
  });

  test("Mini DC PV suppresses active power setpoint and charge current in off-grid mode", () => {
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": 0,
        "Meter.Load_kW": 30,
        "PCS.DcPv_kW": 40,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "island",
        machineStatus: miniMachineStatus(),
      },
      schedule: {
        activePowerKwSetpoint: -10,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        pcsActivePowerKw: 0,
        pcsActivePowerSetpointEnabled: false,
        maxChargeCurrentA: 0,
        maxDischargeCurrentA: 120,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-off-grid-setpoint-suppressed",
        "mini-off-grid-dc-pv-charge-current-zero",
      ])
    );
    expect(result.writerEnvelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          { tagID: "MaxChgCurrent", value: 0 },
          { tagID: "MaxDsgCurrent", value: 120 },
        ],
      },
    ]);
  });

  test("Mini faults hard-gate unified control to safe zero", () => {
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": -10,
        "Meter.Load_kW": 10,
        "PCS.DcPv_kW": 20,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: {
          ...miniMachineStatus(),
          miniFaulted: true,
          miniFaultReasons: ["mini-pcs-fault"],
        },
      },
      schedule: {
        activePowerKwSetpoint: 10,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        controlMode: "idle",
        pcsActivePowerKw: 0,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining(["safe-zero", "mini-faulted", "mini-pcs-fault"])
    );
    expect(result.pipeline.blocked).toBe(true);
  });

  test("Mini neutral PV hunt adjusts DC PV passthrough from battery power feedback", () => {
    const state = {};
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      state,
      telemetry: {
        "Meter.POI_kW": -12,
        "Meter.Load_kW": 10,
        "PCS.DcPv_kW": 20,
      },
      baseTelemetry: {
        soc: 0.5,
        gridStatus: "normal",
        machineStatus: {
          ...miniMachineStatus(),
          actualBatteryPowerKw: 4,
        },
      },
      schedule: {
        activePowerKwSetpoint: 0,
      },
    });

    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-neutral-pv-hunt-reduce-discharge",
        "mini-neutral-pv-hunt",
      ])
    );
    expect(result.command.batteryActivePowerKw).toBe(0);
    expect(result.command.pcsActivePowerKw).toBe(16.8);
    expect(result.writerEnvelopes[0].payload[0]).toEqual({
      tagID: "ActivePowerSetpoint",
      value: -16.8,
    });
  });

  test("Mini AC PV off-grid limits PV inverter active power like 280", () => {
    const config = makeMiniAcPvConfig();
    config.operation.mode = "off-grid";

    const result = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "Meter.Load_kW": 30,
        "Meter.PV_kW": 120,
      },
      baseTelemetry: {
        soc: 0.96,
        gridStatus: "island",
        machineStatus: miniMachineStatus(),
      },
      schedule: {},
      nowMs: 1_000_000,
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        pcsActivePowerKw: 0,
        pcsActivePowerSetpointEnabled: false,
        pvCurtailmentKw: 90,
        pvActivePowerLimitPct: expect.closeTo(1 / 3, 5),
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-off-grid-setpoint-suppressed",
        "pv-curtailment-modbus",
      ])
    );
    expect(result.writerEnvelopes).toEqual(
      expect.arrayContaining([
        {
          topic: "PV1",
          payload: [
            {
              tagID: "PV1.Dynamic_Active_Power_Limit",
              value: expect.closeTo(1 / 3, 5),
            },
          ],
        },
      ])
    );
  });

  test("Mini protection zeros discharge current at low SOC", () => {
    const result = runUnifiedControlCycle(makeMiniConfig(), {
      telemetry: {
        "Meter.POI_kW": 10,
        "Meter.Load_kW": 10,
        "PCS.DcPv_kW": 0,
      },
      baseTelemetry: {
        soc: 0.08,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
      schedule: {
        activePowerKwSetpoint: 10,
      },
    });

    expect(result.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: 0,
        maxChargeCurrentA: 100,
        maxDischargeCurrentA: 0,
      })
    );
    expect(result.command.reasons).toEqual(
      expect.arrayContaining([
        "soc-low-no-discharge",
        "mini-max-discharge-current-zero-soc",
      ])
    );
    expect(result.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: 0 },
      { tagID: "MaxChgCurrent", value: 100 },
      { tagID: "MaxDsgCurrent", value: 0 },
    ]);
  });

  test("Mini emergency grid charge runs below configured SOC unless charge cell block is active", () => {
    const config = makeMiniConfig();
    config.battery.forceGridChargeSoc = 0.07;
    config.battery.forceGridChargeKw = 10;

    const safe = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 0,
      },
      baseTelemetry: {
        soc: 0.06,
        gridStatus: "normal",
        machineStatus: miniMachineStatus(),
      },
      schedule: {
        activePowerKwSetpoint: 0,
      },
    });

    expect(safe.command).toEqual(
      expect.objectContaining({
        batteryActivePowerKw: -10,
        pcsActivePowerKw: -10,
        maxDischargeCurrentA: 0,
      })
    );
    expect(safe.command.reasons).toEqual(
      expect.arrayContaining([
        "force-grid-charge",
        "mini-max-discharge-current-zero-soc",
      ])
    );
    expect(safe.writerEnvelopes[0].payload).toEqual([
      { tagID: "ActivePowerSetpoint", value: 10 },
      { tagID: "MaxChgCurrent", value: 100 },
      { tagID: "MaxDsgCurrent", value: 0 },
    ]);

    const blocked = runUnifiedControlCycle(config, {
      telemetry: {
        "Meter.POI_kW": 0,
        "Meter.Load_kW": 0,
        "PCS.DcPv_kW": 0,
      },
      baseTelemetry: {
        soc: 0.06,
        gridStatus: "normal",
        machineStatus: miniMachineStatus({
          maxCellVoltageV: 3.58,
        }),
      },
      schedule: {
        activePowerKwSetpoint: 0,
      },
    });

    expect(blocked.command.batteryActivePowerKw).toBe(0);
    expect(blocked.command.maxChargeCurrentA).toBe(0);
    expect(blocked.command.reasons).toEqual(
      expect.arrayContaining([
        "mini-cell-high-charge-block",
        "force-grid-charge-blocked",
      ])
    );
  });
});
