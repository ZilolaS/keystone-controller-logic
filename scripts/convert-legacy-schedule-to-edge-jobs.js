#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node scripts/convert-legacy-schedule-to-edge-jobs.js ' +
      '--flow <flows.json> --output <output.json> --job-base <uint32> ' +
      '[--node-id <id>] [--timezone <IANA zone>] [--cutoff <ISO timestamp>]'
  );
  process.exit(2);
}

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !key.startsWith('--') || value === undefined) usage(`Invalid argument: ${key || ''}`);
    options[key.slice(2)] = value;
  }
  return options;
}

function numeric(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be numeric`);
  return result;
}

function percent(value, label) {
  const result = numeric(value, label);
  return result >= 0 && result <= 1 ? result * 100 : result;
}

function constraint(plan, key) {
  const entry = plan && plan.constraints && plan.constraints[key];
  if (!entry || entry.value === undefined) throw new Error(`Missing constraint ${key}`);
  return entry.value;
}

function threshold(plan, direction) {
  const entry = plan && plan.strategy && plan.strategy.meter_rule && plan.strategy.meter_rule[direction];
  if (!entry || !entry.net_load_threshold) throw new Error(`Missing ${direction} threshold`);
  return numeric(entry.net_load_threshold.value, `${direction} threshold`);
}

function localLabel(epochMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(epochMs));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function edgePayload(plan) {
  return {
    command: 'peakShaving',
    port: 'utilityGrid',
    dischargeThresholdKw: threshold(plan, 'discharge'),
    chargeThresholdKw: threshold(plan, 'charge'),
    minSocPct: percent(constraint(plan, 'min_soc'), 'min_soc'),
    maxSocPct: percent(constraint(plan, 'max_soc'), 'max_soc'),
    maxChargePowerPct: percent(constraint(plan, 'max_charge_power'), 'max_charge_power'),
    maxDischargePowerPct: percent(constraint(plan, 'max_discharge_power'), 'max_discharge_power'),
    deadbandKw: 0.5,
    holdAtThreshold: true
  };
}

function convertPlan(plan, index, options) {
  const startMs = Date.parse(plan.time && plan.time.start);
  const endMs = Date.parse(plan.time && plan.time.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error(`Invalid time range for legacy plan ${plan.planID || index}`);
  }
  const jobId = options.jobBase + index;
  if (jobId > 0xffffffff) throw new Error(`Generated jobId ${jobId} exceeds uint32`);
  const payload = edgePayload(plan);
  const jobName = `Levtex ${localLabel(startMs, options.timezone)}`;
  const job = {
    protocolVer: 1,
    flags: 0,
    jobId,
    jobName,
    priority: 50,
    owner: 'LocalSchedule',
    execType: 'Once',
    timezone: options.timezone,
    startTs: Math.floor(startMs / 1000),
    expireTs: 0,
    durationSec: Math.floor((endMs - startMs) / 1000),
    payload,
    payloadJson: JSON.stringify(payload),
    state: 'Pending'
  };
  const schedulePlan = {
    planID: String(jobId),
    jobId,
    name: jobName,
    version: '3.0',
    owner: job.owner,
    priority: job.priority,
    execType: job.execType,
    timezone: job.timezone,
    time: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString()
    },
    duration: { unit: 'minutes', value: job.durationSec / 60 },
    payload,
    strategy: {
      meter_rule: {
        discharge: { net_load_threshold: { value: payload.dischargeThresholdKw, unit: 'kW' } },
        charge: { net_load_threshold: { value: payload.chargeThresholdKw, unit: 'kW' } }
      },
      pv_rule: { name: (plan.strategy && plan.strategy.pv_rule && plan.strategy.pv_rule.name) || 'GridSupplement' }
    },
    constraints: {
      min_soc: { value: payload.minSocPct, unit: '%' },
      max_soc: { value: payload.maxSocPct, unit: '%' },
      max_charge_power: { value: payload.maxChargePowerPct, unit: '%' },
      max_discharge_power: { value: payload.maxDischargePowerPct, unit: '%' }
    }
  };
  return { job, schedulePlan, startMs, endMs };
}

const args = argumentsFrom(process.argv.slice(2));
if (!args.flow || !args.output || !args['job-base']) usage('Missing required arguments');

const timezone = args.timezone || 'America/Los_Angeles';
new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
const jobBase = Number(args['job-base']);
if (!Number.isInteger(jobBase) || jobBase < 0 || jobBase > 0xffffffff) usage('--job-base must be a uint32');
const cutoffMs = args.cutoff ? Date.parse(args.cutoff) : Date.now();
if (!Number.isFinite(cutoffMs)) usage('--cutoff must be an ISO timestamp');

const flow = JSON.parse(fs.readFileSync(args.flow, 'utf8'));
const candidates = flow.filter((node) =>
  args['node-id'] ? node.id === args['node-id'] : node.name === 'Inject Schedule'
);
if (candidates.length !== 1) {
  throw new Error(`Expected one Inject Schedule node, found ${candidates.length}; pass --node-id`);
}
const rule = candidates[0].rules && candidates[0].rules.find((item) => item.t === 'set');
if (!rule || typeof rule.to !== 'string') throw new Error('Inject Schedule node does not contain JSON schedule data');
const legacy = JSON.parse(rule.to);
if (!Array.isArray(legacy.timed)) throw new Error('Legacy schedule timed list is missing');

const converted = legacy.timed
  .map((plan, index) => convertPlan(plan, index, { timezone, jobBase }))
  .filter((entry) => entry.endMs > cutoffMs)
  .sort((left, right) => left.startMs - right.startMs);

const jobs = {};
for (const entry of converted) jobs[String(entry.job.jobId)] = entry.job;
const firstStart = converted.length ? new Date(converted[0].startMs).toISOString() : null;
const lastEnd = converted.length ? new Date(converted[converted.length - 1].endMs).toISOString() : null;
const output = {
  conversion: {
    sourceNodeId: candidates[0].id,
    sourceNodeName: candidates[0].name,
    timezone,
    cutoff: new Date(cutoffMs).toISOString(),
    legacyTimedCount: legacy.timed.length,
    convertedTimedCount: converted.length,
    firstStart,
    lastEnd,
    legacyDefaultOmitted: true
  },
  edgeSchedulerJobs: jobs,
  schedulePlans: [
    {
      version: '3.0',
      source: 'converted-from-levtex-legacy-inject-schedule',
      timezone,
      timed: converted.map((entry) => entry.schedulePlan)
    }
  ]
};

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output.conversion, null, 2));
