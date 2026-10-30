import { readFileSync } from 'fs';
import path from 'path';
import { matchActiveSchedulePlan } from '../scheduler';

const nodes = JSON.parse(readFileSync(path.resolve(__dirname, '../../flows/unified_platform_runtime_flow.json'), 'utf8'));
const execute = new Function('msg', 'global', 'flow', 'node', 'env', nodes.find((n: any) => n.id === 'platform_sched_api_esr_handler').func);
const payload = { command: 'peakShaving', port: 'utilityGrid', chargeThresholdKw: 0, dischargeThresholdKw: 20, minSocPct: 20, maxSocPct: 95 };

function fixture() {
  const values: Record<string, any> = { siteConfig: { system: { controllerTimezone: 'America/Los_Angeles' } } };
  const context = { get: (key: string) => values[key], set: (key: string, value: any) => { values[key] = value; } };
  const call = (method: string, data: any = {}) => execute({ payload: { endPoint: 'EdgeScheduler', method, version: '2.0', requestId: 1, data } }, context, context, { error: jest.fn() }, { get: () => '' }).payload;
  const selected = () => matchActiveSchedulePlan(values.schedulePlans, { now: new Date(), timezone: 'America/Los_Angeles' });
  return { values, call, selected };
}

function fallback(jobId = 1) {
  return { protocolVer: 1, flags: 0, default: true, jobId, jobName: 'Custom fallback name', priority: 255,
    owner: 'LocalSchedule', execType: 'Cron', startTs: 0, expireTs: 0, cronExpr: '0 0 0 * * ? *', durationSec: 86400,
    timezone: 'America/Los_Angeles', payload };
}

describe('explicit local default through the unified API', () => {
  afterEach(() => jest.useRealTimers());

  test.each(['2026-09-10T19:00:00Z', '2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z', '2027-03-14T10:30:00Z'])('fallback is independent of clock windows at %s', (time) => {
    jest.useFakeTimers().setSystemTime(new Date(time));
    const f = fixture();
    expect(f.call('CreateJob', fallback()).data.result).toBe(0);
    expect(f.call('GetJob', { jobId: 1 }).data.desc).toMatchObject({ default: true, flags: 0 });
    expect(f.call('GetJob', { jobId: 1 }).data.runtime.state).toBe('Running');
    expect(f.selected()).toMatchObject({ via: 'default', plan: { default: true, jobId: 1 } });
  });

  test.each(['LocalSchedule', 'Vpp'])('eligible %s overrides even a high-priority fallback, then fallback resumes', (owner) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-10T19:00:00Z'));
    const f = fixture();
    f.call('CreateJob', fallback());
    const startTs = Date.now() / 1000 + 60;
    const timed = { ...fallback(2), default: false, priority: 0, owner, execType: 'Once', startTs, durationSec: 120, cronExpr: undefined };
    expect(f.call('CreateJob', timed).data.result).toBe(0);
    expect(f.selected()?.plan.jobId).toBe(1);
    jest.setSystemTime(new Date(startTs * 1000));
    expect(f.selected()?.plan.jobId).toBe(2);
    expect(f.call('GetJob', { jobId: 1 }).data.runtime.state).toBe('Preempted');
    jest.setSystemTime(new Date((startTs + 120) * 1000));
    expect(f.selected()?.plan.jobId).toBe(1);
  });

  test('stopping the fallback removes it from control and starting restores it', () => {
    const f = fixture();
    f.call('CreateJob', fallback());
    f.call('StopJob', { jobId: 1 });
    expect(f.selected()).toBeNull();
    expect(f.call('GetJob', { jobId: 1 }).data.runtime.state).toBe('Stopped');
    f.call('StartJob', { jobId: 1 });
    expect(f.selected()?.plan.jobId).toBe(1);
  });

  test('validates replacement before atomically replacing only the explicit default', () => {
    const f = fixture();
    f.call('CreateJob', fallback());
    f.call('CreateJob', { ...fallback(2), default: false });
    expect(f.call('CreateJob', { ...fallback(3), owner: 'Vpp' }).data.result).not.toBe(0);
    expect(Object.keys(f.values.edgeSchedulerJobs)).toEqual(['1', '2']);
    expect(f.call('CreateJob', fallback(3)).data.result).toBe(0);
    expect(Object.keys(f.values.edgeSchedulerJobs)).toEqual(['2', '3']);
    const plans = f.values.schedulePlans.flatMap((g: any) => g.timed);
    expect(plans.filter((p: any) => p.default)).toHaveLength(1);
    expect(plans.some((p: any) => p.jobId === 2)).toBe(true);
  });

  test.each([{ default: 'true' }, { flags: 1 }, { durationSec: 60 }, { expireTs: 2000000000 }])('rejects malformed fallback %j without mutation', (invalid) => {
    const f = fixture();
    expect(f.call('CreateJob', { ...fallback(), ...invalid }).data.result).not.toBe(0);
    expect(f.values.edgeSchedulerJobs).toBeUndefined();
  });
});
