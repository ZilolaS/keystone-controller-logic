# Mini fan warning mapping

The shared Sinexcel Mini PCS template maps register 108 bit 1 (Module Fan
fault 1) to 40103.pcsWarning bit 0 (Fan abnormal). Register 36 bits 5 and 6
mean electrical room fan stopped and transformer fan stopped. They are status
indications, not fan-failure indications, and must not raise that warning.

Raw register 36 remains available as 50103.pcsStatusWord36. Raw register 108
and other warning mappings are unchanged. This change does not affect fan
controls, PCS dispatch, schedules, or physical fault resets.

## Initial rollout

- Target: Levtex, 10.253.0.80, controller 24000037.
- Apply only the shared pcsWarning expression and description to the installed
  PCS template; retain all other installed template entries.
- Back up Node-RED flows, configuration, context, and installed library before
  the update and again after verification in the local fmp-mini-rollout folder.
- Reload Node-RED to rebuild its cached reader plan. Keep the existing image.
- Verify template parity for the changed tag, unchanged flows/configuration,
  fresh telemetry, and actual-fan-fault behavior through local regression tests.
- Other sites are not changed by this initial rollout.
