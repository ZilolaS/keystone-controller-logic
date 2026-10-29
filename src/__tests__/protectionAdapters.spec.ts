import {
  normalizeSel751Protection,
  normalizeSelHoldingRegisterProtection,
} from "../coreControl";

describe("protection adapters from Node-RED flow behavior", () => {
  test("normalizes SEL holding-register bits from the legacy flow parser", () => {
    const normalized = normalizeSelHoldingRegisterProtection({
      row46: 0b10000000,
      row48: 0b11000000,
      row33: 0b00000011,
    });

    expect(normalized).toEqual({
      protectionState: "islanded",
      pcsRunAllowed: true,
      remoteInterlockClosed: true,
      outageDetected: true,
      raw: {
        sel_outage: 1,
        sel_remote_interlock: 1,
        sel_ktran_command: 1,
        sel_kgrid_status: 1,
        sel_ktran_status: 1,
      },
    });
  });

  test("normalizes SEL751 relay words from IN401/IN402/SV01T/SV07T", () => {
    expect(
      normalizeSel751Protection({
        row19: 0b11000000,
        row44: 0b10000000,
        rb1: true,
      })
    ).toEqual({
      protectionState: "normal",
      pcsRunAllowed: true,
      remoteInterlockClosed: true,
      outageDetected: false,
      gridPresent: true,
      breakerClosed52A: true,
      breakerOpen52B: true,
      breakerFeedbackMismatch: false,
      raw: {
        sel_grid_present: 1,
        sel_outage: 0,
        sel_52a_closed: 1,
        sel_52b_open: 1,
        sel_feedback_mismatch: 0,
        sel_rb1: 1,
      },
    });

    expect(normalizeSel751Protection({ row19: 0, row44: 0b00000010 })).toEqual({
      protectionState: "islanded",
      pcsRunAllowed: false,
      remoteInterlockClosed: false,
      outageDetected: true,
      gridPresent: false,
      breakerClosed52A: false,
      breakerOpen52B: false,
      breakerFeedbackMismatch: true,
      raw: {
        sel_grid_present: 0,
        sel_outage: 1,
        sel_52a_closed: 0,
        sel_52b_open: 0,
        sel_feedback_mismatch: 1,
        sel_rb1: 0,
      },
    });
  });
});
