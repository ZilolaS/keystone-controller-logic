# FMP daily schedule placeholders

The Mini and eSpire 280 templates previously advertised a fabricated all-day
schedule for cloud UI testing. These are not the controller's EdgeScheduler
plans and must not appear as an operational schedule on the FMP dashboard.

Their 40104 BatteryScheduling and ACChargeStatus constants now report 0.
All 18 charge, discharge, and grid-charge start/end fields also report 0.
Explicit zero values clear previously cached cloud intervals; simply omitting
the fields could leave the old all-day schedule visible. Existing FMP rendering
filters zero-duration midnight intervals and honors disabled scheduling flags.
The dashboard may still display an empty/disabled schedule card; its layout is
controlled by FMP, not by controller telemetry.

All other 40104 telemetry remains available. No Modbus write, operational plan,
SOC constraint, schedule UI API, or control-loop behavior is changed. Nano's
device-backed schedule registers are outside this placeholder cleanup.

Initial deployment: Levtex (.80), template-only update with before/after backups
and unchanged Node-RED image/flows. Verify all 20 fields are zero in AWS telemetry
and that stored controller configuration and EdgeScheduler plans are unchanged.
