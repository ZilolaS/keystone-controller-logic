import * as reader from "../reader/reader";
import type { ReadPlan, ReaderEnv } from "../types";

const env = {
  MAX_IN_FLIGHT: 1,
  REQUEST_TIMEOUT_MS: 800,
  JITTER_MS: 0,
  MODBUS_ZERO_BASED: false,
} as ReaderEnv;

function plan(startup = false): ReadPlan {
  return {
    equipmentId: "fairness-test",
    serverKey: "PCS",
    unitId: 1,
    blocks: [0, 1, 2].map((index) => ({
      function: "HRUS",
      fc: 3,
      start: 32 + index * 100,
      quantity: 1,
      pollMs: 1000,
      startupOnly: startup,
      map: [{ tagID: `status${index}`, offset: 0, length: 1, parser: "U16" }],
    })),
  } as ReadPlan;
}

afterEach(() => {
  reader.stop("fairness-test");
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("busy reader eventually polls every block without exceeding concurrency", () => {
  jest.useFakeTimers();
  const p = plan();
  const seen: number[] = [];
  let inflight = 0;
  let maxInflight = 0;
  reader.start(p, env, (request) => {
    if (!request) return;
    seen.push(request._reader.blockIdx);
    maxInflight = Math.max(maxInflight, ++inflight);
    setTimeout(() => {
      inflight--;
      reader.onReply({ _reader: request._reader, payload: [16] }, p, env);
    }, 700);
  });
  jest.advanceTimersByTime(6000);
  for (const index of [0, 1, 2]) {
    expect(seen.filter((value) => value === index).length).toBeGreaterThanOrEqual(2);
  }
  expect(maxInflight).toBe(1);
  expect(seen.length).toBeLessThanOrEqual(9);
});

test("startup polls wait for capacity instead of being dropped", () => {
  jest.useFakeTimers();
  const p = plan(true);
  const seen: number[] = [];
  reader.start(p, env, (request) => {
    if (!request) return;
    seen.push(request._reader.blockIdx);
    setTimeout(() => reader.onReply({ _reader: request._reader, payload: [16] }, p, env), 100);
  });
  jest.advanceTimersByTime(5000);
  expect(seen).toEqual([0, 1, 2]);
});

test("timeouts release capacity for queued blocks and stop prevents queued sends", () => {
  jest.useFakeTimers();
  const p = plan();
  const seen: number[] = [];
  reader.start(p, env, (request) => {
    if (request) seen.push(request._reader.blockIdx);
  });
  jest.advanceTimersByTime(1700);
  expect(seen).toEqual([0, 1, 2]);
  reader.stop(p.equipmentId);
  jest.advanceTimersByTime(5000);
  expect(seen).toEqual([0, 1, 2]);
});
