import { evaluateSignalMapping } from "../coreControl";
import {
  buildMiniSignalMappingPreset,
  resolveMiniPvdcCount,
} from "../signalMappingPresets";

describe("Mini signal mapping presets", () => {
  test("derives PVDC count from Mini model number", () => {
    expect(resolveMiniPvdcCount({ systemProfile: "MINI-60-90-246" })).toBe(2);
    expect(resolveMiniPvdcCount({ systemProfile: "MINI-90-135-288" })).toBe(3);
    expect(resolveMiniPvdcCount({ systemProfile: "MINI-30-45-123" })).toBe(1);
    expect(resolveMiniPvdcCount({ systemProfile: "MINI-60-90-246", pvdcCount: 3 })).toBe(3);
  });

  test("maps PCS grid, PCS load, and dynamic PVDC production", () => {
    const mapping = buildMiniSignalMappingPreset("mini_pcs_grid_load_pvdc", {
      systemProfile: "MINI-60-90-246",
    });

    expect(Object.keys(mapping.sources || {}).sort()).toEqual([
      "AMPACE",
      "Gateway",
      "Load",
      "PCS",
      "PVDC1",
      "PVDC2",
    ]);
    expect(mapping.signals?.pvPowerKw?.expr).toBe(
      "PVDC1.PVBusSidePower + PVDC2.PVBusSidePower"
    );
    expect(mapping.sources?.Gateway).toMatchObject({
      profile: "Sinexcel_Mini_Gateway_ss40k",
      ip: "192.168.1.101",
      port: 502,
      unitId: 1,
    });

    const result = evaluateSignalMapping(mapping, {
      PCS: [
        { tagID: "PCS.GridTotalActivePower", value: -34.1 },
        { tagID: "PCS.ACBusTotalActivePower", value: -6.5 },
      ],
      Load: [{ tagID: "Load.LoadTotalActivePower", value: 2 }],
      PVDC1: [{ tagID: "PVDC1.PVBusSidePower", value: 16.4 }],
      PVDC2: [{ tagID: "PVDC2.PVBusSidePower", value: 17.9 }],
      AMPACE: [{ tagID: "AMPACE.BamsPower", value: -4.2 }],
    });

    expect(result.signals).toMatchObject({
      gridPowerKw: -34.1,
      utilityPowerKw: -34.1,
      loadPowerKw: 2,
      siteLoadKw: 2,
      pvPowerKw: 34.3,
      pvKw: 34.3,
      pcsPowerKw: 6.5,
      pcsActivePowerKw: 6.5,
      batteryPowerKw: -4.2,
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("maps eGauge grid and load with PVDC production", () => {
    const mapping = buildMiniSignalMappingPreset("mini_egauge_grid_load_pvdc", {
      systemProfile: "MINI-90-135-288",
      meterIp: "192.168.1.88",
    });

    expect(Object.keys(mapping.sources || {}).sort()).toEqual([
      "AMPACE",
      "Gateway",
      "Meter",
      "PCS",
      "PVDC1",
      "PVDC2",
      "PVDC3",
    ]);
    expect(mapping.sources?.Meter).toMatchObject({
      profile: "configured_eGauge",
      ip: "192.168.1.88",
      role: "siteMeter",
    });
    expect(mapping.sources?.Gateway).toMatchObject({
      profile: "Sinexcel_Mini_Gateway_ss40k",
      ip: "192.168.1.101",
      port: 502,
      unitId: 1,
    });
    expect(mapping.signals?.pvPowerKw?.expr).toBe(
      "PVDC1.PVBusSidePower + PVDC2.PVBusSidePower + PVDC3.PVBusSidePower"
    );

    const result = evaluateSignalMapping(mapping, {
      Meter: [
        { tagID: "Meter.Utility_Total_Power", value: -12.2 },
        { tagID: "Meter.Load_Active_Power", value: 48.5 },
      ],
      PCS: [{ tagID: "PCS.ACBusTotalActivePower", value: -5 }],
      PVDC1: [{ tagID: "PVDC1.PVBusSidePower", value: 10 }],
      PVDC2: [{ tagID: "PVDC2.PVBusSidePower", value: 11 }],
      PVDC3: [{ tagID: "PVDC3.PVBusSidePower", value: 12 }],
      AMPACE: [{ tagID: "AMPACE.BamsPower", value: 3.5 }],
    });

    expect(result.signals).toMatchObject({
      gridPowerKw: -12.2,
      loadPowerKw: 48.5,
      pvPowerKw: 33,
      pcsPowerKw: 5,
      batteryPowerKw: 3.5,
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("maps eGauge grid with PCS load and PVDC production", () => {
    const mapping = buildMiniSignalMappingPreset("mini_egauge_grid_pcs_load_pvdc", {
      systemProfile: "MINI-60-90-246",
      meterProfile: "eGauge_Site_Meter",
    });

    expect(mapping.sources?.Meter).toMatchObject({
      profile: "eGauge_Site_Meter",
      role: "siteMeter",
    });
    expect(mapping.sources?.Load).toMatchObject({
      profile: "Sinexcel_Mini_Load_ss40k",
      role: "load",
    });

    const result = evaluateSignalMapping(mapping, {
      Meter: [{ tagID: "Meter.Utility_Total_Power", value: 6.1 }],
      Load: [{ tagID: "Load.LoadTotalActivePower", value: 42 }],
      PCS: [{ tagID: "PCS.ACBusTotalActivePower", value: 2.5 }],
      PVDC1: [{ tagID: "PVDC1.PVBusSidePower", value: 12 }],
      PVDC2: [{ tagID: "PVDC2.PVBusSidePower", value: 13 }],
      AMPACE: [{ tagID: "AMPACE.BamsPower", value: -8 }],
    });

    expect(result.signals).toMatchObject({
      gridPowerKw: 6.1,
      loadPowerKw: 42,
      pvPowerKw: 25,
      pcsPowerKw: -2.5,
      batteryPowerKw: -8,
    });
    expect(result.diagnostics).toEqual([]);
  });
});
