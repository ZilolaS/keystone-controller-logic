import {
  filterSs40kPayloadsForReporting,
  type Ss40kReportingState,
} from "../telemetry/reportingStrategy";
import type { Ss40kPayloadMessage } from "../telemetry/ss40k";

function message(model: string, fixed: Record<string, unknown>): Ss40kPayloadMessage {
  return {
    topic: "fort/v1/things/test/telem",
    payload: {
      "0": {
        fixed: { ID: Number(model), ...fixed },
        id: Number(model),
        version: "3.0",
      },
    },
    ss40k: {
      equipment: model.startsWith("42") ? "AMPACE_BCU_1" : "PCS",
      model,
      modelIndex: "0",
      timestamp: "2026-06-23T00:00:00.000Z",
      pointCount: Object.keys(fixed).length + 1,
    },
  };
}

describe("SS40K reporting strategy", () => {
  test("monitoring models report initially and then on the 5 minute cadence", () => {
    let state: Ss40kReportingState | undefined;
    const first = filterSs40kPayloadsForReporting({
      messages: [message("42101", { V: 6366 })],
      state,
      nowMs: 0,
    });
    expect(first.messages).toHaveLength(1);
    expect(first.decisions[0].reason).toBe("initial");
    state = first.state;

    const early = filterSs40kPayloadsForReporting({
      messages: [message("42101", { V: 6366 })],
      state,
      nowMs: 60_000,
    });
    expect(early.messages).toHaveLength(0);

    const due = filterSs40kPayloadsForReporting({
      messages: [message("42101", { V: 6366 })],
      state,
      nowMs: 300_000,
    });
    expect(due.messages).toHaveLength(1);
    expect(due.decisions[0].reason).toBe("periodic");
  });

  test("fault models report immediately when their fixed payload changes", () => {
    const first = filterSs40kPayloadsForReporting({
      messages: [message("40103", { pcsFault: 0, gridFault: 0 })],
      nowMs: 0,
    });

    const changed = filterSs40kPayloadsForReporting({
      messages: [message("40103", { pcsFault: 1, gridFault: 0 })],
      state: first.state,
      nowMs: 5_000,
    });

    expect(changed.messages).toHaveLength(1);
    expect(changed.decisions[0].reason).toBe("fault-changed");
  });

  test("Mini-specific 50103 and 52103 models follow fault reporting strategy", () => {
    let state: Ss40kReportingState | undefined;
    const first = filterSs40kPayloadsForReporting({
      messages: [
        message("50103", { pcsFaultWord106: 0 }),
        message("52103", { batteryProtectionWarningWord: 0 }),
      ],
      state,
      nowMs: 0,
    });
    expect(first.messages).toHaveLength(2);
    expect(first.decisions.map((decision) => decision.reason)).toEqual([
      "initial",
      "initial",
    ]);
    state = first.state;

    const unchanged = filterSs40kPayloadsForReporting({
      messages: [
        message("50103", { pcsFaultWord106: 0 }),
        message("52103", { batteryProtectionWarningWord: 0 }),
      ],
      state,
      nowMs: 300_000,
    });
    expect(unchanged.messages).toHaveLength(0);

    const changed = filterSs40kPayloadsForReporting({
      messages: [
        message("50103", { pcsFaultWord106: 1 }),
        message("52103", { batteryProtectionWarningWord: 2 }),
      ],
      state,
      nowMs: 305_000,
    });
    expect(changed.messages).toHaveLength(2);
    expect(changed.decisions.map((decision) => decision.reason)).toEqual([
      "fault-changed",
      "fault-changed",
    ]);
  });

  test("40104 reports on the 5 minute cadence and on change", () => {
    const first = filterSs40kPayloadsForReporting({
      messages: [message("40104", { VoltVarV1: 100 })],
      nowMs: 0,
    });

    const early = filterSs40kPayloadsForReporting({
      messages: [message("40104", { VoltVarV1: 100 })],
      state: first.state,
      nowMs: 60_000,
    });
    expect(early.messages).toHaveLength(0);

    const periodic = filterSs40kPayloadsForReporting({
      messages: [message("40104", { VoltVarV1: 100 })],
      state: first.state,
      nowMs: 300_000,
    });
    expect(periodic.messages).toHaveLength(1);
    expect(periodic.decisions[0].reason).toBe("periodic");

    const changed = filterSs40kPayloadsForReporting({
      messages: [message("40104", { VoltVarV1: 101 })],
      state: periodic.state,
      nowMs: 310_000,
    });
    expect(changed.messages).toHaveLength(1);
    expect(changed.decisions[0].reason).toBe("changed");
  });

  test("non-heartbeat config models do not report periodically but do report on change", () => {
    const first = filterSs40kPayloadsForReporting({
      messages: [message("40204", { Limit: 100 })],
      nowMs: 0,
    });

    const periodic = filterSs40kPayloadsForReporting({
      messages: [message("40204", { Limit: 100 })],
      state: first.state,
      nowMs: 600_000,
    });
    expect(periodic.messages).toHaveLength(0);

    const changed = filterSs40kPayloadsForReporting({
      messages: [message("40204", { Limit: 101 })],
      state: first.state,
      nowMs: 610_000,
    });
    expect(changed.messages).toHaveLength(1);
    expect(changed.decisions[0].reason).toBe("changed");
  });

  test("on-demand reporting forces selected models", () => {
    const first = filterSs40kPayloadsForReporting({
      messages: [message("40101", { W: 1000 })],
      nowMs: 0,
    });

    const forced = filterSs40kPayloadsForReporting({
      messages: [message("40101", { W: 1000 })],
      state: first.state,
      nowMs: 1_000,
      forceModels: ["40101"],
    });

    expect(forced.messages).toHaveLength(1);
    expect(forced.decisions[0].reason).toBe("on-demand");
  });
});
