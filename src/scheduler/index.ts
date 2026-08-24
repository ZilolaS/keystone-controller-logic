// src/scheduler/index.ts

import { SiteConfig } from "../config";

export type ScheduleStrategy = Record<string, unknown>;
export type ScheduleConstraints = Record<string, unknown>;
export type ScheduleCommandPayload = Record<string, unknown>;

export interface ScheduleDuration {
  unit?: "minute" | "minutes" | "hour" | "hours" | "day" | "days" | string;
  value?: number | string;
}

export interface SchedulePlan {
  planID?: string;
  jobId?: string | number;
  name?: string;
  description?: string;
  version?: string;
  owner?: string;
  priority?: number | string;
  flags?: number | string;
  execType?: string;
  timezone?: string;
  cron?: string;
  default?: boolean | string;
  duration?: ScheduleDuration | number | string;
  start?: string;
  until?: string;
  time?: {
    start?: string;
    end?: string;
  };
  strategy?: ScheduleStrategy;
  constraints?: ScheduleConstraints;
  payload?: ScheduleCommandPayload | string;
  payloadJson?: string;
  activePowerKwSetpoint?: number;
  reactivePowerKvarSetpoint?: number;
  setpoint?: {
    activePowerKw?: number;
    reactivePowerKvar?: number;
  };
}

export interface SchedulePlanGroup {
  timed?: SchedulePlan[];
  plans?: SchedulePlan[];
  [key: string]: unknown;
}

export type SchedulePlanInput =
  | SchedulePlan[]
  | SchedulePlanGroup[]
  | {
      plans?: SchedulePlan[] | SchedulePlanGroup[];
      timed?: SchedulePlan[];
      default?: SchedulePlan;
      schedule?: SchedulePlanInput;
      data?: {
        plans?: SchedulePlan[] | SchedulePlanGroup[];
        timed?: SchedulePlan[];
        default?: SchedulePlan;
        schedule?: SchedulePlanInput;
      };
    }
  | undefined
  | null;

export interface ActiveSchedulePlan {
  plan: SchedulePlan;
  start: Date | null;
  end: Date;
  nowLocal: Date;
  isFallback?: boolean;
  via?: "timed" | "default" | "upstream";
  source: "local" | "upstream";
  selectedReason?: string;
  nextTimedStart?: Date | null;
}

export interface ScheduleSelection {
  planID?: string;
  name?: string;
  owner?: string;
  priority?: number | string;
  reason?: string;
  via?: ActiveSchedulePlan["via"];
  isFallback?: boolean;
  nextTimedStart?: Date | null;
}

export interface ScheduleOutput {
  activePowerKwSetpoint?: number;
  reactivePowerKvarSetpoint?: number;
  activePlan?: ActiveSchedulePlan;
  selectedPlan?: ScheduleSelection;
  strategy?: ScheduleStrategy;
  constraints?: ScheduleConstraints;
  payload?: ScheduleCommandPayload;
  payloadJson?: string;
}

export interface ScheduleMatchOptions {
  now?: Date | string | number;
  timezone?: string;
  upstreamActivePlan?: ActiveSchedulePlan | SchedulePlan | null;
}

export interface SchedulerOptions extends ScheduleMatchOptions {
  plans?: SchedulePlanInput;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

interface CronFields {
  second: string;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  year?: string;
}

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export function initScheduler(config: SiteConfig, options: SchedulerOptions = {}) {
  const timezone = normalizeTimezone(options.timezone ?? config.system.controllerTimezone);

  return {
    getSetpointForNow(input: SchedulerOptions = {}): ScheduleOutput {
      const activePlan = matchActiveSchedulePlan(input.plans ?? options.plans, {
        now: input.now ?? options.now,
        timezone: input.timezone ?? timezone,
        upstreamActivePlan: input.upstreamActivePlan ?? options.upstreamActivePlan,
      });

      return activePlan ? scheduleOutputFromActivePlan(activePlan) : {};
    },
  };
}

export function matchActiveSchedulePlan(
  plansRaw: SchedulePlanInput,
  options: ScheduleMatchOptions = {}
): ActiveSchedulePlan | null {
  const timezone = normalizeTimezone(options.timezone);
  const now = toDate(options.now);

  if (options.upstreamActivePlan) {
    return normalizeUpstreamActivePlan(options.upstreamActivePlan, now, timezone);
  }

  const plans = normalizePlans(plansRaw);
  if (plans.length === 0) return null;

  const nowParts = getLocalParts(now, timezone);
  const nowLocalMs = localMs(nowParts);
  const nowLocal = new Date(nowLocalMs);

  const candidates: ActiveSchedulePlan[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    if (isDefaultPlan(plan)) continue;
    const planTimezone = normalizeTimezone(plan.timezone ?? timezone);
    const planNowParts = planTimezone === timezone ? nowParts : getLocalParts(now, planTimezone);
    const planNowLocalMs = planTimezone === timezone ? nowLocalMs : localMs(planNowParts);
    const active = getAbsoluteTimeWindow(plan, now) ?? getActiveWindow(plan, planNowLocalMs);
    if (!active) continue;
    if (!withinPlanBounds(plan, planNowLocalMs)) continue;

    candidates.push({
      plan,
      start: new Date(active.startMs),
      end: new Date(active.endMs),
      nowLocal: new Date(planNowLocalMs),
      source: "local",
      via: "timed",
      selectedReason: "timed",
    });
  }

  if (candidates.length) {
    return candidates.sort(compareActivePlansByPrecedence)[0];
  }

  const fallback = findDefaultPlan(plans);
  if (!fallback) return null;

  return {
    plan: fallback,
    start: null,
    end: endOfLocalDay(nowParts),
    nowLocal,
    source: "local",
    via: "default",
    isFallback: true,
    selectedReason: "default",
    nextTimedStart: findNextTimedStart(plans, now, timezone),
  };
}

export function scheduleOutputFromActivePlan(activePlan: ActiveSchedulePlan): ScheduleOutput {
  const plan = activePlan.plan;
  const payload = normalizeCommandPayload(plan.payload ?? plan.payloadJson);
  const activePowerKwSetpoint = firstFiniteNumber(
    plan.activePowerKwSetpoint,
    plan.setpoint?.activePowerKw,
    readNestedNumber(plan.strategy, ["active_power_kw", "activePowerKw", "pcsSetpointKW"])
  );
  const reactivePowerKvarSetpoint = firstFiniteNumber(
    plan.reactivePowerKvarSetpoint,
    plan.setpoint?.reactivePowerKvar,
    readNestedNumber(plan.strategy, ["reactive_power_kvar", "reactivePowerKvar"])
  );

  return {
    ...(activePowerKwSetpoint !== undefined ? { activePowerKwSetpoint } : {}),
    ...(reactivePowerKvarSetpoint !== undefined ? { reactivePowerKvarSetpoint } : {}),
    activePlan,
    selectedPlan: {
      planID: plan.planID ?? String(plan.jobId ?? ""),
      name: plan.name,
      owner: plan.owner,
      priority: plan.priority,
      reason: activePlan.selectedReason,
      via: activePlan.via,
      isFallback: activePlan.isFallback,
      nextTimedStart: activePlan.nextTimedStart ?? null,
    },
    strategy: plan.strategy,
    constraints: plan.constraints,
    ...(payload ? { payload } : {}),
    ...(typeof plan.payloadJson === "string" ? { payloadJson: plan.payloadJson } : {}),
  };
}

function normalizeCommandPayload(value: unknown): ScheduleCommandPayload | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeCommandPayload(parsed);
    } catch {
      return undefined;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as ScheduleCommandPayload;
  }
  return undefined;
}

function normalizePlans(plansRaw: SchedulePlanInput): SchedulePlan[] {
  const raw =
    Array.isArray(plansRaw) ? plansRaw : plansRaw?.data?.plans ?? plansRaw?.plans ?? plansRaw?.schedule ?? plansRaw?.data?.schedule ?? [];
  const plans: SchedulePlan[] = [];
  const defaults = Array.isArray(plansRaw)
    ? []
    : [plansRaw?.default, plansRaw?.data?.default].filter(isSchedulePlan);
  plans.push(...defaults);
  if (!Array.isArray(plansRaw) && Array.isArray(plansRaw?.timed)) plans.push(...plansRaw.timed);
  if (!Array.isArray(plansRaw) && Array.isArray(plansRaw?.data?.timed)) plans.push(...plansRaw.data.timed);
  if (!Array.isArray(raw)) return plans;

  for (const item of raw) {
    if (isSchedulePlanGroup(item)) {
      const grouped = Array.isArray(item.timed) ? item.timed : item.plans;
      if (Array.isArray(grouped)) plans.push(...grouped);
    } else if (isSchedulePlan(item)) {
      plans.push(item);
    }
  }
  return plans;
}

function isSchedulePlan(value: unknown): value is SchedulePlan {
  return Boolean(value && typeof value === "object");
}

function isSchedulePlanGroup(value: unknown): value is SchedulePlanGroup {
  return Boolean(
    value &&
      typeof value === "object" &&
      (Array.isArray((value as SchedulePlanGroup).timed) || Array.isArray((value as SchedulePlanGroup).plans)) &&
      !("cron" in value)
  );
}

function normalizeUpstreamActivePlan(
  upstream: ActiveSchedulePlan | SchedulePlan,
  now: Date,
  timezone: string
): ActiveSchedulePlan {
  const maybeActivePlan = upstream as Partial<ActiveSchedulePlan>;
  if (maybeActivePlan.plan) {
    return { ...maybeActivePlan, source: "upstream", via: maybeActivePlan.via ?? "upstream" } as ActiveSchedulePlan;
  }

  const nowParts = getLocalParts(now, timezone);
  return {
    plan: upstream as SchedulePlan,
    start: null,
    end: endOfLocalDay(nowParts),
    nowLocal: new Date(localMs(nowParts)),
    source: "upstream",
    via: "upstream",
    selectedReason: "upstream",
  };
}

function getActiveWindow(
  plan: SchedulePlan,
  nowLocalMs: number
): { startMs: number; endMs: number } | null {
  const cron = parseCron(plan.cron);
  if (!cron) return null;

  const durationMinutes = getDurationMinutes(plan.duration);
  const durationMs = durationMinutes * 60_000;
  const startMs = findPreviousCronStart(cron, nowLocalMs, durationMs);
  if (startMs == null) return null;
  const endMs = startMs + durationMs;
  if (nowLocalMs >= startMs && nowLocalMs < endMs) return { startMs, endMs };

  return null;
}

function getAbsoluteTimeWindow(
  plan: SchedulePlan,
  now: Date
): { startMs: number; endMs: number } | null {
  const startMs = parseAbsoluteDateMs(plan.time?.start);
  const endMs = parseAbsoluteDateMs(plan.time?.end);
  if (startMs == null || endMs == null || endMs <= startMs) return null;

  const nowMs = now.getTime();
  if (nowMs >= startMs && nowMs < endMs) {
    return { startMs, endMs };
  }
  return null;
}

function parseCron(cron: string | undefined): CronFields | null {
  if (!cron) return null;
  const inputFields = cron.trim().split(/\s+/);
  const fields = inputFields.length === 5 ? ["0", ...inputFields] : inputFields;
  if (fields.length !== 6 && fields.length !== 7) return null;
  const parsed = {
    second: fields[0],
    minute: fields[1],
    hour: fields[2],
    dayOfMonth: fields[3],
    month: fields[4],
    dayOfWeek: fields[5],
    year: fields[6],
  };
  return isValidCron(parsed) ? parsed : null;
}

function isValidCron(cron: CronFields): boolean {
  return (
    tokenMatchesAny(cron.second, "second") &&
    tokenMatchesAny(cron.minute, "minute") &&
    tokenMatchesAny(cron.hour, "hour") &&
    tokenMatchesAny(cron.dayOfMonth, "dayOfMonth") &&
    tokenMatchesAny(cron.month, "month") &&
    tokenMatchesAny(cron.dayOfWeek, "dayOfWeek") &&
    (cron.year == null || tokenMatchesAny(cron.year, "year"))
  );
}

function cronMatchesDate(cron: CronFields, parts: LocalParts): boolean {
  return (
    tokenMatches(cron.second, parts.second, "second") &&
    tokenMatches(cron.minute, parts.minute, "minute") &&
    tokenMatches(cron.hour, parts.hour, "hour") &&
    tokenMatches(cron.dayOfMonth, parts.day, "dayOfMonth") &&
    tokenMatches(cron.month, parts.month, "month") &&
    tokenMatches(cron.dayOfWeek, parts.weekday, "dayOfWeek") &&
    (cron.year == null || tokenMatches(cron.year, parts.year, "year"))
  );
}

function tokenMatchesAny(
  field: string,
  kind: "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek" | "year"
): boolean {
  const values = expandCronField(field, kind);
  return values === null || values.size > 0;
}

function tokenMatches(
  field: string,
  value: number,
  kind: "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek" | "year"
): boolean {
  const values = expandCronField(field, kind);
  if (values === null) return true;
  if (values.size === 0) return false;
  return values.has(kind === "dayOfWeek" && value === 7 ? 0 : value);
}

function expandCronField(
  field: string,
  kind: "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek" | "year"
): Set<number> | null {
  const trimmed = String(field ?? "").trim();
  if (!trimmed || trimmed === "*") return null;
  if (trimmed === "?" && (kind === "dayOfMonth" || kind === "dayOfWeek")) return null;
  if (trimmed === "?") return new Set();

  const range = cronRange(kind);
  const values = new Set<number>();
  for (const rawToken of trimmed.split(",")) {
    const token = rawToken.trim();
    if (!token) return new Set();
    const [base, stepText] = token.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step <= 0) return new Set();

    let start: number;
    let end: number;
    if (base === "*" || base === "?") {
      if (base === "?" && kind !== "dayOfMonth" && kind !== "dayOfWeek") return new Set();
      start = range.min;
      end = range.max;
    } else if (base.includes("-")) {
      const [left, right] = base.split("-");
      const leftValue = parseNumberToken(left, kind);
      const rightValue = parseNumberToken(right, kind);
      if (leftValue == null || rightValue == null || leftValue > rightValue) return new Set();
      start = leftValue;
      end = rightValue;
    } else {
      const value = parseNumberToken(base, kind);
      if (value == null) return new Set();
      start = value;
      end = value;
    }

    for (let value = start; value <= end; value += step) {
      if (!valueInCronRange(value, kind)) return new Set();
      values.add(kind === "dayOfWeek" && value === 7 ? 0 : value);
    }
  }

  return values;
}

function parseNumberToken(
  token: string,
  kind: "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek" | "year"
): number | undefined {
  const normalized = token.trim().toUpperCase();
  if (normalized === "*" || normalized === "?") return undefined;
  if (kind === "month" && MONTH_NAMES[normalized] != null) return MONTH_NAMES[normalized];
  if (kind === "dayOfWeek" && WEEKDAY_NAMES[normalized] != null) return WEEKDAY_NAMES[normalized];
  const value = Number(normalized);
  if (!Number.isFinite(value)) return undefined;
  if (kind === "dayOfWeek" && value === 7) return 0;
  return value;
}

function cronRange(kind: "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek" | "year"): { min: number; max: number } {
  if (kind === "second" || kind === "minute") return { min: 0, max: 59 };
  if (kind === "hour") return { min: 0, max: 23 };
  if (kind === "dayOfMonth") return { min: 1, max: 31 };
  if (kind === "month") return { min: 1, max: 12 };
  if (kind === "dayOfWeek") return { min: 0, max: 7 };
  return { min: 1970, max: 2099 };
}

function valueInCronRange(
  value: number,
  kind: "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek" | "year"
): boolean {
  const range = cronRange(kind);
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

function cronSeconds(cron: CronFields): number[] {
  const expanded = expandCronField(cron.second, "second");
  return Array.from(expanded ?? new Set(Array.from({ length: 60 }, (_, index) => index))).sort((a, b) => a - b);
}

function findPreviousCronStart(cron: CronFields, nowLocalMs: number, lookbackMs: number): number | null {
  const seconds = cronSeconds(cron);
  const firstMinute = Math.floor((nowLocalMs - lookbackMs) / 60_000);
  const lastMinute = Math.floor(nowLocalMs / 60_000);
  let best: number | null = null;
  for (let minute = firstMinute; minute <= lastMinute; minute += 1) {
    const minuteMs = minute * 60_000;
    for (const second of seconds) {
      const candidateMs = minuteMs + second * 1000;
      if (candidateMs > nowLocalMs || candidateMs < nowLocalMs - lookbackMs) continue;
      if (cronMatchesDate(cron, partsFromLocalMs(candidateMs))) best = candidateMs;
    }
  }
  return best;
}

function findNextCronStart(cron: CronFields, nowLocalMs: number, horizonDays = 366): number | null {
  const seconds = cronSeconds(cron);
  const firstMinute = Math.floor(nowLocalMs / 60_000);
  const lastMinute = firstMinute + horizonDays * 24 * 60;
  for (let minute = firstMinute; minute <= lastMinute; minute += 1) {
    const minuteMs = minute * 60_000;
    for (const second of seconds) {
      const candidateMs = minuteMs + second * 1000;
      if (candidateMs <= nowLocalMs) continue;
      if (cronMatchesDate(cron, partsFromLocalMs(candidateMs))) return candidateMs;
    }
  }
  return null;
}

function getDurationMinutes(duration: SchedulePlan["duration"]): number {
  if (duration == null) return 24 * 60;
  if (typeof duration === "number" || typeof duration === "string") {
    const value = Number(duration);
    return Number.isFinite(value) && value > 0 ? value : 24 * 60;
  }

  const value = Number(duration.value);
  if (!Number.isFinite(value) || value <= 0) return 24 * 60;

  const unit = String(duration.unit ?? "minutes").toLowerCase();
  if (unit.startsWith("hour")) return value * 60;
  if (unit.startsWith("day")) return value * 24 * 60;
  return value;
}

function withinPlanBounds(plan: SchedulePlan, nowLocalMs: number): boolean {
  const startMs = parseLocalDateMs(plan.start);
  const untilMs = parseLocalDateMs(plan.until);
  if (startMs != null && nowLocalMs < startMs) return false;
  if (untilMs != null && nowLocalMs > untilMs) return false;
  return true;
}

function findDefaultPlan(plans: SchedulePlan[]): SchedulePlan | null {
  return plans.filter(isDefaultPlan).sort(comparePlansByPrecedence)[0] ?? null;
}

function findNextTimedStart(
  plans: SchedulePlan[],
  now: Date,
  timezone: string
): Date | null {
  let best: number | null = null;
  const nowMs = now.getTime();

  for (const plan of plans) {
    if (isDefaultPlan(plan)) continue;
    const startMs = parseAbsoluteDateMs(plan.time?.start);
    if (startMs == null || startMs <= nowMs) continue;
    if (best == null || startMs < best) best = startMs;
  }

  for (const plan of plans) {
    if (isDefaultPlan(plan) || !plan.cron) continue;
    const cron = parseCron(plan.cron);
    if (!cron) continue;
    const planTimezone = normalizeTimezone(plan.timezone ?? timezone);
    const nowLocalMs = localMs(getLocalParts(now, planTimezone));
    const startMs = findNextCronStart(cron, nowLocalMs);
    if (startMs == null || !withinPlanBounds(plan, startMs)) continue;
    if (best == null || startMs < best) best = startMs;
  }

  return best == null ? null : new Date(best);
}

function isDefaultPlan(plan: SchedulePlan): boolean {
  return (
    plan.default === true ||
    String(plan.default).toLowerCase() === "true" ||
    Number(plan.flags) === 1
  );
}

function compareActivePlansByPrecedence(
  left: ActiveSchedulePlan,
  right: ActiveSchedulePlan
): number {
  const priorityDelta = planPriority(right.plan) - planPriority(left.plan);
  if (priorityDelta !== 0) return priorityDelta;

  const leftStart = left.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightStart = right.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (leftStart !== rightStart) return leftStart - rightStart;

  return planOrder(right.plan) - planOrder(left.plan);
}

function comparePlansByPrecedence(left: SchedulePlan, right: SchedulePlan): number {
  const priorityDelta = planPriority(right) - planPriority(left);
  if (priorityDelta !== 0) return priorityDelta;

  return planOrder(right) - planOrder(left);
}

function planPriority(plan: SchedulePlan): number {
  const priority = Number(plan.priority);
  return Number.isFinite(priority) ? priority : 0;
}

function planOrder(plan: SchedulePlan): number {
  const id = Number(plan.jobId ?? plan.planID);
  return Number.isFinite(id) ? id : 0;
}

function normalizeTimezone(timezone: string | undefined): string {
  const candidate = timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return "UTC";
  }
}

function getLocalParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdayName = value("weekday").toUpperCase();

  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
    weekday: WEEKDAY_NAMES[weekdayName] ?? 0,
  };
}

function localMs(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function partsFromLocalMs(ms: number): LocalParts {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    weekday: date.getUTCDay(),
  };
}

function addLocalDays(parts: LocalParts, days: number): LocalParts {
  return partsFromLocalMs(
    Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second)
  );
}

function endOfLocalDay(parts: LocalParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0));
}

function parseLocalDateMs(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0)
  );
}

function parseAbsoluteDateMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date) return value;
  if (value != null) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date();
}

function firstFiniteNumber(...values: Array<unknown>): number | undefined {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function readNestedNumber(source: unknown, keys: string[]): number | undefined {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}
