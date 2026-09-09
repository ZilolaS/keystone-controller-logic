# Mini BCU power and grid status

## BCU power

42101.W is exported in watts. The BCU template calculates engineering volts
times engineering amps; its export multiplier is 1. The shared missing-power
fallback likewise uses volts times amps without an extra factor of 10.
This change leaves the existing positive-charge / negative-discharge convention
unchanged and does not alter energy counters or controller power commands.

Read-only comparisons on 2026-09-09 found the same old multiplier on Levtex
(10.253.0.80), .24, and Masonic Temple (.104). For example, Masonic BCU 1
reported 470.4 V, -3.6 A, and -16934 W instead of approximately -1693 W.
The .64 reporting path did not include BCU W, so it did not exhibit the same
displayed-power discrepancy. Small instantaneous BMS/BCU differences must also
account for different sample times and parent-versus-individual measurements.

## Grid status

The shared Mini PCS template derives 40101.gridStat from holding register 32:

- Fault bit 0 or failed bit 9: 1 (Disconnected), overriding operating mode.
- Grid-tied bit 4 alone: 0 (Normal).
- Off-grid bit 5 alone: 2 (Outage).
- Stopped, standby, or contradictory mode bits: 1 (Disconnected).

This is the requested operating-state convention for FMP. Off-grid being
labeled Outage does not independently establish physical loss of utility.
Unknown/stale input is not synthesized as Normal. Existing calculated-input
and export freshness checks apply. This point is telemetry only, not a new
control or protection input.

## Reader fairness

Per-block timers previously dropped polls whenever MAX_IN_FLIGHT was reached.
With slower responses, the same blocks could repeatedly win capacity while
other status blocks and startup reads were never serviced. The reader now
coalesces overdue polls in a bounded FIFO set and drains it on reply/timeout.
Concurrency, requested poll periods, register mappings, and write logic remain
unchanged. Regression tests reproduce the old starvation and verify fairness,
startup reads, timeout recovery, and stopping queued work.

## Initial rollout

Only .80 receives this initial local patch. Preserve its Node-RED image, flows,
site configuration, schedules, and other modules. Back up before and after in
the local fmp-mini-rollout backup directory. Update the two shared templates
and compiled reader/export helpers from this repo, then restart the same
NodeRedModule to rebuild cached plans and lookups. Verify active runtime
context rather than relying solely on a potentially older named file-store
cache. Confirm fresh gridStat and corrected W in emitted telemetry.

Other sites and historical cloud data are not changed by this rollout.
