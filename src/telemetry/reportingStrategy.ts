import type { Ss40kPayloadMessage } from "./ss40k";

export type Ss40kReportingReason =
  | "initial"
  | "periodic"
  | "changed"
  | "fault-changed"
  | "on-demand";

export interface Ss40kReportingModelState {
  lastReportedAtMs?: number;
  lastFingerprint?: string;
}

export type Ss40kReportingState = Record<string, Ss40kReportingModelState>;

export interface Ss40kReportingDecision {
  key: string;
  model: string;
  equipment: string;
  report: boolean;
  reason?: Ss40kReportingReason;
}

export interface Ss40kReportingOptions {
  messages: Ss40kPayloadMessage[];
  state?: Ss40kReportingState;
  nowMs?: number;
  periodicMs?: number;
  forceReport?: boolean;
  forceModels?: string[];
}

export interface Ss40kReportingResult {
  messages: Ss40kPayloadMessage[];
  state: Ss40kReportingState;
  decisions: Ss40kReportingDecision[];
}

const DEFAULT_PERIODIC_MS = 5 * 60 * 1000;

const INFO_MODELS = new Set(["40100", "41100", "42100", "43100"]);
const MONITORING_MODELS = new Set(["40101", "40102", "40201", "42101"]);
const FAULT_MODELS = new Set(["40103", "41103", "42103", "50103", "52103"]);
const CONFIG_MODELS = new Set(["40104", "40204", "41104", "42104"]);
const PERIODIC_CONFIG_MODELS = new Set(["40104"]);

export function filterSs40kPayloadsForReporting(
  options: Ss40kReportingOptions
): Ss40kReportingResult {
  const nowMs = Number.isFinite(options.nowMs)
    ? Number(options.nowMs)
    : Date.now();
  const periodicMs = Number.isFinite(options.periodicMs)
    ? Math.max(1, Number(options.periodicMs))
    : DEFAULT_PERIODIC_MS;
  const forceModels = new Set((options.forceModels || []).map(String));
  const state: Ss40kReportingState = cloneState(options.state);
  const out: Ss40kPayloadMessage[] = [];
  const decisions: Ss40kReportingDecision[] = [];

  for (const message of options.messages || []) {
    const key = reportingKey(message);
    const model = String(message?.ss40k?.model || "");
    const equipment = String(message?.ss40k?.equipment || "");
    const fingerprint = payloadFingerprint(message);
    const previous = state[key] || {};
    const reason = reportingReason({
      model,
      fingerprint,
      previous,
      nowMs,
      periodicMs,
      force: !!options.forceReport || forceModels.has(model) || forceModels.has(key),
    });

    decisions.push({
      key,
      model,
      equipment,
      report: !!reason,
      reason,
    });

    if (!reason) continue;
    out.push(message);
    state[key] = {
      lastReportedAtMs: nowMs,
      lastFingerprint: fingerprint,
    };
  }

  return { messages: out, state, decisions };
}

function reportingReason(args: {
  model: string;
  fingerprint: string;
  previous: Ss40kReportingModelState;
  nowMs: number;
  periodicMs: number;
  force: boolean;
}): Ss40kReportingReason | undefined {
  if (args.force) return "on-demand";
  if (args.previous.lastReportedAtMs === undefined) return "initial";

  const changed =
    !!args.previous.lastFingerprint &&
    args.previous.lastFingerprint !== args.fingerprint;

  if (FAULT_MODELS.has(args.model) && changed) return "fault-changed";
  if (FAULT_MODELS.has(args.model)) return undefined;
  if ((INFO_MODELS.has(args.model) || CONFIG_MODELS.has(args.model)) && changed) {
    return "changed";
  }

  const elapsedMs = args.nowMs - Number(args.previous.lastReportedAtMs);
  if (CONFIG_MODELS.has(args.model) && !PERIODIC_CONFIG_MODELS.has(args.model)) {
    return undefined;
  }
  if (elapsedMs >= args.periodicMs) return "periodic";

  return undefined;
}

function reportingKey(message: Ss40kPayloadMessage): string {
  const meta = message.ss40k;
  return [
    meta?.equipment || "",
    meta?.model || "",
    meta?.modelIndex || "",
  ].join("::");
}

function payloadFingerprint(message: Ss40kPayloadMessage): string {
  const fixed = Object.values(message.payload || {})[0]?.fixed || {};
  return stableStringify(fixed);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

function cloneState(state?: Ss40kReportingState): Ss40kReportingState {
  const out: Ss40kReportingState = {};
  for (const [key, value] of Object.entries(state || {})) {
    out[key] = { ...value };
  }
  return out;
}
