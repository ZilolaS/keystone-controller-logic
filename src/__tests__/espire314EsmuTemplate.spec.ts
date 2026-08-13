import {
  resolveTelemetryTemplate,
  adaptTelemetryTemplateToReadProfile,
} from "../telemetry/templateAdapter";

// eSpire 314 (ESMU) — see docs/eSpire314_ESMU_Modbus_Register_Map.md for the
// full register map and per-point confidence notes. Unlike every other
// product template here, ESMU's 80 system alarm points use "function": "DI"
// (Modbus discrete-input reads, 02H) — a code ModbusNumericType (src/types.ts)
// doesn't define yet, so those points normalize but won't actually be
// pollable until reader.ts gets 02H support. This test exercises the real
// templateAdapter the same way every other device's template is exercised,
// so schema drift here is caught the same way it would be for any other
// product, and documents the DI gap inline rather than silently ignoring it.
describe("eSpire314_ESMU_ss_TEMPLATE (draft — see register map doc for confidence levels)", () => {
  test("resolves and validates via the real template adapter", () => {
    const template = resolveTelemetryTemplate("eSpire314_ESMU_ss_TEMPLATE");
    expect(template.device.vendor).toContain("GE-Q730-1-141-A");
    expect(template.device.protocol).toBe("modbus-tcp");
    expect(template.telemetry.length).toBeGreaterThan(100);
    expect(template.commands?.length).toBeGreaterThan(0);
  });

  test("normalizes into a read profile without throwing", () => {
    const template = resolveTelemetryTemplate("eSpire314_ESMU_ss_TEMPLATE");
    const profile = adaptTelemetryTemplateToReadProfile(
      "eSpire314_ESMU_ss_TEMPLATE",
      template
    );
    expect(profile.tags.length).toBe(
      template.telemetry.length + (template.commands?.length ?? 0)
    );
  });

  test("the control registers (string select / fault reset / breaker) are present with real addresses", () => {
    const template = resolveTelemetryTemplate("eSpire314_ESMU_ss_TEMPLATE");
    const byId = new Map((template.commands ?? []).map((c) => [c.id, c]));
    expect(byId.get("StringNumberSelector")?.address).toBe(500);
    expect(byId.get("SystemFaultReset")?.address).toBe(501);
    expect(byId.get("MainCircuitBreakerControl")?.address).toBe(502);
  });

  test("system alarm points are flagged as not-yet-pollable (function 'DI', not a real ModbusNumericType)", () => {
    const template = resolveTelemetryTemplate("eSpire314_ESMU_ss_TEMPLATE");
    const diPoints = template.telemetry.filter((t) => t.function === "DI");
    expect(diPoints.length).toBe(80);
    for (const point of diPoints) {
      expect((point as any).notes).toMatch(/NOT YET POLLABLE/);
    }
  });
});
