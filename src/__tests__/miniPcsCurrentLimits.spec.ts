import { buildReadPlan } from "../compiler/compiler";
import { onReply } from "../reader/reader";
import type { ReadPlan } from "../types";
import { adaptTelemetryTemplateToReadProfile, resolveTelemetryTemplate } from "../telemetry/templateAdapter";
import { buildSs40kFixedPayloads, buildSs40kLookup } from "../telemetry/ss40k";
import { filterSs40kPayloadsForReporting } from "../telemetry/reportingStrategy";

const profileName = "Sinexcel_Mini_PCS_ss40k";
const nowMs = Date.parse("2026-10-20T23:00:00Z");

function exportReadbacks(charge: number, discharge: number, equipment = "PCS", ageMs = 0) {
  const { lookup } = buildSs40kLookup({ [equipment]: { profileName } });
  return buildSs40kFixedPayloads({ lookup, topic: "test", fixedSerialNumber: `${equipment}-SN`,
    nowMs, maxSampleAgeMs: 15000,
    telemetry: { [equipment]: [
      { tagID: `${equipment}.MaxChargingCurrent`, value: charge, timestamp: nowMs - ageMs },
      { tagID: `${equipment}.MaxDischargingCurrent`, value: discharge, timestamp: nowMs - ageMs },
      { tagID: `${equipment}.MaxChgCurrent`, value: 999, timestamp: nowMs },
      { tagID: `${equipment}.BamsPermitChgCurrent`, value: 190, timestamp: nowMs },
    ] } });
}

test.each(["PCS", "Mini2_PCS"])("exports measured current limits under %s identity, including zero and fractional amps", equipment => {
  const messages = exportReadbacks(0, 93.8, equipment);
  expect(messages).toHaveLength(1);
  expect(messages[0].ss40k).toMatchObject({ model: "40104", equipment });
  expect(messages[0].payload["10"].fixed).toEqual({
    ID: 40104, SN: `${equipment}-SN`, MaxChargingCurrent: 0, MaxDischargingCurrent: 93.8,
  });
});

test("polls current-limit registers once per merged block and keeps command readbacks unchanged", () => {
  const template = resolveTelemetryTemplate(profileName);
  const profile = adaptTelemetryTemplateToReadProfile(profileName, template);
  const plan: ReadPlan = buildReadPlan(profile, { equipmentId: "PCS", serverKey: "PCS", unitId: 1 }, {
    maxQty: 100, maxSpan: 100, maxHole: 0, pollFast: 250, pollNormal: 1000, pollSlow: 5000,
  } as any);
  for (const address of [1626, 1627]) {
    expect(plan.blocks.filter((b: { start: number; quantity: number }) => b.start <= address && b.start + b.quantity > address)).toHaveLength(1);
  }
  const samples = plan.blocks.flatMap((b: { start: number; quantity: number }, blockIdx: number) => {
    if (b.start > 1626 || b.start + b.quantity <= 1627) return [];
    const payload = Array.from({ length: b.quantity }, (_, i) => b.start + i === 1627 ? 938 : 0);
    return onReply({ _reader: { equipmentId: "PCS", blockIdx }, payload }, plan, {
      MODBUS_ZERO_BASED: false, RESPECT_TAG_CLAMP: false, SCALE_CLAMP_DEFAULT: false, SKIP_EMPTY_SAMPLES: false,
    } as any).out2 || [];
  });
  const values = Object.fromEntries(samples.map((t: any) => [t.tagID, t.value]));
  expect(values.MaxChargingCurrent).toBe(0);
  expect(values.MaxChgCurrent).toBe(0);
  expect(values.MaxDischargingCurrent).toBeCloseTo(93.8);
  expect(values.MaxDsgCurrent).toBeCloseTo(93.8);
  expect(template.commands!.find(t => t.id === "MaxChgCurrent")).toMatchObject({ address: 1626, readback: true });
  expect(template.commands!.find(t => t.id === "MaxDsgCurrent")).toMatchObject({ address: 1627, readback: true });
});

test("does not export stale limits or invent zeros for missing readbacks", () => {
  expect(exportReadbacks(0, 93.8, "PCS", 15001)).toHaveLength(0);
  const { lookup } = buildSs40kLookup({ PCS: profileName });
  expect(buildSs40kFixedPayloads({ lookup, telemetry: {}, topic: "test" })).toHaveLength(0);
});

test("reports changed limits immediately and repeats unchanged 40104 limits periodically", () => {
  const first = filterSs40kPayloadsForReporting({ messages: exportReadbacks(20, 93.8), nowMs: 0 });
  expect(first.decisions[0].reason).toBe("initial");
  const changed = filterSs40kPayloadsForReporting({ messages: exportReadbacks(0, 93.8), state: first.state, nowMs: 1000 });
  expect(changed.decisions[0].reason).toBe("changed");
  const unchanged = filterSs40kPayloadsForReporting({ messages: exportReadbacks(0, 93.8), state: changed.state, nowMs: 2000 });
  expect(unchanged.messages).toHaveLength(0);
  const due = filterSs40kPayloadsForReporting({ messages: exportReadbacks(0, 93.8), state: changed.state, nowMs: 301000 });
  expect(due.decisions[0].reason).toBe("periodic");
});

test("existing site signal mapping can publish the same PCS readbacks without a runtime restart", () => {
  const { lookup } = buildSs40kLookup({ PCS: profileName });
  const messages = buildSs40kFixedPayloads({ lookup, topic: "test", fixedSerialNumber: "PCS-SN", nowMs, maxSampleAgeMs: 15000,
    telemetry: { PCS: [
      { tagID: "PCS.MaxChgCurrent", value: 0, timestamp: nowMs },
      { tagID: "PCS.MaxDsgCurrent", value: 93.8, timestamp: nowMs },
    ] }, signalMapping: { ss40k: {
      MaxChargingCurrent: { model: "40104", expr: "PCS.MaxChgCurrent" },
      MaxDischargingCurrent: { model: "40104", expr: "PCS.MaxDsgCurrent" },
    } } });
  expect(messages.find(m => m.ss40k.model === "40104")!.payload["10"].fixed).toMatchObject({
    SN: "PCS-SN", MaxChargingCurrent: 0, MaxDischargingCurrent: 93.8,
  });
});
