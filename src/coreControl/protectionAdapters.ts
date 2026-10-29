import type { ProtectionState } from ".";

export interface NormalizedProtectionTelemetry {
  protectionState: ProtectionState;
  pcsRunAllowed?: boolean;
  remoteInterlockClosed?: boolean;
  outageDetected: boolean;
  gridPresent?: boolean;
  breakerClosed52A?: boolean;
  breakerOpen52B?: boolean;
  breakerFeedbackMismatch?: boolean;
  raw: Record<string, number>;
}

export interface SelHoldingRegisterProtectionInput {
  row46: number;
  row48: number;
  row33: number;
}

export interface Sel751ProtectionInput {
  row19: number;
  row44: number;
  rb1?: number | boolean;
}

export function normalizeSelHoldingRegisterProtection(
  input: SelHoldingRegisterProtectionInput
): NormalizedProtectionTelemetry {
  const selOutage = bit(input.row46, 7);
  const selRemoteInterlock = bit(input.row48, 7);
  const selKtranCommand = bit(input.row48, 6);
  const selKgridStatus = bit(input.row33, 0);
  const selKtranStatus = bit(input.row33, 1);

  return {
    protectionState: selOutage ? "islanded" : "normal",
    pcsRunAllowed: true,
    remoteInterlockClosed: selRemoteInterlock === 1,
    outageDetected: selOutage === 1,
    raw: {
      sel_outage: selOutage,
      sel_remote_interlock: selRemoteInterlock,
      sel_ktran_command: selKtranCommand,
      sel_kgrid_status: selKgridStatus,
      sel_ktran_status: selKtranStatus,
    },
  };
}

export function normalizeSel751Protection(
  input: Sel751ProtectionInput
): NormalizedProtectionTelemetry {
  const in40152A = bit(input.row19, 7);
  const in40252B = bit(input.row19, 6);
  const sv01tGridPresent = bit(input.row44, 7);
  const sv07tFeedbackMismatch = bit(input.row44, 1);
  const rb1Closed = boolBit(input.rb1);
  const outage = sv01tGridPresent === 0;

  return {
    protectionState: outage ? "islanded" : "normal",
    pcsRunAllowed: sv07tFeedbackMismatch === 0,
    remoteInterlockClosed: rb1Closed,
    outageDetected: outage,
    gridPresent: sv01tGridPresent === 1,
    breakerClosed52A: in40152A === 1,
    breakerOpen52B: in40252B === 1,
    breakerFeedbackMismatch: sv07tFeedbackMismatch === 1,
    raw: {
      sel_grid_present: sv01tGridPresent,
      sel_outage: outage ? 1 : 0,
      sel_52a_closed: in40152A,
      sel_52b_open: in40252B,
      sel_feedback_mismatch: sv07tFeedbackMismatch,
      sel_rb1: rb1Closed ? 1 : 0,
    },
  };
}

function boolBit(value: number | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return false;
}

function bit(value: number, position: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return (numeric >> position) & 0x01;
}
