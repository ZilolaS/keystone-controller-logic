import {
  classifyEspire290Faults,
  espire290CommandsToWriterEnvelopes,
  evaluateEspire290CmsSequencer,
  initialEspire290SequencerState,
  resolveEspire290PowerCaps,
  type Espire290CmsTelemetry,
  type Espire290SequencerState,
} from "../coreControl";

const healthy = (overrides: Partial<Espire290CmsTelemetry> = {}): Espire290CmsTelemetry => ({
  cmsFaultStatus: 0,
  cmsHvOnStatus: 0,
  cmsFaultWord1: 0,
  cmsFaultWord2: 0,
  imuStatus: 0b0010,
  sysOperationMode: 2,
  bmsConfigNumber: 2,
  bmsEnableStatus: 0b11,
  cmsAllowedChargePowerKw: 200,
  cmsAllowedDischargePowerKw: 220,
  clusters: [{ bmsSelfCheck: 1 }, { bmsSelfCheck: 1 }],
  ...overrides,
});

describe("eSpire 290 fault classification", () => {
  test("level-3 protection trip is remotely recoverable", () => {
    const result = classifyEspire290Faults(
      healthy({ cmsFaultStatus: 0b01, clusters: [{ faultCode1: 1 << 0 }, {}] })
    );
    expect(result).toMatchObject({ faulted: true, recoverable: true, unrecoverableClusters: [] });
    expect(result.reasons).toContain("e290-bms1-protection-trip");
  });

  test("fire/gas/water/E-stop and fuses are never recoverable", () => {
    const fire = classifyEspire290Faults(healthy({ clusters: [{}, { faultCode3: 1 << 1 }] }));
    expect(fire).toMatchObject({ recoverable: false, unrecoverableClusters: [2] });
    const fuse = classifyEspire290Faults(healthy({ clusters: [{ faultCode3: 1 << 6 }, {}] }));
    expect(fuse.clusterFaults[0].categories).toContain("hardware");
    const estop = classifyEspire290Faults(healthy({ cmsFaultWord2: 1 }));
    expect(estop.systemCategories).toContain("hazard");
  });

  test("door-open/smoke DI bit is informational only", () => {
    expect(classifyEspire290Faults(healthy({ clusters: [{ faultCode3: 1 << 2 }, {}] })).faulted).toBe(false);
  });

  test("SOC < 10 % blocks HV-on without counting as a fault; forced-charge flag surfaces", () => {
    const result = classifyEspire290Faults(
      healthy({ cmsFaultWord1: 1 << 7, clusters: [{ faultCode2: 1 << 5 }, {}] })
    );
    expect(result).toMatchObject({ faulted: false, hvOnBlocked: true, forcedChargeRequested: true });
  });

  test("disabled clusters are ignored", () => {
    const result = classifyEspire290Faults(healthy({ clusters: [{}, { faultCode3: 1 }] }), 0b01);
    expect(result.faulted).toBe(false);
  });
});

describe("eSpire 290 power caps", () => {
  test("clamps CMS limits to the PCS rating", () => {
    const caps = resolveEspire290PowerCaps({
      telemetry: healthy({ cmsHvOnStatus: 0b11 }),
      enabledMask: 0b11,
      pcsRatingKw: 125,
    });
    expect(caps).toMatchObject({ maxChargeKw: 125, maxDischargeKw: 125 });
  });

  test("zero when no cluster is on HV or a direction is forbidden", () => {
    expect(
      resolveEspire290PowerCaps({ telemetry: healthy(), enabledMask: 0b11, pcsRatingKw: 250 })
    ).toMatchObject({ maxChargeKw: 0, maxDischargeKw: 0 });
    const forbid = resolveEspire290PowerCaps({
      telemetry: healthy({ cmsHvOnStatus: 0b11, bmsChargeForbidStatus: 0b10 }),
      enabledMask: 0b11,
      pcsRatingKw: 250,
    });
    expect(forbid).toMatchObject({ maxChargeKw: 0, maxDischargeKw: 220 });
  });
});

describe("eSpire 290 CMS sequencer", () => {
  const input = (telemetry: Espire290CmsTelemetry, runRequested = true) => ({
    telemetry,
    runRequested,
    clusterCount: 2,
    pcsRatingKw: 250,
  });
  const opts = (nowMs: number) => ({ nowMs, settleMs: 1_000, hvOnTimeoutMs: 5_000 });

  test("walks the vendor startup flow: configure -> verify -> HV on -> running", () => {
    let state: Espire290SequencerState = initialEspire290SequencerState(2);

    let r = evaluateEspire290CmsSequencer(input(healthy()), state, opts(0));
    expect(r.state.mode).toBe("verify-config");
    expect(r.commands.map((c) => c.kind)).toEqual([
      "set-cluster-count",
      "set-enable-mask",
      "set-working-mode",
      "set-operation-mode",
    ]);
    state = r.state;

    r = evaluateEspire290CmsSequencer(input(healthy()), state, opts(500));
    expect(r.state.mode).toBe("verify-config");
    state = r.state;

    r = evaluateEspire290CmsSequencer(input(healthy()), state, opts(1_000));
    expect(r.state.mode).toBe("precheck");
    state = r.state;

    r = evaluateEspire290CmsSequencer(input(healthy()), state, opts(1_100));
    expect(r.commands).toEqual([{ kind: "hv-on" }]);
    expect(r.available).toBe(false);
    state = r.state;

    r = evaluateEspire290CmsSequencer(input(healthy({ cmsHvOnStatus: 0b11 })), state, opts(2_000));
    expect(r.state.mode).toBe("running");
    expect(r.available).toBe(true);
    expect(r.caps).toMatchObject({ maxChargeKw: 200, maxDischargeKw: 220 });
  });

  test("protection trip -> single reset -> settle -> retry", () => {
    const tripped = healthy({ cmsFaultStatus: 0b01, clusters: [{ faultCode1: 1, bmsSelfCheck: 1 }, { bmsSelfCheck: 1 }] });
    const state: Espire290SequencerState = { ...initialEspire290SequencerState(2), mode: "precheck" };
    let r = evaluateEspire290CmsSequencer(input(tripped), state, opts(0));
    expect(r.commands).toEqual([{ kind: "reset-all" }]);
    r = evaluateEspire290CmsSequencer(input(tripped), r.state, opts(100));
    expect(r.commands).toEqual([]);
    r = evaluateEspire290CmsSequencer(input(tripped), r.state, opts(1_000));
    expect(r.state.mode).toBe("precheck");
    r = evaluateEspire290CmsSequencer(input(tripped), r.state, opts(1_100));
    expect(r.commands).toEqual([{ kind: "reset-all" }]);
    r = evaluateEspire290CmsSequencer(input(tripped), r.state, opts(2_100));
    r = evaluateEspire290CmsSequencer(input(tripped), r.state, opts(2_200));
    expect(r.state).toMatchObject({ mode: "lockout", lockoutReason: "reset-attempts-exhausted" });
  });

  test("hazard on one cluster: isolated when allowed, lockout + HV off otherwise", () => {
    const fire = healthy({ cmsHvOnStatus: 0b11, clusters: [{ bmsSelfCheck: 1 }, { faultCode3: 1 << 5 }] });
    const running: Espire290SequencerState = { ...initialEspire290SequencerState(2), mode: "running" };

    const isolated = evaluateEspire290CmsSequencer(input(fire), running, {
      ...opts(0),
      allowClusterIsolation: true,
    });
    expect(isolated.commands).toEqual([
      { kind: "cluster-hv-off", cluster: 2 },
      { kind: "set-enable-mask", value: 0b01 },
    ]);
    expect(isolated.state).toMatchObject({ enabledMask: 0b01, isolatedMask: 0b10, mode: "verify-config" });

    const locked = evaluateEspire290CmsSequencer(input(fire), running, opts(0));
    expect(locked.commands).toEqual([{ kind: "hv-off" }]);
    expect(locked.state.mode).toBe("lockout");

    // Lockout holds until an operator clears it.
    const still = evaluateEspire290CmsSequencer(input(healthy()), locked.state, opts(10_000));
    expect(still.state.mode).toBe("lockout");
    const cleared = evaluateEspire290CmsSequencer(
      { ...input(healthy()), clearLockout: true },
      locked.state,
      opts(10_000)
    );
    expect(cleared.state.mode).toBe("verify-config");
  });

  test("SOC < 10 % holds in precheck instead of commanding HV on", () => {
    const low = healthy({ cmsFaultWord1: 1 << 7 });
    const state: Espire290SequencerState = { ...initialEspire290SequencerState(2), mode: "precheck" };
    const r = evaluateEspire290CmsSequencer(input(low), state, opts(0));
    expect(r.commands).toEqual([]);
    expect(r.reasons).toContain("e290-precheck-hv-on-blocked");
  });

  test("stop request turns HV off then settles to off", () => {
    const running: Espire290SequencerState = { ...initialEspire290SequencerState(2), mode: "running" };
    let r = evaluateEspire290CmsSequencer(input(healthy({ cmsHvOnStatus: 0b11 }), false), running, opts(0));
    expect(r.commands).toEqual([{ kind: "hv-off" }]);
    r = evaluateEspire290CmsSequencer(input(healthy({ cmsHvOnStatus: 0b11 }), false), r.state, opts(100));
    expect(r.commands).toEqual([]);
    r = evaluateEspire290CmsSequencer(input(healthy(), false), r.state, opts(200));
    expect(r.state.mode).toBe("off");
  });

  test("HV on/off are always written as a register pair", () => {
    expect(espire290CommandsToWriterEnvelopes([{ kind: "hv-on" }])).toEqual([
      { topic: "CMS", payload: [{ tagID: "SetCmsHvOn", value: 1 }, { tagID: "SetCmsHvOff", value: 0 }] },
    ]);
    expect(espire290CommandsToWriterEnvelopes([{ kind: "cluster-hv-off", cluster: 3 }])[0].payload).toEqual([
      { tagID: "Bms3HvOn", value: 0 },
      { tagID: "Bms3HvOff", value: 1 },
    ]);
  });
});
