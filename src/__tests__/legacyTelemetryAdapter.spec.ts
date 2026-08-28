import {
  applyLegacyTelemetryAdapters,
  isLegacyTelemetrySource,
  legacySourceAllowsBcuTelemetry,
  legacyTelemetryAdaptersFromConfig,
} from "../telemetry/legacyAdapter";

describe("legacy telemetry adapter", () => {
  const config = {
    system: {
      systemProfile: "MINI-90-135-184-480",
      controllerTimezone: "America/Los_Angeles",
      nominal: { voltageVll: 480, frequencyHz: 60 },
    },
    network: {
      controller: {
        ip: "10.253.0.40",
        modbusServer: { ip: "192.168.1.10", port: 502 },
      },
    },
    operation: {
      mode: "grid-tied",
      gridCode: "IEEE1547-2018",
      crdMode: "no-restriction",
      siteExportMode: "no-restriction",
    },
    battery: {
      minSoc: 0.2,
      maxSoc: 0.95,
      socLow: 0.2,
      socLowRecover: 0.22,
      socHigh: 0.95,
      socHighRecover: 0.93,
      forceGridChargeSoc: 0.02,
      forceGridChargeMinCellVoltageV: 2.95,
      forceGridChargeKw: 10,
    },
    pv: { acInverters: [] },
    metering: {
      meterType: "",
      modbusProfile: "",
      ip: "",
      port: 502,
      unitId: 1,
      reads: { pv: false, pvFromInverter: true, utility: true, load: true },
      calculations: {},
    },
    signalMapping: {
      sources: {
        AMPACE: {
          source: "legacyGlobal",
          legacyEquipment: "Battery_A",
          profileName: "AMPACE_Mini_ss40k",
          staleMs: 60_000,
        },
      },
    },
  } as const;

  test("detects configured legacy source and disables BCU supplement by default", () => {
    expect(legacyTelemetryAdaptersFromConfig(config)).toMatchObject([
      {
        equipmentId: "AMPACE",
        source: "legacyGlobal",
        legacyEquipment: "Battery_A",
        profileName: "AMPACE_Mini_ss40k",
      },
    ]);
    expect(isLegacyTelemetrySource(config, "AMPACE")).toBe(true);
    expect(legacySourceAllowsBcuTelemetry(config, "AMPACE")).toBe(false);
  });

  test("bridges parent BAMS telemetry into unified AMPACE tags", () => {
    const result = applyLegacyTelemetryAdapters({
      config,
      nowMs: Date.parse("2026-08-28T00:00:10.000Z"),
      telemetry: {
        PCS: [{ tagID: "PCS.GridTotalActivePower", value: 12 }],
      },
      legacyTelemetry: {
        Battery_A: [
          {
            tagID: "Battery_A.BamsSoc",
            value: 0.81,
            timestamp: "2026-08-28T00:00:00.000Z",
          },
          {
            tagID: "Battery_A.BamsPower",
            value: -4.5,
            timestamp: "2026-08-28T00:00:00.000Z",
          },
          {
            tagID: "Battery_A.BamsMaxCellVol",
            value: 3.31,
            timestamp: "2026-08-28T00:00:00.000Z",
          },
        ],
      },
    });

    expect(result.applied).toEqual([
      {
        equipmentId: "AMPACE",
        legacyEquipment: "Battery_A",
        count: 3,
        stale: false,
      },
    ]);
    expect(result.telemetry.PCS).toHaveLength(1);
    expect(result.telemetry.AMPACE).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagID: "AMPACE.BamsSoc",
          value: 0.81,
          source: "legacyGlobal",
          sourceEquipment: "Battery_A",
          stale: false,
        }),
        expect.objectContaining({
          tagID: "AMPACE.BamsPower",
          value: -4.5,
        }),
        expect.objectContaining({
          tagID: "AMPACE.BamsMaxCellVol",
          value: 3.31,
        }),
      ])
    );
  });

  test("supports explicit tag maps for site-specific legacy names", () => {
    const result = applyLegacyTelemetryAdapters({
      config: {
        ...config,
        signalMapping: {
          sources: {
            Battery: {
              source: "legacyGlobal",
              legacyEquipment: "OldBms",
              tagMap: {
                BamsSoc: ["soc_percent"],
                BamsPower: ["OldBms.power_kw"],
              },
            },
          },
        },
      },
      legacyTelemetry: {
        OldBms: {
          soc_percent: 72,
          power_kw: { value: 9.4, timestamp: "2026-08-28T00:00:00Z" },
        },
      },
      nowMs: Date.parse("2026-08-28T00:00:05Z"),
    });

    expect(result.telemetry.Battery).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tagID: "Battery.BamsSoc", value: 72 }),
        expect.objectContaining({ tagID: "Battery.BamsPower", value: 9.4 }),
      ])
    );
  });
});
