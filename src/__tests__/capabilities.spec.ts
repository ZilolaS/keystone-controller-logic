import { deriveCapabilities, isNanoModel, parseMiniModel } from "../capabilities";
import type { SiteConfig } from "../config";

describe("MINI model parsing", () => {
  test("defaults omitted MINI voltage to 480 VLL", () => {
    expect(parseMiniModel("MINI-90-135-288")).toMatchObject({
      modelCode: "MINI-90-135-288-480",
      pcsKw: 90,
      dcPvKw: 135,
      batteryKwh: 288,
      voltageVll: 480,
      hasDcPvConverter: true,
    });
  });
});

describe("NANO model parsing", () => {
  test("recognizes NANO product profiles without Mini sizing fields", () => {
    expect(isNanoModel("NANO")).toBe(true);
    expect(isNanoModel("NANO-S6-HYBRID")).toBe(true);
    expect(isNanoModel("MINI-60-90-163-480")).toBe(false);

    const config: SiteConfig = {
      system: {
        systemProfile: "NANO",
        controllerTimezone: "America/Los_Angeles",
        nominal: { voltageVll: 240, frequencyHz: 60 },
      },
      network: {
        controller: {
          ip: "192.168.1.10",
          modbusServer: { ip: "192.168.1.20", port: 502 },
        },
      },
      operation: {
        mode: "grid-tied",
        gridCode: "IEEE1547-2018",
        crdMode: "no-restriction",
        scheduledControlEnabled: false,
      },
      battery: { minSoc: 10, maxSoc: 90 },
      pv: { acInverters: [] },
      metering: {
        meterType: "none",
        modbusProfile: "",
        ip: "",
        reads: { utility: false, load: false, pv: false, pvFromInverter: true },
      },
    };

    expect(deriveCapabilities(config)).toMatchObject({
      isNano: true,
      isMini: false,
      is280: false,
      hasPcs: true,
      hasMbmu: false,
    });
  });
});
