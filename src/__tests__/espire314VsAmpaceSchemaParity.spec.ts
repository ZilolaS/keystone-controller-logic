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
    // Not a hard failure at runtime -- compiler.ts defaults missing pollClass to
    // "normal" -- but it means every eSpire314 command is silently falling back
    // instead of having an explicit, reviewed polling cadence the way AMPACE's do.
    const ampaceHasPollClass = ampace.commands!.every((c) => !!c.pollClass);
    const espireHasPollClass = espire.commands!.every((c) => !!c.pollClass);
    expect(ampaceHasPollClass).toBe(true);
    expect(espireHasPollClass).toBe(true); // expected to FAIL today
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

  test("ss40k.model: eSpire314 should have real model numbers like AMPACE, not 'TODO'", () => {
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
      `eSpire314 ss40k.model: ${espireRealModelCount} real / ${espireTodoCount} still "TODO" (of ${espire.telemetry.length} telemetry points)`
    );
    expect(espireRealModelCount).toBeGreaterThan(0); // expected to FAIL today - it's 0
  });

  test("supportingTag: AMPACE marks some points as supporting-only; eSpire314 doesn't use the field at all", () => {
    const ampaceUsesSupportingTag = ampace.telemetry.some((t) => t.supportingTag !== undefined);
    const espireUsesSupportingTag = espire.telemetry.some((t) => t.supportingTag !== undefined);
    expect(ampaceUsesSupportingTag).toBe(true);
    expect(espireUsesSupportingTag).toBe(true); // expected to FAIL today
  });
});
