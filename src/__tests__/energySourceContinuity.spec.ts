import { buildSs40kFixedPayloads, buildSs40kLookup, type Ss40kEnergyAccumulatorState,
  type Ss40kTelemetryStore } from '../telemetry/ss40k';

const start = Date.parse('2026-10-21T00:00:00Z');
const { lookup } = buildSs40kLookup({ Battery: 'AMPACE_Mini_ss40k' });
function telemetry(at: number, overrides: Record<string, unknown> = {}): Ss40kTelemetryStore {
  return { Battery: [
    { tagID: 'Battery.BamsTotalInEng', value: 39340.2, timestamp: at, pollIntervalMs: 300000, ...overrides },
    { tagID: 'Battery.BamsTotalOutEng', value: 37933, timestamp: at, pollIntervalMs: 300000, ...overrides },
    { tagID: 'Battery.BamsPower', value: 4, timestamp: start + 700000, pollIntervalMs: 250 },
  ] };
}
function run(store: Ss40kTelemetryStore, now: number, state: Ss40kEnergyAccumulatorState = {}) {
  const messages = buildSs40kFixedPayloads({ lookup, telemetry: store, topic: 'offline',
    fixedSerialNumber: 'TEST-PCS', merge40kByModelIndex: true, nowMs: now, maxSampleAgeMs: 15000,
    energyAccumulator: { state, nowMs: now, outputMultiplier: 1000, dailyEnabled: false,
      sourceTagIDs: { batteryPowerKw: 'Battery.BamsPower' } } });
  return messages.find(m => m.ss40k.model === '40102')!.payload['0'].fixed;
}

test('slow hardware totals do not switch to unrelated software counters after 15 seconds', () => {
  const state = { counters: { eBatChgTot: 0.03, eBatDischgTot: 1.5 } };
  for (const age of [0, 15001, 120000, 299999, 600000]) {
    const fixed = run(telemetry(start), start + age, state);
    expect(fixed.eBatChgTot).toBe(39340200);
    expect(fixed.eBatDischgTot).toBe(37933000);
  }
});

test('declared hardware counters are omitted during cold start, outage, and expiry', () => {
  const state = { counters: { eBatChgTot: 0.03, eBatDischgTot: 1.5 } };
  for (const store of [{}, telemetry(start), { Battery: [telemetry(start).Battery![2]] }]) {
    const fixed = run(store, start + 700000, state);
    expect(fixed).not.toHaveProperty('eBatChgTot');
    expect(fixed).not.toHaveProperty('eBatDischgTot');
    expect(state.counters).toMatchObject({ eBatChgTot: 0.03, eBatDischgTot: 1.5 });
  }
});

test('returning hardware totals retain the lifetime baseline without a synthetic reset', () => {
  const state = {};
  const first = run(telemetry(start), start, state);
  const gap = run(telemetry(start), start + 700000, state);
  const recovered = telemetry(start + 700000);
  recovered.Battery![1].value = 37933.8;
  const last = run(recovered, start + 700000, state);
  expect(gap).not.toHaveProperty('eBatDischgTot');
  expect(Number(last.eBatDischgTot) - Number(first.eBatDischgTot)).toBe(800);
});

test.each([{ stale: true }, { quality: 'bad' }, { quality: 'uncertain' },
  { timestamp: start + 1 }, { timestamp: 'invalid' }, { value: null }, { value: '' },
  { value: false }, { value: NaN }])('invalid hardware samples are not reported or replaced: %j', invalid => {
  const fixed = run(telemetry(start, invalid), start);
  expect(fixed).not.toHaveProperty('eBatChgTot');
  expect(fixed).not.toHaveProperty('eBatDischgTot');
});

test('slow energy freshness does not extend fast battery-power freshness', () => {
  const store = telemetry(start);
  store.Battery![2].timestamp = start;
  const messages = buildSs40kFixedPayloads({ lookup, telemetry: store, topic: 'offline',
    nowMs: start + 20000, maxSampleAgeMs: 15000 });
  const monitor = messages.find(m => m.ss40k.model === '40101');
  expect(monitor?.payload['0'].fixed || {}).not.toHaveProperty('pBatDischg');
  expect(messages.find(m => m.ss40k.model === '40102')?.payload['0'].fixed.eBatChgTot).toBe(39340200);
});

test('sites without hardware totals still integrate power normally', () => {
  const state = {};
  const runIntegrated = (nowMs: number) => buildSs40kFixedPayloads({ lookup: {}, topic: 'offline',
    telemetry: { Battery: [{ tagID: 'Battery.Power', value: 6, timestamp: nowMs }] },
    energyAccumulator: { state, nowMs, outputMultiplier: 1000, dailyEnabled: false,
      sourceTagIDs: { batteryPowerKw: 'Battery.Power' } } });
  runIntegrated(start);
  const next = runIntegrated(start + 60000);
  expect(next.find(m => m.ss40k.model === '40102')?.payload['0'].fixed.eBatDischgTot).toBe(100);
});

test('an explicit energy mapping remains authoritative when its source is unavailable', () => {
  const messages = buildSs40kFixedPayloads({ lookup: {}, topic: 'offline', telemetry: {},
    signalMapping: { ss40k: { eBatChgTot: { expr: 'Meter.ChargeKwh * 1000' } } },
    energyAccumulator: { state: { counters: { eBatChgTot: 5 } }, dailyEnabled: false, outputMultiplier: 1000 } });
  expect(messages.find(m => m.ss40k.model === '40102')?.payload['0'].fixed).not.toHaveProperty('eBatChgTot');
});

test.each(['eGridImpTot', 'eGridExpTot', 'eLoadTot', 'eAcCplTot', 'eGenTot'])(
  'a configured %s counter is not replaced by a software total when absent', point => {
    const messages = buildSs40kFixedPayloads({ lookup: {}, topic: 'offline', telemetry: {},
      signalMapping: { ss40k: { [point]: { expr: 'Meter.Energy * 1000' } } },
      energyAccumulator: { state: { counters: { [point]: 100 } }, dailyEnabled: false, outputMultiplier: 1000 } });
    expect(messages.find(m => m.ss40k.model === '40102')?.payload['0'].fixed).not.toHaveProperty(point);
  });

test('declared charge source does not prevent independent discharge-power integration', () => {
  const state = { counters: { eBatChgTot: 7, eBatDischgTot: 2 }, lastMs: start };
  const messages = buildSs40kFixedPayloads({ lookup: {}, topic: 'offline',
    telemetry: { Battery: [{ tagID: 'Battery.Power', value: 6 }] },
    signalMapping: { ss40k: { eBatChgTot: { expr: 'Meter.ChargeKwh * 1000' } } },
    energyAccumulator: { state, nowMs: start + 60000, dailyEnabled: false, outputMultiplier: 1000,
      sourceTagIDs: { batteryPowerKw: 'Battery.Power' } } });
  const fixed = messages.find(m => m.ss40k.model === '40102')!.payload['0'].fixed;
  expect(fixed).not.toHaveProperty('eBatChgTot');
  expect(fixed.eBatDischgTot).toBe(2100);
  expect(state.counters.eBatChgTot).toBe(7);
});

