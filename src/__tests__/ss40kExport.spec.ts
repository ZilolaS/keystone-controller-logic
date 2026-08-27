import { readFileSync } from "fs";
import path from "path";
import {
  buildSs40kFixedPayloads,
  buildSs40kLookup,
  DEFAULT_SS40K_MODEL_INDEX_MAP,
} from "../telemetry/ss40k";
import {
  buildAmpaceBcu42kEquipmentConfig,
  buildAmpaceBcu42kTemplate,
} from "../telemetry/ampaceBcu42k";
import { buildCatlSbmu42kEquipmentConfig } from "../telemetry/catlSbmu42k";
import { resolveTelemetryTemplate } from "../telemetry/templateAdapter";

describe("SS40K export helpers", () => {
  test("buildSs40kLookup carries exportMultiplier metadata from templates", () => {
    const result = buildSs40kLookup({
      MBMU: { profileName: "MBMU_280_ss40k", route: "MBMU" },
      PCS: { profileName: "Delta_280_ss40k", route: "PCS" },
    });

    expect(result.lookup["MBMU.System_SOC_pct"]).toMatchObject({
      equipment: "MBMU",
      name: "socBat",
      model: "40101",
      exportMultiplier: 100,
    });
    expect(Object.values(result.lookup)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          equipment: "MBMU",
          sourceTagID: "MBMU.System_Power_kW",
          name: "pBatDischg",
          model: "40101",
          exportMultiplier: 1000,
          exportExpr: "max(value, 0)",
        }),
        expect.objectContaining({
          equipment: "MBMU",
          sourceTagID: "MBMU.System_Power_kW_Charge",
          name: "pBatChg",
          model: "40101",
          exportMultiplier: 1000,
          exportExpr: "max(-value, 0)",
        }),
      ])
    );

    expect(result.lookup["PCS.SYSTEM_POWER_ACTIVE_ALL"]).toMatchObject({
      equipment: "PCS",
      name: "W",
      model: "40101",
      exportMultiplier: 10000,
    });

    expect(result.routeMap).toEqual({
      MBMU: "MBMU",
      PCS: "PCS",
    });
  });

  test("buildSs40kFixedPayloads applies multipliers and splits by SS40K model", () => {
    const { lookup } = buildSs40kLookup({
      MBMU: "MBMU_280_ss40k",
      PCS: "Delta_280_ss40k",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        MBMU: [
          {
            tagID: "MBMU.System_Voltage_V",
            value: 52.4,
            timestamp: "2026-04-16T12:00:00.000Z",
          },
          {
            tagID: "MBMU.System_SOC_pct",
            value: 0.57,
            timestamp: "2026-04-16T12:00:01.000Z",
          },
        ],
        PCS: [
          {
            tagID: "PCS.SYSTEM_POWER_ACTIVE_ALL",
            value: 12.34,
            timestamp: "2026-04-16T12:00:02.000Z",
          },
          {
            tagID: "PCS.SYSTEM_MAX_POWER_AVAILABLE",
            value: 125,
            timestamp: "2026-04-16T12:00:03.000Z",
          },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toHaveLength(3);

    const byKey = Object.fromEntries(
      messages.map((message) => [
        `${message.ss40k.equipment}.${message.ss40k.model}`,
        message,
      ])
    );

    expect(byKey["PCS.40100"]).toMatchObject({
      topic: "fort/v1/things/test/telem",
      payload: {
        "0": {
          id: 40100,
          version: "3.0",
          fixed: {
            ID: 40100,
            pNom: 1250000,
          },
        },
      },
      ss40k: {
        equipment: "PCS",
        model: "40100",
        modelIndex: "0",
      },
    });

    expect(byKey["MBMU.40101"]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          version: "3.0",
          fixed: {
            ID: 40101,
            socBat: 57,
            vBat: 52.4,
          },
        },
      },
      ss40k: {
        equipment: "MBMU",
        model: "40101",
        modelIndex: "0",
        timestamp: "2026-04-16T12:00:01.000Z",
      },
    });

    expect(byKey["PCS.40101"]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          version: "3.0",
          fixed: {
            ID: 40101,
            W: 123400,
          },
        },
      },
      ss40k: {
        equipment: "PCS",
        model: "40101",
        modelIndex: "0",
        timestamp: "2026-04-16T12:00:02.000Z",
      },
    });
  });

  test("buildSs40kFixedPayloads drops samples older than configured freshness window", () => {
    const { lookup } = buildSs40kLookup({
      BCU_1: {
        profileName: "AMPACE_Mini_BCU_42k",
        template: buildAmpaceBcu42kTemplate({ bcuIndex: 0 }),
      },
      Meter: "eGauge_Site_Meter",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        BCU_1: [
          {
            tagID: "BCU_1.SerialNumber",
            value: 2350317571,
            timestamp: "2026-08-14T16:26:11.000Z",
          },
          {
            tagID: "BCU_1.USOC",
            value: 0.94,
            timestamp: "2026-08-14T16:26:11.000Z",
          },
        ],
        Meter: [
          {
            tagID: "Meter.Utility_Total_Power",
            value: -12.4,
            timestamp: "2026-08-17T18:00:00.000Z",
          },
        ],
      },
      signalMapping: {
        signals: {
          gridPowerKw: { expr: "Meter.Utility_Total_Power" },
          batteryPowerKw: { expr: "BCU_1.USOC" },
        },
      },
      topic: "fort/v1/things/test/telem",
      nowMs: Date.parse("2026-08-17T18:00:30.000Z"),
      maxSampleAgeMs: 10 * 60 * 1000,
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );
    expect(byModel["42101"]).toBeUndefined();
    expect(byModel["40101"]).toMatchObject({
      payload: {
        "0": {
          fixed: expect.objectContaining({
            ID: 40101,
            pGridImpTot: 0,
            pGridExpTot: 12400,
          }),
        },
      },
    });
    expect(byModel["40101"].payload["0"].fixed).not.toHaveProperty("pBatDischg");
  });

  test("AMPACE Mini BMS maps battery telemetry into SS40K monitoring models", () => {
    const { lookup } = buildSs40kLookup({
      BMS: "AMPACE_Mini_ss40k",
    });

    expect(lookup["BMS.BamsSoc"]).toMatchObject({
      name: "socBat",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 100,
    });
    expect(lookup["BMS.BamsVoltage"]).toMatchObject({
      name: "vBat",
      model: "40101",
      exportMultiplier: 1,
    });
    expect(lookup["BMS.BamsDischargePower"]).toMatchObject({
      name: "pBatDischg",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["BMS.BamsChargePower"]).toMatchObject({
      name: "pBatChg",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["BMS.BamsPermitChgCurrent"]).toMatchObject({
      name: "iBatChgMaxBms",
      model: "40200",
      modelIndex: "0",
      exportMultiplier: 100,
    });
    expect(lookup["BMS.BamsPermitDsgCurrent"]).toMatchObject({
      name: "iBatDischgMaxBms",
      model: "40200",
      modelIndex: "0",
      exportMultiplier: 100,
    });
    expect(lookup["BMS.BamsTotalInEng"]).toMatchObject({
      name: "eBatChgTot",
      model: "40102",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["BMS.BamsTotalOutEng"]).toMatchObject({
      name: "eBatDischgTot",
      model: "40102",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["BMS.batWarning"]).toMatchObject({
      name: "batWarning",
      model: "40103",
      modelIndex: "0",
      exportMultiplier: 1,
    });
    expect(lookup["BMS.batFault"]).toMatchObject({
      name: "batFault",
      model: "40103",
      modelIndex: "0",
      exportMultiplier: 1,
    });
    expect(DEFAULT_SS40K_MODEL_INDEX_MAP["52103"]).toBe("0");
    expect(lookup["BMS.BamsProtAlarm0_8"]).toBeUndefined();
    expect(lookup["BMS.BamsSysFaultCode0_8"]).toBeUndefined();
    expect(lookup["BMS.BamsOtherErrCode0_8"]).toBeUndefined();
    expect(lookup["BMS.BamsHwErrCode0_8"]).toBeUndefined();
    expect(lookup["BMS.BamsHwStaCode0_8"]).toBeUndefined();
    expect(lookup["BMS.batteryProtectionWarningWord"]).toMatchObject({
      name: "batteryProtectionWarningWord",
      model: "52103",
      modelIndex: "0",
    });
    expect(lookup["BMS.batteryProtectionFaultWord"]).toMatchObject({
      name: "batteryProtectionFaultWord",
      model: "52103",
      modelIndex: "0",
    });
    expect(lookup["BMS.batterySystemFaultWordA"]).toMatchObject({
      name: "batterySystemFaultWordA",
      model: "52103",
      modelIndex: "0",
    });
    expect(lookup["BMS.batterySystemFaultWordB"]).toMatchObject({
      name: "batterySystemFaultWordB",
      model: "52103",
      modelIndex: "0",
    });
    expect(lookup["BMS.batteryOtherErrorWordA"]).toMatchObject({
      name: "batteryOtherErrorWordA",
      model: "52103",
      modelIndex: "0",
    });
    expect(lookup["BMS.batteryOtherErrorWordB"]).toMatchObject({
      name: "batteryOtherErrorWordB",
      model: "52103",
      modelIndex: "0",
    });
    expect(lookup["BMS.batteryHardwareErrorWord"]).toMatchObject({
      name: "batteryHardwareErrorWord",
      model: "52103",
      modelIndex: "0",
    });
    expect(lookup["BMS.batteryHardwareStatusWord"]).toMatchObject({
      name: "batteryHardwareStatusWord",
      model: "52103",
      modelIndex: "0",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        BMS: [
          { tagID: "BMS.BamsSoc", value: 0.72 },
          { tagID: "BMS.BamsVoltage", value: 700.5 },
          { tagID: "BMS.BamsDischargePower", value: 23.5 },
          { tagID: "BMS.BamsChargePower", value: 0 },
          { tagID: "BMS.BamsMaxCellVol", value: 3.42 },
          { tagID: "BMS.BamsPermitChgCurrent", value: 120.5 },
          { tagID: "BMS.BamsTotalInEng", value: 1234.5 },
          { tagID: "BMS.BamsTotalOutEng", value: 987.6 },
          { tagID: "BMS.batWarning", value: 20 },
          { tagID: "BMS.batFault", value: 1 },
          { tagID: "BMS.BamsProtAlarm0_8", value: 1 },
          { tagID: "BMS.BamsSysFaultCode0_8", value: 2 },
          { tagID: "BMS.BamsOtherErrCode0_8", value: 4 },
          { tagID: "BMS.BamsHwErrCode0_8", value: 8 },
          { tagID: "BMS.BamsHwStaCode0_8", value: 16 },
          { tagID: "BMS.batteryProtectionWarningWord", value: 1 },
          { tagID: "BMS.batteryProtectionFaultWord", value: 0 },
          { tagID: "BMS.batterySystemFaultWordA", value: 1 },
          { tagID: "BMS.batterySystemFaultWordB", value: 0 },
          { tagID: "BMS.batteryOtherErrorWordA", value: 4 },
          { tagID: "BMS.batteryOtherErrorWordB", value: 0 },
          { tagID: "BMS.batteryHardwareErrorWord", value: 8 },
          { tagID: "BMS.batteryHardwareStatusWord", value: 16 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["40101"]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: {
            ID: 40101,
            socBat: 72,
            vBat: 700.5,
            pBatDischg: 23500,
            pBatChg: 0,
            vBatCellMax: 3420,
          },
        },
      },
    });
    expect(byModel["40102"]).toMatchObject({
      payload: {
        "0": {
          id: 40102,
          fixed: {
            ID: 40102,
            eBatChgTot: 1234500,
            eBatDischgTot: 987600,
          },
        },
      },
    });
    expect(byModel["40200"]).toMatchObject({
      payload: {
        "0": {
          id: 40200,
          fixed: {
            ID: 40200,
            iBatChgMaxBms: 12050,
          },
        },
      },
    });
    expect(byModel["40103"]).toMatchObject({
      payload: {
        "0": {
          id: 40103,
          fixed: {
            ID: 40103,
            batWarning: 20,
            batFault: 1,
          },
        },
      },
    });
    expect(byModel["52103"]).toMatchObject({
      payload: {
        "0": {
          id: 52103,
          fixed: {
            ID: 52103,
            batteryProtectionWarningWord: 1,
            batteryProtectionFaultWord: 0,
            batterySystemFaultWordA: 1,
            batterySystemFaultWordB: 0,
            batteryOtherErrorWordA: 4,
            batteryOtherErrorWordB: 0,
            batteryHardwareErrorWord: 8,
            batteryHardwareStatusWord: 16,
          },
        },
      },
      ss40k: {
        equipment: "BMS",
        model: "52103",
        modelIndex: "0",
      },
    });
  });

  test("generated AMPACE BCU readers map each BCU into SS42K battery models", () => {
    const equipmentConfig = buildAmpaceBcu42kEquipmentConfig({
      count: 2,
      route: "AMPACE",
      modelName: "MINI-90-135-288",
    });
    const { lookup, routeMap } = buildSs40kLookup(equipmentConfig);

    expect(Object.keys(equipmentConfig)).toEqual(["AMPACE_BCU_1", "AMPACE_BCU_2"]);
    expect(routeMap).toEqual({
      AMPACE_BCU_1: "AMPACE",
      AMPACE_BCU_2: "AMPACE",
    });
    expect(lookup["AMPACE_BCU_2.SerialNumber"]).toMatchObject({
      equipment: "AMPACE_BCU_2",
      name: "SN",
      model: "42100",
      modelIndex: "0",
    });
    expect(lookup["AMPACE_BCU_2.BcuCurrent"]).toMatchObject({
      name: "A",
      model: "42101",
      modelIndex: "0",
    });
    expect(lookup["AMPACE_BCU_2.BcuPower"]).toMatchObject({
      name: "W",
      model: "42101",
      exportMultiplier: 10,
    });
    expect(lookup["AMPACE_BCU_2.TotalInEng"]).toMatchObject({
      name: "eBatChgTot",
      model: "42101",
      exportMultiplier: 1000,
    });
    expect(lookup["AMPACE_BCU_2.TotalOutEng"]).toMatchObject({
      name: "eBatDischgTot",
      model: "42101",
      exportMultiplier: 1000,
    });
    expect(lookup["AMPACE_BCU_2.BcuBatteryFault"]).toMatchObject({
      name: "BatteryFault",
      model: "42103",
      modelIndex: "0",
    });
  });

  test("SS42K AMPACE BCU payloads keep per-BCU SN without PCS SN or BatteryId", () => {
    const { lookup } = buildSs40kLookup(
      buildAmpaceBcu42kEquipmentConfig({ count: 1, route: "AMPACE" })
    );

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        AMPACE_BCU_1: [
          { tagID: "AMPACE_BCU_1.SerialNumber", value: 2350317571 },
          { tagID: "AMPACE_BCU_1.Manufacturer", value: "fortress" },
          { tagID: "AMPACE_BCU_1.ProductModel", value: "eSpire-Mini-BMS" },
          { tagID: "AMPACE_BCU_1.BatteryType", value: 4 },
          { tagID: "AMPACE_BCU_1.USOC", value: 0.72 },
          { tagID: "AMPACE_BCU_1.SOH", value: 0.98 },
          { tagID: "AMPACE_BCU_1.InternalSumVoltage", value: 720.5 },
          { tagID: "AMPACE_BCU_1.BcuCurrent", value: -12.3 },
          { tagID: "AMPACE_BCU_1.BcuPower", value: -8862.15 },
          { tagID: "AMPACE_BCU_1.BcuBatteryFault", value: 1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
      fixedSerialNumber: "PCS-SN",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["42100"]).toMatchObject({
      payload: {
        "0": {
          id: 42100,
          fixed: expect.objectContaining({
            ID: 42100,
            SN: "2350317571",
            Mn: "fortress",
            Md: "eSpire-Mini-BMS",
            Typ: 4,
          }),
        },
      },
    });
    expect(byModel["42101"]).toMatchObject({
      payload: {
        "0": {
          id: 42101,
          fixed: expect.objectContaining({
            ID: 42101,
            SN: "2350317571",
            Md: "eSpire-Mini-BMS",
            SoC: 72,
            SoH: 98,
            V: 720.5,
            A: -12.3,
            W: -88621,
          }),
        },
      },
    });
    expect(byModel["42103"]).toMatchObject({
      payload: {
        "0": {
          id: 42103,
          fixed: expect.objectContaining({
            ID: 42103,
            SN: "2350317571",
            Md: "eSpire-Mini-BMS",
            BatteryFault: 1,
          }),
        },
      },
    });
    for (const message of messages) {
      const fixed = Object.values(message.payload)[0].fixed;
      expect(fixed.SN).not.toBe("PCS-SN");
      expect(fixed).not.toHaveProperty("BatteryId");
      expect(fixed).not.toHaveProperty("Model");
      expect(fixed).not.toHaveProperty("ModelName");
    }
  });

  test("generated CATL SBMU readers map each SBMU into SS42K battery models", () => {
    const equipmentConfig = buildCatlSbmu42kEquipmentConfig({
      count: 2,
      route: "MBMU",
      serialNumbers: [
        "001PBAMP00000CF2H0100004",
        "001PBAMP00000CF2H0100005",
      ],
    });
    const { lookup, routeMap } = buildSs40kLookup(equipmentConfig);

    expect(Object.keys(equipmentConfig)).toEqual(["CATL_SBMU_1", "CATL_SBMU_2"]);
    expect(routeMap).toEqual({
      CATL_SBMU_1: "MBMU",
      CATL_SBMU_2: "MBMU",
    });
    expect(equipmentConfig.CATL_SBMU_1).toMatchObject({
      profileName: "CATL_280_SBMU1_42k",
    });
    expect(equipmentConfig.CATL_SBMU_2).toMatchObject({
      profileName: "CATL_280_SBMU2_42k",
    });
    expect(
      equipmentConfig.CATL_SBMU_1 &&
        typeof equipmentConfig.CATL_SBMU_1 === "object" &&
        equipmentConfig.CATL_SBMU_1.template?.telemetry.find(
          (tag) => tag.id === "BatterySubsystemVoltageOutside"
        )
    ).toMatchObject({ address: 0x0420 });
    expect(
      equipmentConfig.CATL_SBMU_2 &&
        typeof equipmentConfig.CATL_SBMU_2 === "object" &&
        equipmentConfig.CATL_SBMU_2.template?.telemetry.find(
          (tag) => tag.id === "BatterySubsystemVoltageInside"
        )
    ).toMatchObject({ address: 0x0821 });
    expect(lookup["CATL_SBMU_2.SerialNumber"]).toMatchObject({
      equipment: "CATL_SBMU_2",
      name: "SN",
      model: "42100",
      modelIndex: "0",
    });
    expect(lookup["CATL_SBMU_2.SOC"]).toMatchObject({
      name: "SoC",
      model: "42101",
      exportMultiplier: 100,
    });
    expect(lookup["CATL_SBMU_2.BatterySubsystemPower"]).toMatchObject({
      name: "W",
      model: "42101",
      exportMultiplier: 1000,
    });
    expect(lookup["CATL_SBMU_2.SbmuBatteryFault"]).toMatchObject({
      name: "BatteryFault",
      model: "42103",
    });
  });

  test("SS42K CATL SBMU payloads keep configured per-SBMU SN", () => {
    const { lookup } = buildSs40kLookup(
      buildCatlSbmu42kEquipmentConfig({
        count: 1,
        route: "MBMU",
        serialNumbers: ["001PBAMP00000CF2H0100004"],
      })
    );

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        CATL_SBMU_1: [
          { tagID: "CATL_SBMU_1.SerialNumber", value: "001PBAMP00000CF2H0100004" },
          { tagID: "CATL_SBMU_1.Manufacturer", value: "fortress" },
          { tagID: "CATL_SBMU_1.ProductModel", value: "eSpire-BMS" },
          { tagID: "CATL_SBMU_1.SOC", value: 0.71 },
          { tagID: "CATL_SBMU_1.SOH", value: 0.99 },
          { tagID: "CATL_SBMU_1.BatterySubsystemVoltageInside", value: 780.5 },
          { tagID: "CATL_SBMU_1.BatterySubsystemCurrent", value: -12.5 },
          { tagID: "CATL_SBMU_1.BatterySubsystemPower", value: -9.8 },
          { tagID: "CATL_SBMU_1.HighVoltageOnlineStatus", value: 1 },
          { tagID: "CATL_SBMU_1.SbmuChargeStatus", value: 1 },
          { tagID: "CATL_SBMU_1.SbmuBatteryFault", value: 1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
      fixedSerialNumber: "PCS-SN",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["42100"]).toMatchObject({
      payload: {
        "0": {
          id: 42100,
          fixed: expect.objectContaining({
            ID: 42100,
            SN: "001PBAMP00000CF2H0100004",
            Mn: "fortress",
            Md: "eSpire-BMS",
          }),
        },
      },
    });
    expect(byModel["42101"]).toMatchObject({
      payload: {
        "0": {
          id: 42101,
          fixed: expect.objectContaining({
            ID: 42101,
            SN: "001PBAMP00000CF2H0100004",
            Md: "eSpire-BMS",
            SoC: 71,
            SoH: 99,
            V: 780.5,
            A: -12.5,
            W: -9800,
            ChaSt: 1,
          }),
        },
      },
    });
    expect(byModel["42103"]).toMatchObject({
      payload: {
        "0": {
          id: 42103,
          fixed: expect.objectContaining({
            ID: 42103,
            SN: "001PBAMP00000CF2H0100004",
            Md: "eSpire-BMS",
            BatteryFault: 1,
          }),
        },
      },
    });
    for (const message of messages) {
      const fixed = Object.values(message.payload)[0].fixed;
      expect(fixed.SN).not.toBe("PCS-SN");
    }
  });

  test("Sinexcel Mini PCS calculated faults export into SS40K 40103", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(lookup["PCS.pcsFault"]).toMatchObject({
      name: "pcsFault",
      model: "40103",
      modelIndex: "0",
      exportMultiplier: 1,
    });
    expect(lookup["PCS.gridWarning"]).toMatchObject({
      name: "gridWarning",
      model: "40103",
      modelIndex: "0",
    });
    expect(lookup["PCS.rsdEPOFault"]).toMatchObject({
      name: "rsdEPOFault",
      model: "40103",
      modelIndex: "0",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [
          { tagID: "PCS.pcsFault", value: 8 },
          { tagID: "PCS.gridWarning", value: 72 },
          { tagID: "PCS.rsdEPOFault", value: 2 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toMatchObject([
      expect.objectContaining({
        payload: {
          "0": {
            id: 40103,
            version: "3.0",
            fixed: {
              ID: 40103,
              pcsFault: 8,
              gridWarning: 72,
              rsdEPOFault: 2,
            },
          },
        },
      }),
    ]);
  });

  test("Sinexcel Mini PCS does not export PCS DC input voltage as battery voltage", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(lookup["PCS.DCInputVoltage"]).toBeUndefined();

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [{ tagID: "PCS.DCInputVoltage", value: 675.1 }],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([]);
  });

  test("Sinexcel Mini PCS raw fault words export into product-neutral 50103", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
      Gateway: "Sinexcel_Mini_Gateway_ss40k",
    });

    expect(DEFAULT_SS40K_MODEL_INDEX_MAP["50103"]).toBe("0");
    expect(lookup["PCS.SinexcelStatusWord36"]).toMatchObject({
      name: "pcsStatusWord36",
      model: "50103",
      modelIndex: "0",
      exportMultiplier: 1,
    });
    expect(lookup["PCS.SinexcelStatusWord37"]).toMatchObject({
      name: "pcsStatusWord37",
      model: "50103",
      modelIndex: "0",
      exportMultiplier: 1,
    });
    expect(lookup["PCS.SinexcelFaultWord106"]).toMatchObject({
      name: "pcsFaultWord106",
      model: "50103",
      modelIndex: "0",
    });
    expect(lookup["PCS.SinexcelFaultWord121"]).toMatchObject({
      name: "pcsFaultWord121",
      model: "50103",
      modelIndex: "0",
    });
    expect(lookup["Gateway.GatewaySummaryWord"]).toMatchObject({
      name: "gatewaySummaryWord",
      model: "50103",
      modelIndex: "0",
    });
    expect(lookup["Gateway.CabinetEpoFault"]).toMatchObject({
      name: "cabinetEpoFaultWord",
      model: "50103",
      modelIndex: "0",
    });
    expect(lookup["Gateway.cabinetGatewayFaultWord"]).toMatchObject({
      name: "cabinetGatewayFaultWord",
      model: "50103",
      modelIndex: "0",
    });
    expect(lookup["Gateway.cabinetGatewayWarningWord"]).toMatchObject({
      name: "cabinetGatewayWarningWord",
      model: "50103",
      modelIndex: "0",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      merge40kByModelIndex: true,
      telemetry: {
        PCS: [
          { tagID: "PCS.SerialNumber", value: "SH0P600458852403070035" },
          { tagID: "PCS.SinexcelStatusWord36", value: 96 },
          { tagID: "PCS.SinexcelStatusWord37", value: 775 },
          { tagID: "PCS.SinexcelFaultWord106", value: 1 },
          { tagID: "PCS.SinexcelFaultWord121", value: 384 },
        ],
        Gateway: [
          { tagID: "Gateway.GatewaySummaryWord", value: 2 },
          { tagID: "Gateway.GatewayAirConditionerStatusWord", value: 4 },
          { tagID: "Gateway.CabinetEpoFault", value: 1 },
          { tagID: "Gateway.cabinetGatewayFaultWord", value: 2048 },
          { tagID: "Gateway.cabinetGatewayWarningWord", value: 129 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const faultPayload = messages.find((message) => message.ss40k.model === "50103");
    expect(faultPayload).toMatchObject({
      payload: {
        "0": {
          id: 50103,
          version: "3.0",
          fixed: {
            ID: 50103,
            SN: "SH0P600458852403070035",
            pcsStatusWord36: 96,
            pcsStatusWord37: 775,
            pcsFaultWord106: 1,
            pcsFaultWord121: 384,
            gatewaySummaryWord: 2,
            gatewayAirConditionerStatusWord: 4,
            cabinetEpoFaultWord: 1,
            cabinetGatewayFaultWord: 2048,
            cabinetGatewayWarningWord: 129,
          },
        },
      },
      ss40k: expect.objectContaining({
        equipment: "site",
        model: "50103",
        modelIndex: "0",
        pointCount: 11,
      }),
    });
  });

  test("Sinexcel Mini PCS grid protection and curve readbacks export into 40104", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(lookup["PCS.UnderVoltRegion1Boundary"]).toMatchObject({
      name: "GridVoltLimit1Low",
      model: "40104",
      modelIndex: "10",
    });
    expect(lookup["PCS.OverFrequencyRegion1Boundary"]).toMatchObject({
      name: "GridFreqLimit1High",
      model: "40104",
      modelIndex: "10",
    });
    expect(lookup["PCS.VoltVarV1"]).toMatchObject({
      name: "UnderOverV1",
      model: "40104",
      modelIndex: "10",
    });
    expect(lookup["PCS.WattVarGenerationP1"]).toMatchObject({
      name: "PQP1",
      model: "40104",
      modelIndex: "10",
    });
    expect(lookup["PCS.PVSideTotalPower"]).toBeUndefined();
    expect(lookup["PCS.PVGeneratedEnergy"]).toMatchObject({
      name: "ePvTot",
      model: "40102",
      modelIndex: "0",
      exportMultiplier: 1000,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [
          { tagID: "PCS.UnderVoltRegion1Boundary", value: 0.88 },
          { tagID: "PCS.OverFrequencyRegion1Boundary", value: 60.5 },
          { tagID: "PCS.VoltVarV1", value: 0.92 },
          { tagID: "PCS.WattVarGenerationP1", value: 50 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "10": {
            id: 40104,
            version: "3.0",
            fixed: {
              ID: 40104,
              GridVoltLimit1Low: 0.88,
              GridFreqLimit1High: 60.5,
              UnderOverV1: 0.92,
              PQP1: 50,
            },
          },
        },
      }),
    ]);
  });

  test("Sinexcel Mini PCS 40104 exports use canonical model names", () => {
    const modelText = readFileSync(
      path.resolve(__dirname, "../templates/ss40k_inverter.json"),
      "utf8"
    );
    const canonical40104Names = new Set(
      Array.from(modelText.matchAll(/Data code: 40104\.([A-Za-z0-9_]+)/g)).map(
        (match) => match[1]
      )
    );
    const template = resolveTelemetryTemplate("Sinexcel_Mini_PCS_ss40k");
    const exportedNames = (template.telemetry || [])
      .filter((tag) => String(tag.ss40k?.model || "") === "40104")
      .map((tag) => tag.ss40k?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);

    expect(exportedNames.length).toBeGreaterThan(0);
    expect(exportedNames.filter((name) => !canonical40104Names.has(name))).toEqual([]);
  });

  test("Nano Hybrid PCS template resolves by file and UDT profile names", () => {
    const directTemplate = resolveTelemetryTemplate("NANO_Hybrid_PCS_ss40k");
    const udtTemplate = resolveTelemetryTemplate("udt_NANO_HybridInverter_V15");

    expect(directTemplate.device).toMatchObject({
      vendor: "Solis",
      name: "udt_NANO_HybridInverter_V15",
    });
    expect(udtTemplate.device).toEqual(directTemplate.device);

    const { lookup } = buildSs40kLookup({
      PCS: "udt_NANO_HybridInverter_V15",
    });

    expect(lookup["PCS.PowerStatus"]).toMatchObject({
      equipment: "PCS",
      name: "PowerStatus",
      model: "40101",
      modelIndex: "0",
    });
    expect(lookup["PCS.BatteryScheduling"]).toMatchObject({
      equipment: "PCS",
      name: "BatteryScheduling",
      model: "40104",
      modelIndex: "10",
    });
    expect(lookup["PCS.SerialNumber"]).toMatchObject({
      equipment: "PCS",
      name: "SN",
      model: "40100",
      modelIndex: "0",
    });
    expect(lookup["PCS.PvTotalPower"]).toMatchObject({
      equipment: "PCS",
      name: "pPvTotal",
      model: "40101",
      modelIndex: "0",
    });
    expect(lookup["PCS.GridTotalPower"]).toMatchObject({
      equipment: "PCS",
      name: "pGridImpTot",
      model: "40101",
      modelIndex: "0",
    });
    expect(lookup["PCS.PvEnergyTotal"]).toMatchObject({
      equipment: "PCS",
      name: "ePvTot",
      model: "40102",
      modelIndex: "0",
    });
    expect(lookup["PCS.pcsFault"]).toMatchObject({
      equipment: "PCS",
      name: "pcsFault",
      model: "40103",
      modelIndex: "0",
    });
  });

  test("inverter 40104 exposes visible daily schedule fields on component 10 by default", () => {
    const template = resolveTelemetryTemplate("Sinexcel_Mini_PCS_ss40k");
    const constants = Object.fromEntries(
      (template.telemetry || [])
        .filter((tag) =>
          [
            "BatteryScheduling",
            "ACChargeStatus",
            "chgST1",
            "chgET1",
            "dischgST1",
            "dischgET1",
            "acChgST1",
            "acChgET1",
          ].includes(tag.id || "")
        )
        .map((tag) => [tag.id, tag.constant])
    );
    expect(constants).toMatchObject({
      BatteryScheduling: 1,
      ACChargeStatus: 0,
      chgST1: 0,
      chgET1: 15127,
      dischgST1: 0,
      dischgET1: 15127,
      acChgST1: 0,
      acChgET1: 0,
    });

    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(lookup["PCS.BatteryScheduling"]).toMatchObject({
      name: "BatteryScheduling",
      model: "40104",
      modelIndex: "10",
    });
    expect(lookup["PCS.acChgST1"]).toMatchObject({
      name: "acChgST1",
      model: "40104",
      modelIndex: "10",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [
          { tagID: "PCS.BatteryScheduling", value: 1 },
          { tagID: "PCS.ACChargeStatus", value: 0 },
          { tagID: "PCS.chgST1", value: 8 },
          { tagID: "PCS.chgET1", value: 8 },
          { tagID: "PCS.dischgST1", value: 8 },
          { tagID: "PCS.dischgET1", value: 8 },
          { tagID: "PCS.acChgST1", value: 0 },
          { tagID: "PCS.acChgET1", value: 0 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      payload: {
        "10": {
          id: 40104,
          fixed: expect.objectContaining({
            ID: 40104,
            BatteryScheduling: 1,
            ACChargeStatus: 0,
            chgST1: 8,
            chgET1: 8,
            dischgST1: 8,
            dischgET1: 8,
            acChgST1: 0,
            acChgET1: 0,
          }),
        },
      },
      ss40k: expect.objectContaining({
        equipment: "PCS",
        model: "40104",
        modelIndex: "10",
      }),
    });
  });

  test("SS40K and Mini PCS 50103 payloads stamp the PCS SN", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
      BMS: "AMPACE_Mini_ss40k",
    });

    expect(lookup["PCS.SerialNumber"]).toMatchObject({
      name: "SN",
      model: "40101",
    });
    expect(lookup["PCS.InverterOperationStatus"]).toMatchObject({
      name: "invOpStatus",
      model: "40101",
    });
    expect(lookup["PCS.SystemStatusMap"]).toBeUndefined();

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [
          { tagID: "PCS.SerialNumber", value: "SH0P600458852403070035" },
          { tagID: "PCS.InverterOperationStatus", value: 1 },
          { tagID: "PCS.ACBusTotalActivePower", value: 44.4 },
          { tagID: "PCS.pcsFault", value: 8 },
          { tagID: "PCS.SinexcelFaultWord106", value: 1 },
        ],
        BMS: [
          { tagID: "BMS.BamsSoc", value: 0.72 },
          { tagID: "BMS.batFault", value: 1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const modelsWithPcsSn = messages.filter((message) =>
      ["40101", "40103", "50103"].includes(message.ss40k.model)
    );
    expect(new Set(modelsWithPcsSn.map((message) => message.ss40k.model))).toEqual(new Set([
      "40101",
      "40103",
      "50103",
    ]));
    const model40101 = modelsWithPcsSn.find(
      (message) => message.ss40k.equipment === "PCS" && message.ss40k.model === "40101"
    );
    expect(model40101?.payload["0"].fixed).toMatchObject({
      invOpStatus: 1,
    });
    for (const message of modelsWithPcsSn) {
      const modelPayload = Object.values(message.payload)[0];
      expect(modelPayload.fixed.SN).toBe("SH0P600458852403070035");
    }
  });

  test("Sinexcel Mini PVDC calculated faults export into SS40K 40103", () => {
    const { lookup } = buildSs40kLookup({
      PVDC1: "Sinexcel_Mini_PVDC_Module1_ss40k",
    });

    expect(lookup["PVDC1.dcPvWarning"]).toMatchObject({
      name: "dcPvWarning",
      model: "40103",
      modelIndex: "0",
      exportMultiplier: 1,
    });
    expect(lookup["PVDC1.dcPvFault"]).toMatchObject({
      name: "dcPvFault",
      model: "40103",
      modelIndex: "0",
      exportMultiplier: 1,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PVDC1: [
          { tagID: "PVDC1.dcPvWarning", value: 1 },
          { tagID: "PVDC1.dcPvFault", value: 36 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "0": {
            id: 40103,
            version: "3.0",
            fixed: {
              ID: 40103,
              dcPvWarning: 1,
              dcPvFault: 36,
            },
          },
        },
      }),
    ]);
  });

  test("Sinexcel Mini load telemetry reuses SS40K 40101 load points", () => {
    const { lookup } = buildSs40kLookup({
      LOAD: "Sinexcel_Mini_Load",
    });

    expect(lookup["LOAD.LoadTotalActivePower"]).toMatchObject({
      name: "pLoad",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["LOAD.LoadL2ReactivePower"]).toMatchObject({
      name: "qLoadL2",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["LOAD.LoadL3NVoltage"]).toMatchObject({
      name: "vLoadL3N",
      model: "40101",
      exportMultiplier: 1,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        LOAD: [
          { tagID: "LOAD.LoadTotalActivePower", value: 42.5 },
          { tagID: "LOAD.LoadL1ActivePower", value: 14.1 },
          { tagID: "LOAD.LoadL2ReactivePower", value: 2.25 },
          { tagID: "LOAD.LoadFrequency", value: 60 },
          { tagID: "LOAD.LoadL3NVoltage", value: 277.2 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "0": {
            id: 40101,
            version: "3.0",
            fixed: {
              ID: 40101,
              pLoad: 42500,
              pLoadL1: 14100,
              qLoadL2: 2250,
              fLoad: 60,
              vLoadL3N: 277.2,
            },
          },
        },
      }),
    ]);
  });

  test("configured eGauge site-meter profile maps signed utility and backup load into SS40K", () => {
    const { lookup } = buildSs40kLookup({
      Meter: "eGauge_Site_Meter",
    });

    expect(lookup["Meter.Utility_Import_Power"]).toMatchObject({
      name: "pGridImpTot",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Utility_Export_Power"]).toMatchObject({
      name: "pGridExpTot",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Backup_Load_Total_Power"]).toMatchObject({
      name: "pBkupTot",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Load_Active_Power"]).toMatchObject({
      name: "pLoad",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Import_Power", value: 40.2 },
          { tagID: "Meter.Utility_Export_Power", value: 0 },
          { tagID: "Meter.Backup_Load_Total_Power", value: 52.4 },
          { tagID: "Meter.Load_Active_Power", value: 88.8 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "0": {
            id: 40101,
            version: "3.0",
            fixed: expect.objectContaining({
              ID: 40101,
              pGridImpTot: 40200,
              pGridExpTot: 0,
              pBkupTot: 52400,
              pLoad: 88800,
            }),
          },
        },
      }),
    ]);
  });

  test("Mission Energy eGauge profile maps live site grid, load, and solar readings", () => {
    const { lookup } = buildSs40kLookup({
      Meter: "eGauge_Mission_Energy",
    });

    expect(lookup["Meter.Utility_Import_Power"]).toMatchObject({
      name: "pGridImpTot",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Load_Active_Power"]).toMatchObject({
      name: "pLoad",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Utility_L1_Power"]).toMatchObject({
      name: "pGridL1",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(lookup["Meter.Utility_Total_Power"]).toBeUndefined();
    expect(lookup["Meter.AC_Combiner_Total_Power"]).toBeUndefined();

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Import_Power", value: 31.25 },
          { tagID: "Meter.Utility_Export_Power", value: 0 },
          { tagID: "Meter.Load_Active_Power", value: 42.5 },
          { tagID: "Meter.Utility_L1_Power", value: 10.25 },
          { tagID: "Meter.L1_Voltage", value: 277.1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "0": {
            id: 40101,
            version: "3.0",
            fixed: expect.objectContaining({
              ID: 40101,
              pGridImpTot: 31250,
              pGridExpTot: 0,
              pLoad: 42500,
              pGridL1: 10250,
              vGridL1N: 277.1,
            }),
          },
        },
      }),
    ]);
  });

  test("SolarEdge profile exports AC-coupled PV power and energy", () => {
    const { lookup } = buildSs40kLookup({
      SolarEdge1: "solarEdge",
    });

    expect(lookup["SolarEdge1.AC_POWER"]).toMatchObject({
      name: "pAcCplTot",
      model: "40101",
      modelIndex: "0",
    });
    expect(lookup["SolarEdge1.AC_ENERGY_WH"]).toMatchObject({
      name: "ePvTot",
      model: "40102",
      modelIndex: "0",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        SolarEdge1: [
          { tagID: "SolarEdge1.AC_POWER", value: 12500 },
          { tagID: "SolarEdge1.AC_ENERGY_WH", value: 987654 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["40101"]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: {
            ID: 40101,
            pAcCplTot: 12500,
          },
        },
      },
    });
    expect(byModel["40102"]).toMatchObject({
      payload: {
        "0": {
          id: 40102,
          fixed: {
            ID: 40102,
            ePvTot: 987654,
          },
        },
      },
    });
  });

  test("Mission Energy Meter2 profile maps the Solar register to AC-coupled PV", () => {
    const { lookup } = buildSs40kLookup({
      Meter2: "eGauge_Mission_Energy_Meter2",
    });

    expect(lookup["Meter2.Solar"]).toMatchObject({
      name: "pAcCplTot",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        Meter2: [{ tagID: "Meter2.Solar", value: 6.5 }],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        payload: {
          "0": {
            id: 40101,
            version: "3.0",
            fixed: {
              ID: 40101,
              pAcCplTot: 6500,
            },
          },
        },
      }),
    ]);
  });

  test("Sinexcel Mini PVDC telemetry exports PV power while PCS exports total PV energy", () => {
    const { lookup } = buildSs40kLookup({
      PVDC1: "pvdc_module_1",
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(lookup["PVDC1.PVSideTotalPower"]).toMatchObject({
      name: "pPvTotal",
      model: "40101",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["PVDC1.PV1SideVoltage"]).toMatchObject({
      name: "vMppt1",
      model: "40101",
    });
    expect(lookup["PVDC1.PVGeneratedEnergy"]).toBeUndefined();
    expect(lookup["PCS.PVGeneratedEnergy"]).toMatchObject({
      name: "ePvTot",
      model: "40102",
      modelIndex: "0",
      exportMultiplier: 1000,
    });
    expect(lookup["PCS.ACBusTotalActivePower"]).toMatchObject({
      name: "W",
      model: "40101",
      exportMultiplier: 1000,
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PVDC1: [
          { tagID: "PVDC1.PVSideTotalPower", value: 31.2 },
          { tagID: "PVDC1.PV1SideTotalPower", value: 10.1 },
          { tagID: "PVDC1.PV1SideVoltage", value: 620.5 },
        ],
        PCS: [
          { tagID: "PCS.ACBusTotalActivePower", value: 44.4 },
          { tagID: "PCS.PVGeneratedEnergy", value: 123.4 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const byKey = Object.fromEntries(
      messages.map((message) => [
        `${message.ss40k.equipment}.${message.ss40k.model}`,
        message,
      ])
    );

    expect(byKey["PVDC1.40101"]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: {
            ID: 40101,
            pPvTotal: 31200,
            pMppt1: 10100,
            vMppt1: 620.5,
          },
        },
      },
    });
    expect(byKey["PCS.40102"]).toMatchObject({
      payload: {
        "0": {
          id: 40102,
          fixed: {
            ID: 40102,
            ePvTot: 123400,
          },
        },
      },
    });
    expect(byKey["PCS.40101"]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: {
            ID: 40101,
            W: 44400,
          },
        },
      },
    });
  });

  test("site signal mapping overrides Mini site-level SS40K fields", () => {
    const { lookup } = buildSs40kLookup(
      {
        Meter: "eGauge_Site_Meter",
        BMS: "AMPACE_Mini_ss40k",
        PVDC1: "pvdc_module_1",
        PVDC2: "pvdc_module_2",
        PVDC3: "pvdc_module_3",
        PCS: "Sinexcel_Mini_PCS_ss40k",
      },
      {
        ...DEFAULT_SS40K_MODEL_INDEX_MAP,
        "40101": "0",
      }
    );

    const messages = buildSs40kFixedPayloads({
      lookup,
      mergeByModelIndex: true,
      signalMapping: {
        signals: {
          gridPowerKw: { expr: "Meter.Utility_Total_Power" },
          pvPowerKw: {
            expr: "PVDC1.PVSideTotalPower + PVDC2.PVSideTotalPower + PVDC3.PVSideTotalPower",
          },
          pcsPowerKw: {
            expr: "PCS.ACBusTotalActivePower",
            invertSign: true,
          },
          loadPowerKw: {
            expr: "gridPowerKw + pvPowerKw + pcsPowerKw",
          },
          backupLoadKw: { expr: "Meter.Backup_Load_Total_Power" },
          batteryPowerKw: { expr: "BMS.BamsPower" },
        },
      },
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Total_Power", value: -13.9 },
          { tagID: "Meter.Backup_Load_Total_Power", value: 6.18 },
        ],
        BMS: [{ tagID: "BMS.BamsPower", value: 26.5 }],
        PCS: [{ tagID: "PCS.ACBusTotalActivePower", value: -39.4 }],
        PVDC1: [{ tagID: "PVDC1.PVSideTotalPower", value: 1.3 }],
        PVDC2: [{ tagID: "PVDC2.PVSideTotalPower", value: 1.1 }],
        PVDC3: [{ tagID: "PVDC3.PVSideTotalPower", value: 1 }],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: expect.objectContaining({
            ID: 40101,
            pPvTotal: 3400,
            pGridImpTot: 0,
            pGridExpTot: 13900,
            pLoad: 28900,
            pBkupTot: 6180,
            pBatDischg: 26500,
            pBatChg: 0,
          }),
        },
      },
      ss40k: {
        equipment: "site",
        model: "40101",
        modelIndex: "0",
      },
    });
  });

  test("direct SS40K signal mapping can drive AC-coupled PV and energy models", () => {
    const messages = buildSs40kFixedPayloads({
      lookup: {},
      mergeByModelIndex: true,
      signalMapping: {
        ss40k: {
          pAcCplTot: { expr: "deadband(Meter2.Solar, 0.3)" },
          iAcCplTot: {
            expr: "SolarEdge1.AC_CURRENT_TOTAL + SolarEdge2.AC_CURRENT_TOTAL",
          },
          vAcCplL12: {
            expr: "(SolarEdge1.AC_VOLTAGE_AB + SolarEdge2.AC_VOLTAGE_AB) / 2",
          },
          eAcCplTot: {
            expr: "SolarEdge1.AC_ENERGY_WH + SolarEdge2.AC_ENERGY_WH",
          },
          eGridImpTot: { expr: "Meter.Utility_Import_Energy_Wh" },
          eGridExpTot: { expr: "Meter.Utility_Export_Energy_Wh" },
        },
      },
      telemetry: {
        Meter2: [{ tagID: "Meter2.Solar", value: 89.278 }],
        Meter: [
          { tagID: "Meter.Utility_Import_Energy_Wh", value: 1200 },
          { tagID: "Meter.Utility_Export_Energy_Wh", value: 3400 },
        ],
        SolarEdge1: [
          { tagID: "SolarEdge1.AC_CURRENT_TOTAL", value: 166.7 },
          { tagID: "SolarEdge1.AC_VOLTAGE_AB", value: 492.8 },
          { tagID: "SolarEdge1.AC_ENERGY_WH", value: 12526 },
        ],
        SolarEdge2: [
          { tagID: "SolarEdge2.AC_CURRENT_TOTAL", value: 155.05 },
          { tagID: "SolarEdge2.AC_VOLTAGE_AB", value: 492.4 },
          { tagID: "SolarEdge2.AC_ENERGY_WH", value: 13018 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const byModel = Object.fromEntries(
      messages.map((message) => [message.ss40k.model, message])
    );

    expect(byModel["40101"]).toMatchObject({
      payload: {
        "0": {
          fixed: expect.objectContaining({
            ID: 40101,
            pAcCplTot: 89278,
            iAcCplTot: 321.75,
            vAcCplL12: 492.6,
          }),
        },
      },
    });
    expect(byModel["40102"]).toMatchObject({
      payload: {
        "0": {
          fixed: expect.objectContaining({
            ID: 40102,
            eAcCplTot: 25544,
            eGridImpTot: 1200,
            eGridExpTot: 3400,
          }),
        },
      },
    });
  });

  test("energy accumulator splits signed eGauge energy and integrates load/battery power", () => {
    const state = {};
    const baseOptions = {
      lookup: {},
      mergeByModelIndex: true,
      signalMapping: {
        ss40k: {
          pLoad: { expr: "Meter.Load_Active_Power" },
        },
      },
      topic: "fort/v1/things/test/telem",
      energyAccumulator: {
        state,
        sourceTagIDs: {
          utilityNetKwh: "Meter.Utility_Energy",
          acCoupledPvKwh: "Meter2.PV_Energy",
          generatorKwh: "Meter.Generator_Energy",
          batteryPowerKw: "MBMU.System_Power_kW",
        },
      },
    };

    buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: { ...baseOptions.energyAccumulator, nowMs: 1000 },
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Energy", value: -100 },
          { tagID: "Meter.Generator_Energy", value: 20 },
          { tagID: "Meter.Load_Active_Power", value: 120 },
        ],
        Meter2: [{ tagID: "Meter2.PV_Energy", value: 1000 }],
        MBMU: [{ tagID: "MBMU.System_Power_kW", value: -30 }],
      },
    });

    const second = buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: { ...baseOptions.energyAccumulator, nowMs: 61000 },
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Energy", value: -98 },
          { tagID: "Meter.Generator_Energy", value: 19.9 },
          { tagID: "Meter.Load_Active_Power", value: 120 },
        ],
        Meter2: [{ tagID: "Meter2.PV_Energy", value: 1010 }],
        MBMU: [{ tagID: "MBMU.System_Power_kW", value: -30 }],
      },
    });

    const second40102 = second.find((message) => message.ss40k.model === "40102");
    expect(second40102?.payload["0"].fixed).toMatchObject({
      ID: 40102,
      eGridImpTot: 2,
      eGridExpTot: 0,
      eAcCplTot: 10,
      eGenTot: 0,
      eLoadTot: 2,
      eBatChgTot: 0.5,
      eBatDischgTot: 0,
    });

    const third = buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: { ...baseOptions.energyAccumulator, nowMs: 121000 },
      telemetry: {
        Meter: [
          { tagID: "Meter.Utility_Energy", value: -101 },
          { tagID: "Meter.Generator_Energy", value: 20.5 },
          { tagID: "Meter.Load_Active_Power", value: 60 },
        ],
        Meter2: [{ tagID: "Meter2.PV_Energy", value: 1010 }],
        MBMU: [{ tagID: "MBMU.System_Power_kW", value: 12 }],
      },
    });

    const third40102 = third.find((message) => message.ss40k.model === "40102");
    expect(third40102?.payload["0"].fixed).toMatchObject({
      ID: 40102,
      eGridImpTot: 2,
      eGridExpTot: 3,
      eAcCplTot: 10,
      eGenTot: 0.6,
      eLoadTot: 3,
      eBatChgTot: 0.5,
      eBatDischgTot: 0.2,
    });
  });

  test("energy accumulator preserves device totals and derives daily 40102 energy fields", () => {
    const state = {};
    const baseOptions = {
      lookup: {
        "PCS.PVGeneratedEnergy": {
          equipment: "PCS",
          sourceTagID: "PCS.PVGeneratedEnergy",
          profileName: "Sinexcel_Mini_PCS_ss40k",
          name: "ePvTot",
          model: "40102",
          modelIndex: "0",
          exportMultiplier: 1000,
        },
        "Battery.BamsChargedEnergy": {
          equipment: "Battery",
          sourceTagID: "Battery.BamsChargedEnergy",
          profileName: "AMPACE_Mini_ss40k",
          name: "eBatChgTot",
          model: "40102",
          modelIndex: "0",
          exportMultiplier: 1000,
        },
      },
      mergeByModelIndex: true,
      signalMapping: {
        signals: {
          loadPowerKw: { expr: "Meter.Load_Total_Power" },
          gridPowerKw: { expr: "Meter.Utility_Total_Power" },
        },
      },
      topic: "fort/v1/things/test/telem",
      energyAccumulator: {
        state,
        outputMultiplier: 1000,
        timezone: "America/Los_Angeles",
      },
    };

    buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: { ...baseOptions.energyAccumulator, nowMs: Date.UTC(2026, 7, 14, 7, 0, 0) },
      telemetry: {
        PCS: [{ tagID: "PCS.PVGeneratedEnergy", value: 1000 }],
        Battery: [{ tagID: "Battery.BamsChargedEnergy", value: 200 }],
        Meter: [
          { tagID: "Meter.Load_Total_Power", value: 60 },
          { tagID: "Meter.Utility_Total_Power", value: 24 },
        ],
      },
    });

    const second = buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: { ...baseOptions.energyAccumulator, nowMs: Date.UTC(2026, 7, 14, 7, 5, 0) },
      telemetry: {
        PCS: [{ tagID: "PCS.PVGeneratedEnergy", value: 1001.25 }],
        Battery: [{ tagID: "Battery.BamsChargedEnergy", value: 201 }],
        Meter: [
          { tagID: "Meter.Load_Total_Power", value: 60 },
          { tagID: "Meter.Utility_Total_Power", value: 24 },
        ],
      },
    });

    const second40102 = second.find((message) => message.ss40k.model === "40102");
    expect(second40102?.payload["0"].fixed).toMatchObject({
      ID: 40102,
      ePvTot: 1001250,
      ePvTdy: 1250,
      eBatChgTot: 201000,
      eBatChgTdy: 1000,
      eGridImpTot: 2000,
      eGridImpTdy: 2000,
      eGridExpTot: 0,
      eGridExpTdy: 0,
      eLoadTot: 5000,
      eLoadTdy: 5000,
    });

    const third = buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: { ...baseOptions.energyAccumulator, nowMs: Date.UTC(2026, 7, 15, 7, 1, 0) },
      telemetry: {
        PCS: [{ tagID: "PCS.PVGeneratedEnergy", value: 1010 }],
        Battery: [{ tagID: "Battery.BamsChargedEnergy", value: 205 }],
        Meter: [
          { tagID: "Meter.Load_Total_Power", value: 60 },
          { tagID: "Meter.Utility_Total_Power", value: -12 },
        ],
      },
    });

    const third40102 = third.find((message) => message.ss40k.model === "40102");
    expect(third40102?.payload["0"].fixed).toMatchObject({
      ID: 40102,
      ePvTot: 1010000,
      ePvTdy: 0,
      eBatChgTot: 205000,
      eBatChgTdy: 0,
      eGridImpTot: 2000,
      eGridImpTdy: 0,
      eGridExpTot: 1000,
      eGridExpTdy: 0,
      eLoadTot: 10000,
      eLoadTdy: 0,
    });
  });

  test("energy accumulator holds last good lifetime totals during zero dropouts", () => {
    const state = {};
    const baseOptions = {
      lookup: {
        "PCS.PVGeneratedEnergy": {
          equipment: "PCS",
          sourceTagID: "PCS.PVGeneratedEnergy",
          profileName: "Sinexcel_Mini_PCS_ss40k",
          name: "ePvTot",
          model: "40102",
          modelIndex: "0",
          exportMultiplier: 1000,
        },
      },
      mergeByModelIndex: true,
      topic: "fort/v1/things/test/telem",
      energyAccumulator: {
        state,
        outputMultiplier: 1000,
        timezone: "America/New_York",
      },
    };

    buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: {
        ...baseOptions.energyAccumulator,
        nowMs: Date.UTC(2026, 7, 21, 3, 55, 0),
      },
      telemetry: {
        PCS: [{ tagID: "PCS.PVGeneratedEnergy", value: 28337.2 }],
      },
    });

    const zeroDropout = buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: {
        ...baseOptions.energyAccumulator,
        nowMs: Date.UTC(2026, 7, 21, 4, 5, 0),
      },
      telemetry: {
        PCS: [{ tagID: "PCS.PVGeneratedEnergy", value: 0 }],
      },
    });

    const zeroDropout40102 = zeroDropout.find((message) => message.ss40k.model === "40102");
    expect(zeroDropout40102?.payload["0"].fixed).toMatchObject({
      ID: 40102,
      ePvTot: 28337200,
      ePvTdy: 0,
    });

    const recovered = buildSs40kFixedPayloads({
      ...baseOptions,
      energyAccumulator: {
        ...baseOptions.energyAccumulator,
        nowMs: Date.UTC(2026, 7, 21, 10, 10, 0),
      },
      telemetry: {
        PCS: [{ tagID: "PCS.PVGeneratedEnergy", value: 28585.7 }],
      },
    });

    const recovered40102 = recovered.find((message) => message.ss40k.model === "40102");
    expect(recovered40102?.payload["0"].fixed).toMatchObject({
      ID: 40102,
      ePvTot: 28585700,
      ePvTdy: 248500,
    });
  });

  test("canonical Mini PCS/PVDC signal mapping drives SS40K site power fields", () => {
    const { lookup } = buildSs40kLookup(
      {
        PCS: "Sinexcel_Mini_PCS_ss40k",
        Load: "Sinexcel_Mini_Load_ss40k",
        PVDC1: "pvdc_module_1",
        PVDC2: "pvdc_module_2",
      },
      {
        ...DEFAULT_SS40K_MODEL_INDEX_MAP,
        "40101": "0",
      }
    );

    const messages = buildSs40kFixedPayloads({
      lookup,
      mergeByModelIndex: true,
      signalMapping: {
        signals: {
          gridPowerKw: { expr: "PCS.GridTotalActivePower" },
          loadPowerKw: { expr: "Load.LoadTotalActivePower" },
          pvPowerKw: {
            expr: "PVDC1.PVBusSidePower + PVDC2.PVBusSidePower",
          },
          pcsPowerKw: {
            expr: "PCS.ACBusTotalActivePower",
            invertSign: true,
          },
        },
      },
      telemetry: {
        PCS: [
          { tagID: "PCS.GridTotalActivePower", value: -34.1 },
          { tagID: "PCS.ACBusTotalActivePower", value: -6.5 },
        ],
        Load: [{ tagID: "Load.LoadTotalActivePower", value: 2 }],
        PVDC1: [{ tagID: "PVDC1.PVBusSidePower", value: 16.4 }],
        PVDC2: [{ tagID: "PVDC2.PVBusSidePower", value: 17.9 }],
      },
      topic: "fort/v1/things/test/telem",
    });

    const site40101 = messages.find(
      (message) => message.ss40k.equipment === "site" && message.ss40k.model === "40101"
    );
    expect(site40101).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: expect.objectContaining({
            ID: 40101,
            pGridImpTot: 0,
            pGridExpTot: 34100,
            pLoad: 2000,
            pPvTotal: 34300,
          }),
        },
      },
    });
  });

  test("40K-only merge sums PVDC production without merging BCU 42K payloads", () => {
    const { lookup: baseLookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
      PVDC1: "pvdc_module_1",
      PVDC2: "pvdc_module_2",
    });
    const { lookup: bcuLookup } = buildSs40kLookup(
      buildAmpaceBcu42kEquipmentConfig({ count: 2, route: "AMPACE" })
    );
    const lookup = { ...baseLookup, ...bcuLookup };

    const messages = buildSs40kFixedPayloads({
      lookup,
      merge40kByModelIndex: true,
      telemetry: {
        PCS: [{ tagID: "PCS.ACBusTotalActivePower", value: 44.4 }],
        PVDC1: [{ tagID: "PVDC1.PVSideTotalPower", value: 19.6 }],
        PVDC2: [{ tagID: "PVDC2.PVSideTotalPower", value: 18.9 }],
        AMPACE_BCU_1: [
          { tagID: "AMPACE_BCU_1.SerialNumber", value: "2350317571" },
          { tagID: "AMPACE_BCU_1.USOC", value: 0.71 },
        ],
        AMPACE_BCU_2: [
          { tagID: "AMPACE_BCU_2.SerialNumber", value: "2350321667" },
          { tagID: "AMPACE_BCU_2.USOC", value: 0.69 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const site40101 = messages.find(
      (message) => message.ss40k.equipment === "site" && message.ss40k.model === "40101"
    );
    expect(site40101).toMatchObject({
      payload: {
        "0": {
          id: 40101,
          fixed: expect.objectContaining({
            ID: 40101,
            W: 44400,
            pPvTotal: 38500,
          }),
        },
      },
    });

    const bcu42101 = messages.filter((message) => message.ss40k.model === "42101");
    expect(bcu42101).toHaveLength(2);
    expect(bcu42101.map((message) => message.ss40k.equipment).sort()).toEqual([
      "AMPACE_BCU_1",
      "AMPACE_BCU_2",
    ]);
  });

  test("Sinexcel Mini PCS profile exports grid telemetry from PCS grid-side registers", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });

    expect(Object.values(lookup)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          equipment: "PCS",
          sourceTagID: "PCS.GridFrequency",
          name: "fGrid",
          model: "40101",
          modelIndex: "0",
        }),
      ])
    );
    expect(lookup["PCS.GridL1ActivePower"]).toMatchObject({
      equipment: "PCS",
      name: "pGridL1",
      exportMultiplier: 1000,
    });
    expect(Object.values(lookup)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          equipment: "PCS",
          sourceTagID: "PCS.GridTotalActivePower",
          name: "pGridImpTot",
          model: "40101",
          exportMultiplier: 1000,
          exportExpr: "max(value, 0)",
        }),
        expect.objectContaining({
          equipment: "PCS",
          sourceTagID: "PCS.GridTotalActivePower",
          name: "pGridExpTot",
          model: "40101",
          exportMultiplier: 1000,
          exportExpr: "max(-value, 0)",
        }),
      ])
    );

    const messages = buildSs40kFixedPayloads({
      lookup,
      telemetry: {
        PCS: [
          { tagID: "PCS.GridTotalActivePower", value: -2.7 },
          { tagID: "PCS.GridFrequency", value: 60.01 },
          { tagID: "PCS.GridL1NVoltage", value: 272.9 },
          { tagID: "PCS.GridL2NVoltage", value: 271.3 },
          { tagID: "PCS.GridL3NVoltage", value: 275.3 },
          { tagID: "PCS.GridL1ActivePower", value: -0.7 },
          { tagID: "PCS.GridL2ActivePower", value: -0.3 },
          { tagID: "PCS.GridL3ActivePower", value: 0.4 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].payload["0"].id).toBe(40101);
    expect(messages[0].payload["0"].fixed).toMatchObject({
      ID: 40101,
      fGrid: 60.01,
      vGridL1N: 272.9,
      vGridL2N: 271.3,
      vGridL3N: 275.3,
      pGridL1: -700,
      pGridL2: -300,
      pGridL3: 400,
      pGridImpTot: 0,
      pGridExpTot: 2700,
    });
    expect(messages[0].ss40k).toMatchObject({
      equipment: "PCS",
      model: "40101",
      modelIndex: "0",
    });
  });

  test("site signal mapping can override SS40K grid points from meter telemetry", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
      Meter: "eGauge_Site_Meter",
    });

    const messages = buildSs40kFixedPayloads({
      lookup,
      mergeByModelIndex: true,
      signalMapping: {
        ss40k: {
          pGridImpTot: { expr: "max(Meter.GridPower, 0)" },
          pGridExpTot: { expr: "max(-Meter.GridPower, 0)" },
          pGridL1: { expr: "Meter.GridL1Power" },
          fGrid: { expr: "Meter.GridFrequency" },
          vGridL1N: { expr: "Meter.GridL1NVoltage" },
        },
      },
      telemetry: {
        PCS: [
          { tagID: "PCS.GridTotalActivePower", value: 99.9 },
          { tagID: "PCS.GridFrequency", value: 59 },
          { tagID: "PCS.GridL1NVoltage", value: 111 },
          { tagID: "PCS.GridL1ActivePower", value: 88.8 },
        ],
        Meter: [
          { tagID: "Meter.GridPower", value: -4.2 },
          { tagID: "Meter.GridL1Power", value: -1.4 },
          { tagID: "Meter.GridFrequency", value: 60.03 },
          { tagID: "Meter.GridL1NVoltage", value: 277.1 },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    expect(messages[0].payload["0"].fixed).toMatchObject({
      pGridImpTot: 0,
      pGridExpTot: 4200,
      pGridL1: -1400,
      fGrid: 60.03,
      vGridL1N: 277.1,
    });
  });

  test("system model SN can come from startup identity outside freshness window", () => {
    const { lookup } = buildSs40kLookup({
      PCS: "Sinexcel_Mini_PCS_ss40k",
    });
    const nowMs = Date.parse("2026-08-24T18:30:00.000Z");

    const messages = buildSs40kFixedPayloads({
      lookup,
      merge40kByModelIndex: true,
      maxSampleAgeMs: 600000,
      nowMs,
      telemetry: {
        PCS: [
          {
            tagID: "PCS.SerialNumber",
            value: "SH2C662355112411180050",
            timestamp: "2026-08-22T02:23:42.019Z",
          },
          {
            tagID: "PCS.GridFrequency",
            value: 60.01,
            timestamp: "2026-08-24T18:29:59.000Z",
          },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const model40101 = messages.find((message) => message.ss40k.model === "40101");
    expect(model40101?.payload["0"].fixed).toMatchObject({
      ID: 40101,
      fGrid: 60.01,
      SN: "SH2C662355112411180050",
    });
    expect(messages.some((message) => message.ss40k.model === "40100")).toBe(false);
  });

  test("Mini parent battery fault model is stamped once per BCU serial", () => {
    const { lookup: parentLookup } = buildSs40kLookup({
      AMPACE: "AMPACE_Mini_ss40k",
    });
    const { lookup: bcuLookup } = buildSs40kLookup(
      buildAmpaceBcu42kEquipmentConfig({ count: 2, route: "AMPACE" })
    );

    const messages = buildSs40kFixedPayloads({
      lookup: { ...parentLookup, ...bcuLookup },
      telemetry: {
        AMPACE: [
          { tagID: "AMPACE.batteryProtectionWarningWord", value: 1 },
          { tagID: "AMPACE.batteryHardwareErrorWord", value: 8 },
        ],
        AMPACE_BCU_1: [
          { tagID: "AMPACE_BCU_1.SerialNumber", value: "2350317571" },
        ],
        AMPACE_BCU_2: [
          { tagID: "AMPACE_BCU_2.SerialNumber", value: "2350321667" },
        ],
      },
      topic: "fort/v1/things/test/telem",
    });

    const faultMessages = messages.filter((message) => message.ss40k.model === "52103");
    expect(faultMessages).toHaveLength(2);
    expect(faultMessages.map((message) => message.ss40k.equipment).sort()).toEqual([
      "AMPACE_BCU_1",
      "AMPACE_BCU_2",
    ]);
    expect(
      faultMessages.map((message) => message.payload["0"].fixed.SN).sort()
    ).toEqual(["2350317571", "2350321667"]);
    for (const message of faultMessages) {
      expect(message.payload["0"].fixed).toMatchObject({
        ID: 52103,
        batteryProtectionWarningWord: 1,
        batteryHardwareErrorWord: 8,
      });
    }
  });
});
