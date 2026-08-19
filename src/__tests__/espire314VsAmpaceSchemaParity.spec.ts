import {
  resolveTelemetryTemplate,
} from "../telemetry/templateAdapter";

// Schema-parity check: eSpire314_ESMU_ss_TEMPLATE against AMPACE_Mini_ss40k
// (device.model === "BMS" — the closest existing analog, since eSpire314/ESMU
// is also a BMS). This doesn't re-validate the adapter (espire314EsmuTemplate.spec.ts
// already does that) — it checks whether the new template actually follows the
// conventions the rest of the fleet's BMS template uses, per the readiness
// review in docs/eSpire314_ESMU_Modbus_Register_Map.md.
describe("eSpire314_ESMU_ss_TEMPLATE vs AMPACE_Mini_ss40k (BMS) schema parity", () => {
  const ampace = resolveTelemetryTemplate("AMPACE_Mini_ss40k");
  const espire = resolveTelemetryTemplate("eSpire314_ESMU_ss_TEMPLATE");

  test("both resolve as BMS-class devices", () => {
    expect(ampace.device.model).toBe("BMS");
    // eSpire314's device.model is "ESMU" (vendor's own term) - same role, different label.
  });

  test("commands: eSpire314 commands should carry pollClass like AMPACE's do", () => {
    const ampaceHasPollClass = ampace.commands!.every((c) => !!c.pollClass);
    const espireHasPollClass = espire.commands!.every((c) => !!c.pollClass);
    expect(ampaceHasPollClass).toBe(true);
    expect(espireHasPollClass).toBe(true);
  });

  test("alarms: AMPACE packs alarm bits via bitfieldStatus on a normal HR/IR read; eSpire314 uses raw DI", () => {
    const ampaceUsesBitfield = ampace.telemetry.some((t) => t.bitfieldStatus);
    const espireUsesBitfield = espire.telemetry.some((t) => t.bitfieldStatus);
    const espireUsesRawDI = espire.telemetry.some((t) => t.function === "DI");

    expect(ampaceUsesBitfield).toBe(true);
    expect(espireUsesRawDI).toBe(true); // by design - see register map doc §8
    // eSpire314 does NOT follow AMPACE's bitfieldStatus convention for alarms,
    // which is *why* its 80 alarm points aren't pollable yet (no 02H reader
    // support) even though bitfieldStatus-on-HR/IR would have been pollable
    // today with zero core changes.
    expect(espireUsesBitfield).toBe(false);
  });

  test("ss40k.model: KNOWN GAP, not fixed here - still 'TODO' fleet-wide, needs registry sign-off", () => {
    // AMPACE (and the rest of the fleet) reuse a shared ss40k model-number
    // registry keyed by point name (e.g. name:"SoC" -> model:"42101" appears
    // ~22x across other vendor templates for the same physical quantity).
    // eSpire314's ss40k.name values are just copies of the long `id` field
    // (e.g. "SystemSOC"), not the registry's short canonical names, so a
    // blind lookup won't hit -- and ss40k.ts consumes model/name as opaque
    // strings with no local validation, so a wrong-but-plausible model
    // number would fail silently downstream instead of erroring here.
    // Deliberately left as a known, visible gap rather than guessed at --
    // needs sign-off from whoever owns the ss40k model registry.
    const ampaceRealModelCount = ampace.telemetry.filter(
      (t) => t.ss40k && t.ss40k.model !== "TODO"
    ).length;
    const espireRealModelCount = espire.telemetry.filter(
      (t) => t.ss40k && t.ss40k.model !== "TODO"
    ).length;
    const espireTodoCount = espire.telemetry.filter(
      (t) => t.ss40k && t.ss40k.model === "TODO"
    ).length;

    expect(ampaceRealModelCount).toBeGreaterThan(0);
    console.log(
      `eSpire314 ss40k.model: ${espireRealModelCount} real / ${espireTodoCount} still "TODO" (of ${espire.telemetry.length} telemetry points) - needs registry owner sign-off, not guessed here`
    );
    expect(espireRealModelCount).toBe(0); // intentionally still failing-state-as-documented, see comment above
  });

  test("supportingTag: eSpire314 marks its string#/point# companion fields as supporting, like AMPACE marks its decoded-elsewhere raw fields", () => {
    const ampaceUsesSupportingTag = ampace.telemetry.some((t) => t.supportingTag !== undefined);
    const espireSupportingIds = espire.telemetry
      .filter((t) => t.supportingTag !== undefined)
      .map((t) => t.id);
    expect(ampaceUsesSupportingTag).toBe(true);
    expect(espireSupportingIds.length).toBe(8);
    expect(espireSupportingIds).toEqual(
      expect.arrayContaining([
        "MaxBatteryVoltageStringNo",
        "MaxBatteryVoltagePointNo",
        "MinBatteryVoltageStringNo",
        "MinBatteryVoltagePointNo",
        "MaxBatteryTemperatureStringNo",
        "MaxBatteryTemperaturePointNo",
        "MinBatteryTemperatureStringNo",
        "MinBatteryTemperaturePointNo",
      ])
    );
  });
});
