import { evaluateSignalMapping } from "../coreControl";
import type { SignalMappingConfig } from "../config";

describe("signal mapping", () => {
  test("normalizes canonical power signal names and legacy aliases", () => {
    const signalMapping: SignalMappingConfig = {
      signals: {
        gridPowerKw: {
          expr: "PCS.GridTotalActivePower",
        },
        pvPowerKw: {
          expr: "PVDC1.PVBusSidePower + PVDC2.PVBusSidePower",
        },
        pcsPowerKw: {
          expr: "PCS.ACBusTotalActivePower",
          invertSign: true,
        },
        loadPowerKw: {
          expr: "gridPowerKw + pvPowerKw + pcsPowerKw",
        },
      },
    };

    const result = evaluateSignalMapping(signalMapping, {
      PCS: [
        { tagID: "PCS.GridTotalActivePower", value: -34.1 },
        { tagID: "PCS.ACBusTotalActivePower", value: -6.5 },
      ],
      PVDC1: [{ tagID: "PVDC1.PVBusSidePower", value: 14.2 }],
      PVDC2: [{ tagID: "PVDC2.PVBusSidePower", value: 15.3 }],
    });

    expect(result.signals).toMatchObject({
      gridPowerKw: -34.1,
      utilityPowerKw: -34.1,
      pvPowerKw: 29.5,
      pvKw: 29.5,
      pcsPowerKw: 6.5,
      pcsActivePowerKw: 6.5,
    });
    expect(result.signals.loadPowerKw).toBeCloseTo(1.9);
    expect(result.signals.siteLoadKw).toBeCloseTo(1.9);
    expect(result.diagnostics).toEqual([]);
  });

  test("derives Mini site load from eGauge utility and PCS active power", () => {
    const signalMapping: SignalMappingConfig = {
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
      },
    };

    const result = evaluateSignalMapping(signalMapping, {
      Meter: [
        {
          tagID: "Meter.Utility_Total_Power",
          value: 40,
        },
      ],
      PCS: [
        {
          tagID: "PCS.ACBusTotalActivePower",
          value: -12,
        },
      ],
    });

    expect(result.signals).toEqual({
      gridPowerKw: 40,
      utilityPowerKw: 40,
      pcsPowerKw: 12,
      pcsActivePowerKw: 12,
      loadPowerKw: 52,
      siteLoadKw: 52,
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("keeps combined display PV separate from DC-only control PV", () => {
    const result = evaluateSignalMapping(
      {
        signals: {
          pvPowerKw: {
            expr: "PVDC.Power + Meter.AcPvPower",
          },
          pvKw: {
            expr: "PVDC.Power",
          },
        },
      },
      {
        PVDC: [{ tagID: "PVDC.Power", value: 5 }],
        Meter: [{ tagID: "Meter.AcPvPower", value: 20 }],
      }
    );

    expect(result.signals.pvPowerKw).toBe(25);
    expect(result.signals.pvKw).toBe(5);
    expect(result.diagnostics).toEqual([]);
  });

  test("supports deadband helper and reports expression errors", () => {
    const result = evaluateSignalMapping(
      {
        signals: {
          pvKw: {
            expr: "deadband(PV.Power, 0.3)",
          },
          siteLoadKw: {
            expr: "Meter.Missing + 1",
          },
        },
      },
      {
        "PV.Power": 0.2,
      }
    );

    expect(result.signals).toEqual({
      pvPowerKw: 0,
      pvKw: 0,
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        signal: "siteLoadKw",
        status: "calc-error",
      }),
    ]);
  });
});
