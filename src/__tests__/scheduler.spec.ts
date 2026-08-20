import type { SiteConfig } from "../config";
import {
  initScheduler,
  matchActiveSchedulePlan,
  scheduleOutputFromActivePlan,
  type SchedulePlan,
} from "../scheduler";

const monthlyPlans: SchedulePlan[] = [
  {
    planID: "april",
    cron: "0 0 * APR MON,TUE,WED,THU,FRI,SAT,SUN",
    duration: { unit: "minutes", value: 1439 },
    start: "2026-04-01T00:00:00",
    until: "2026-04-30T23:59:59",
    strategy: {
      meter_rule: {
        discharge: { net_load_threshold: 20 },
        charge: { net_load_threshold: 0 },
      },
    },
    constraints: { min_soc: 40, max_soc: 95 },
  },
  {
    planID: "may",
    cron: "0 0 * MAY MON,TUE,WED,THU,FRI,SAT,SUN",
    duration: { unit: "minutes", value: 1439 },
    start: "2026-05-01T00:00:00",
    until: "2026-05-31T23:59:59",
    strategy: {
      meter_rule: {
        discharge: { net_load_threshold: 32 },
        charge: { net_load_threshold: 0 },
      },
    },
    constraints: { min_soc: 40, max_soc: 95 },
  },
  {
    planID: "june",
    cron: "0 0 * JUN MON,TUE,WED,THU,FRI,SAT,SUN",
    duration: { unit: "minutes", value: 1439 },
    start: "2026-06-01T00:00:00",
    until: "2026-06-30T23:59:59",
    strategy: {
      meter_rule: {
        discharge: { net_load_threshold: 44 },
        charge: { net_load_threshold: 0 },
      },
    },
    constraints: { min_soc: 40, max_soc: 95 },
  },
];

const nodeRedSchedulePlanGroups = [
  {
    timed: [
      {
        planID: "5_off_peak_weekday",
        cron: "0 0 * MAY MON,TUE,WED,THU,FRI",
        default: false,
        description: "5_off-peak_weekday_strategy",
        duration: { unit: "minutes", value: 959 },
        name: "5_off-peak_weekday_strategy",
        start: "2026-05-01T00:00:00",
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 25.86717843502316, unit: "kW" },
            },
            charge: {
              net_load_threshold: { value: 19.40038382626737, unit: "kW" },
            },
          },
        },
        until: "2026-05-31T15:59:00",
        constraints: {
          min_soc: { value: 50, unit: "%" },
          max_soc: { value: 95, unit: "%" },
          max_charge_power: { value: 100, unit: "%" },
          max_discharge_power: { value: 100, unit: "%" },
        },
        version: "3.0",
      },
    ],
  },
  {
    timed: [
      {
        planID: "5_peak_weekday",
        cron: "0 16 * MAY MON,TUE,WED,THU,FRI",
        default: false,
        description: "5_peak_weekday_strategy",
        duration: { unit: "minutes", value: 299 },
        name: "5_peak_weekday_strategy",
        start: "2026-05-01T16:00:00",
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 5.16, unit: "kW" },
            },
            charge: {
              net_load_threshold: { value: -999999, unit: "kW" },
            },
          },
        },
        until: "2026-05-31T20:59:00",
        constraints: {
          min_soc: { value: 50, unit: "%" },
          max_soc: { value: 95, unit: "%" },
          max_charge_power: { value: 100, unit: "%" },
          max_discharge_power: { value: 100, unit: "%" },
        },
        version: "3.0",
      },
    ],
  },
  {
    timed: [
      {
        planID: "5_post_peak_weekday",
        cron: "0 21 * MAY MON,TUE,WED,THU,FRI",
        default: false,
        description: "5_post-peak_weekday_strategy",
        duration: { unit: "minutes", value: 179 },
        name: "5_post-peak_weekday_strategy",
        start: "2026-05-01T21:00:00",
        strategy: {
          meter_rule: {
            discharge: {
              net_load_threshold: { value: 25.86717843502316, unit: "kW" },
            },
            charge: {
              net_load_threshold: { value: 19.40038382626737, unit: "kW" },
            },
          },
        },
        until: "2026-05-31T23:59:00",
        constraints: {
          min_soc: { value: 50, unit: "%" },
          max_soc: { value: 95, unit: "%" },
          max_charge_power: { value: 100, unit: "%" },
          max_discharge_power: { value: 100, unit: "%" },
        },
        version: "3.0",
      },
    ],
  },
  {
    planID: "default_command",
    cron: "0 0 * * *",
    default: true,
    description: "Default command configuration",
    duration: { unit: "minutes", value: "" },
    name: "Default Command",
    start: "2025-10-23T10:23:00",
    strategy: {
      meter_rule: {
        discharge: { net_load_threshold: { value: 85, unit: "kW" } },
        charge: { net_load_threshold: { value: 0, unit: "kW" } },
      },
    },
    until: "",
    constraints: {
      min_soc: { value: 50, unit: "%" },
      max_soc: { value: 95, unit: "%" },
      max_charge_power: { value: 100, unit: "%" },
      max_discharge_power: { value: 100, unit: "%" },
    },
  },
];

function makeConfig(): SiteConfig {
  return {
    system: {
      systemProfile: "eSpire280",
      controllerTimezone: "America/Los_Angeles",
      nominal: { voltageVll: 480, frequencyHz: 60 },
    },
    network: {
      controller: {
        ip: "192.168.1.10",
        modbusServer: { ip: "192.168.1.20", port: 502 },
      },
    },
    operation: {
      mode: "grid-tied",
      gridCode: "IEEE1547-2018",
      crdMode: "no-export",
      scheduledControlEnabled: true,
    },
    pcs: { pcsDaisyChain: [1, 1], maxChargeKw: 250, maxDischargeKw: 250 },
    mbmu: { sbmuStrings: [2, 2] },
    battery: { minSoc: 0.1, maxSoc: 0.9 },
    pv: { acInverters: [], curtailmentMethod: null },
    metering: {
      meterType: "eGauge-4015",
      modbusProfile: "udt_eGauge_V1",
      ip: "192.168.1.88",
      reads: { pv: false, pvFromInverter: false, utility: true, load: true },
    },
  };
}

describe("scheduler", () => {
  test("selects the active monthly all-day grid-tie plan", () => {
    const activePlan = matchActiveSchedulePlan(monthlyPlans, {
      now: "2026-05-02T19:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(activePlan?.plan.planID).toBe("may");
    expect(activePlan?.via).toBe("timed");
    expect(activePlan?.source).toBe("local");
    expect(activePlan?.isFallback).toBeUndefined();
  });

  test("respects start and until bounds as monthly schedules roll forward", () => {
    const activePlan = matchActiveSchedulePlan(monthlyPlans, {
      now: "2026-06-02T19:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(activePlan?.plan.planID).toBe("june");
    expect(activePlan?.plan.strategy?.meter_rule).toEqual(
      expect.objectContaining({
        discharge: { net_load_threshold: 44 },
      })
    );
  });

  test("keeps a cross-midnight plan active after midnight", () => {
    const plans: SchedulePlan[] = [
      {
        planID: "night",
        cron: "30 23 * MAY MON,TUE,WED,THU,FRI,SAT,SUN",
        duration: { unit: "minutes", value: 120 },
      },
    ];

    const activePlan = matchActiveSchedulePlan(plans, {
      now: "2026-05-03T07:30:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(activePlan?.plan.planID).toBe("night");
    expect(activePlan?.start?.toISOString()).toBe("2026-05-02T23:30:00.000Z");
    expect(activePlan?.end.toISOString()).toBe("2026-05-03T01:30:00.000Z");
  });

  test("uses default fallback and exposes next timed start", () => {
    const plans: SchedulePlan[] = [
      {
        planID: "morning",
        cron: "0 8 * MAY MON,TUE,WED,THU,FRI",
        duration: { unit: "hours", value: 2 },
      },
      {
        planID: "fallback",
        default: true,
        strategy: { meter_rule: { discharge: { net_load_threshold: 0 } } },
      },
    ];

    const activePlan = matchActiveSchedulePlan(plans, {
      now: "2026-05-02T19:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(activePlan?.plan.planID).toBe("fallback");
    expect(activePlan?.isFallback).toBe(true);
    expect(activePlan?.nextTimedStart?.toISOString()).toBe("2026-05-04T08:00:00.000Z");
  });

  test("treats Node-RED default command as fallback even when it has cron", () => {
    const offPeak = matchActiveSchedulePlan(nodeRedSchedulePlanGroups, {
      now: "2026-05-04T19:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    const peak = matchActiveSchedulePlan(nodeRedSchedulePlanGroups, {
      now: "2026-05-04T23:30:00.000Z",
      timezone: "America/Los_Angeles",
    });
    const postPeak = matchActiveSchedulePlan(nodeRedSchedulePlanGroups, {
      now: "2026-05-05T04:30:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(offPeak?.plan.name).toBe("5_off-peak_weekday_strategy");
    expect(offPeak?.via).toBe("timed");
    expect(peak?.plan.name).toBe("5_peak_weekday_strategy");
    expect(peak?.via).toBe("timed");
    expect(postPeak?.plan.name).toBe("5_post-peak_weekday_strategy");
    expect(postPeak?.via).toBe("timed");
  });

  test("passes through an upstream active plan", () => {
    const activePlan = matchActiveSchedulePlan([], {
      now: "2026-05-02T19:00:00.000Z",
      timezone: "America/Los_Angeles",
      upstreamActivePlan: {
        planID: "node-red-selected",
        strategy: { pv_rule: { mode: "self_consumption" } },
      },
    });

    expect(activePlan?.plan.planID).toBe("node-red-selected");
    expect(activePlan?.source).toBe("upstream");
    expect(activePlan?.via).toBe("upstream");
  });

  test("selects production UI schedules with absolute time windows", () => {
    const schedule = {
      version: "3.0",
      site: { export_allowed: true },
      default: {
        planID: "default_command",
        default: true,
        strategy: {
          meter_rule: {
            discharge: { net_load_threshold: { value: 85, unit: "kW" } },
            charge: { net_load_threshold: { value: 0, unit: "kW" } },
          },
        },
      },
      timed: [
        {
          planID: "grid-charge",
          time: {
            start: "2026-09-14T12:00:00Z",
            end: "2026-09-14T22:00:00Z",
          },
          strategy: {
            meter_rule: {
              discharge: { net_load_threshold: { value: 999999, unit: "kW" } },
              charge: { net_load_threshold: { value: 0, unit: "kW" } },
            },
            pv_rule: { name: "SelfConsumption" },
          },
          constraints: {
            min_soc: { value: 0.1, unit: "%" },
            max_soc: { value: 0.95, unit: "%" },
          },
        },
      ],
    };

    const activePlan = matchActiveSchedulePlan(schedule, {
      now: "2026-09-14T18:00:00.000Z",
      timezone: "America/Los_Angeles",
    });

    expect(activePlan?.plan.planID).toBe("grid-charge");
    expect(activePlan?.via).toBe("timed");
    expect(activePlan?.start?.toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(activePlan?.end.toISOString()).toBe("2026-09-14T22:00:00.000Z");
    expect(scheduleOutputFromActivePlan(activePlan!).strategy?.pv_rule).toEqual({
      name: "SelfConsumption",
    });
  });

  test("returns strategy, constraints, and direct setpoints from the selected plan", () => {
    const activePlan = matchActiveSchedulePlan(
      [
        {
          planID: "fixed",
          cron: "0 0 * MAY *",
          duration: 1439,
          activePowerKwSetpoint: 50,
          strategy: { fixed: true },
          constraints: { min_soc: 30 },
        },
      ],
      { now: "2026-05-02T19:00:00.000Z", timezone: "America/Los_Angeles" }
    );

    const output = scheduleOutputFromActivePlan(activePlan!);

    expect(output.activePowerKwSetpoint).toBe(50);
    expect(output.strategy).toEqual({ fixed: true });
    expect(output.constraints).toEqual({ min_soc: 30 });
    expect(output.selectedPlan?.planID).toBe("fixed");
  });

  test("returns the EdgeScheduler command payload from the selected plan", () => {
    const activePlan = matchActiveSchedulePlan(
      [
        {
          planID: "peak-shaving",
          default: true,
          payload: {
            command: "peakShaving",
            dischargeThresholdKw: 40,
            chargeThresholdKw: 20,
            minSocPct: 50,
            maxSocPct: 95,
            maxChargePowerPct: 100,
            maxDischargePowerPct: 100,
          },
        },
      ],
      { now: "2026-05-02T19:00:00.000Z", timezone: "America/Los_Angeles" }
    );

    const output = scheduleOutputFromActivePlan(activePlan!);

    expect(output.payload).toEqual(
      expect.objectContaining({
        command: "peakShaving",
        dischargeThresholdKw: 40,
      })
    );
  });

  test("selects the highest-priority active EdgeScheduler job", () => {
    const activePlan = matchActiveSchedulePlan(
      [
        {
          planID: "local",
          owner: "LocalSchedule",
          priority: 50,
          cron: "0 0 * MAY *",
          duration: 1439,
          payload: { command: "peakShaving", dischargeThresholdKw: 100 },
        },
        {
          planID: "vpp",
          owner: "Vpp",
          priority: 200,
          cron: "0 0 * MAY *",
          duration: 1439,
          payload: { command: "peakShaving", dischargeThresholdKw: 40 },
        },
      ],
      { now: "2026-05-02T19:00:00.000Z", timezone: "America/Los_Angeles" }
    );

    const output = scheduleOutputFromActivePlan(activePlan!);

    expect(output.selectedPlan?.planID).toBe("vpp");
    expect(output.selectedPlan?.owner).toBe("Vpp");
    expect(output.selectedPlan?.priority).toBe(200);
    expect(output.payload?.dischargeThresholdKw).toBe(40);
  });

  test("parses payloadJson on selected EdgeScheduler plans", () => {
    const activePlan = matchActiveSchedulePlan(
      [
        {
          planID: "self-consumption",
          default: true,
          payloadJson: JSON.stringify({
            command: "maximizePvSelfConsumption",
            targetImportKw: 0.5,
            deadbandKw: 0.8,
          }),
        },
      ],
      { now: "2026-05-02T19:00:00.000Z", timezone: "America/Los_Angeles" }
    );

    const output = scheduleOutputFromActivePlan(activePlan!);

    expect(output.payload).toEqual({
      command: "maximizePvSelfConsumption",
      targetImportKw: 0.5,
      deadbandKw: 0.8,
    });
    expect(output.payloadJson).toContain("maximizePvSelfConsumption");
  });

  test("initScheduler uses controller timezone and configured plans", () => {
    const scheduler = initScheduler(makeConfig(), {
      plans: [{ timed: monthlyPlans }],
      now: "2026-05-02T19:00:00.000Z",
    });

    const output = scheduler.getSetpointForNow();

    expect(output.activePlan?.plan.planID).toBe("may");
    expect(output.strategy?.meter_rule).toEqual(
      expect.objectContaining({
        discharge: { net_load_threshold: 32 },
      })
    );
  });
});
