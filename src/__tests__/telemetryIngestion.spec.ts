import { buildReadPlan } from "../compiler/compiler";
import * as reader from "../reader/reader";
import type { CompilerEnv, ReaderEnv } from "../types";
import {
  adaptTelemetryTemplateToReadProfile,
  resolveTelemetryTemplate,
} from "../telemetry/templateAdapter";
import { buildAmpaceBcu42kTemplate } from "../telemetry/ampaceBcu42k";

const compilerEnv: CompilerEnv = {
  maxQty: 120,
  maxSpan: 80,
  maxHole: 4,
  pollFast: 250,
  pollNormal: 1000,
  pollSlow: 5000,
} as any;

const readerEnv: ReaderEnv = {
  MODBUS_ZERO_BASED: false,
  MAX_IN_FLIGHT: 4,
  REQUEST_TIMEOUT_MS: 1500,
  JITTER_MS: 0,
  RESPECT_TAG_CLAMP: false,
  SCALE_CLAMP_DEFAULT: false,
  SKIP_EMPTY_SAMPLES: false,
} as any;

const instance = {
  equipmentId: "Test.Dev",
  serverKey: "TEST",
  unitId: 1,
};

function makePlanForTag(tag: any) {
  const profile = {
    profileId: "test_profile",
    defaults: {
      byteOrder: "BE",
      wordOrder32: "ABCD",
    },
    tags: [tag],
  };
  return buildReadPlan(profile, instance, compilerEnv);
}

function simulateReply(
  plan: any,
  blockIdx: number,
  regs: number[]
) {
  const msg = {
    _reader: { equipmentId: plan.equipmentId, blockIdx },
    payload: regs,
  };
  return reader.onReply(msg, plan, readerEnv);
}

describe("Modbus function semantics", () => {
  test("pollClass fast drives block pollMs", () => {
    const plan = makePlanForTag({
      name: "fast_tag",
      function: "HRUS",
      address: 50,
      pollClass: "fast",
    });

    expect(plan.blocks[0].pollMs).toBe(250);
  });

  test("pollClass slow drives block pollMs", () => {
    const plan = makePlanForTag({
      name: "slow_tag",
      function: "HRUS",
      address: 51,
      pollClass: "slow",
    });

    expect(plan.blocks[0].pollMs).toBe(5000);
  });

  test("explicit pollMs overrides pollClass", () => {
    const plan = makePlanForTag({
      name: "override_tag",
      function: "HRUS",
      address: 52,
      pollClass: "slow",
      pollMs: 750,
    });

    expect(plan.blocks[0].pollMs).toBe(750);
  });

  test("mixed block uses fastest member poll interval", () => {
    const profile = {
      profileId: "mixed_poll_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        {
          name: "normal_tag",
          function: "HRUS",
          address: 100,
          pollClass: "normal",
        },
        {
          name: "fast_tag",
          function: "HRUS",
          address: 101,
          pollClass: "fast",
        },
      ],
    };

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].pollMs).toBe(250);
  });

  test("startup tags compile into startup-only blocks", () => {
    const plan = makePlanForTag({
      name: "startup_tag",
      function: "HRUS",
      address: 60,
      pollClass: "startup",
    });

    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].startupOnly).toBe(true);
    expect(plan.blocks[0].pollMs).toBe(0);
  });

  test("startup tags do not merge with recurring blocks", () => {
    const profile = {
      profileId: "startup_split_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        {
          name: "startup_tag",
          function: "HRUS",
          address: 100,
          pollClass: "startup",
        },
        {
          name: "normal_tag",
          function: "HRUS",
          address: 101,
          pollClass: "normal",
        },
      ],
    };

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.blocks).toHaveLength(2);

    const startupBlock = plan.blocks.find((b: any) => b.startupOnly);
    const recurringBlock = plan.blocks.find((b: any) => !b.startupOnly);

    expect(startupBlock).toBeDefined();
    expect(startupBlock.pollMs).toBe(0);
    expect(recurringBlock).toBeDefined();
    expect(recurringBlock.pollMs).toBe(1000);
  });

  test("reader polls startup blocks once only", () => {
    jest.useFakeTimers();

    const plan = makePlanForTag({
      name: "startup_tag",
      function: "HRUS",
      address: 70,
      pollClass: "startup",
    });
    const send = jest.fn();

    reader.start(plan, readerEnv, send);
    jest.runOnlyPendingTimers();
    jest.advanceTimersByTime(5000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]._reader.blockIdx).toBe(0);
    expect(plan.blocks[0].startupOnly).toBe(true);

    reader.stop(plan.equipmentId);
    jest.useRealTimers();
  });

  test("reader decodes two-byte big-endian ASCII register strings", () => {
    const plan = makePlanForTag({
      name: "SerialNumber",
      function: "HRUS",
      address: 0,
      length: 11,
      parser: "STR16BE",
      pollClass: "startup",
    });

    const res = simulateReply(plan, 0, [
      21320, 12368, 13872, 12340, 13624, 14389, 12852, 12339, 12343, 12336,
      13109,
    ]);

    expect(res.out2).toEqual([
      expect.objectContaining({
        tagID: "SerialNumber",
        value: "SH0P600458852403070035",
      }),
    ]);
  });

  test("reader staggers same-period blocks so later blocks are not starved", () => {
    jest.useFakeTimers();

    const profile = {
      profileId: "stagger_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        { name: "tag_a", function: "HRUS", address: 100, pollClass: "fast" },
        { name: "tag_b", function: "HRUS", address: 200, pollClass: "fast" },
        { name: "tag_c", function: "HRUS", address: 300, pollClass: "fast" },
      ],
    };

    const plan = buildReadPlan(profile, instance, {
      ...compilerEnv,
      maxSpan: 10,
      CompilerMaxSpan: 10,
      maxHole: 0,
      CompilerMaxHole: 0,
      pollFast: 90,
      PollFastMs: 90,
    } as any);

    const requestedBlocks: number[] = [];
    const send = jest.fn((o1?: any) => {
      if (!o1?._reader) return;
      requestedBlocks.push(o1._reader.blockIdx);
      setTimeout(() => {
        reader.onReply(
          {
            _reader: o1._reader,
            payload: [123],
          },
          plan,
          {
            ...readerEnv,
            MAX_IN_FLIGHT: 1,
            REQUEST_TIMEOUT_MS: 1000,
          } as any
        );
      }, 10);
    });

    reader.start(
      plan,
      {
        ...readerEnv,
        MAX_IN_FLIGHT: 1,
        REQUEST_TIMEOUT_MS: 1000,
      } as any,
      send
    );

    jest.advanceTimersByTime(120);

    expect(Array.from(new Set(requestedBlocks)).sort()).toEqual([0, 1, 2]);

    reader.stop(plan.equipmentId);
    jest.useRealTimers();
  });

  test("constant tags compile outside Modbus blocks", () => {
    const plan = makePlanForTag({
      name: "const_tag",
      pollClass: "startup",
      constant: 280,
    });

    expect(plan.blocks).toHaveLength(0);
    expect(plan.constants).toEqual([
      {
        tagID: "const_tag",
        value: 280,
        alarm: "No",
        supportingTag: "No",
      },
    ]);
  });

  test("reader emits constant tags once on start", () => {
    const plan = makePlanForTag({
      name: "const_tag",
      pollClass: "startup",
      constant: 280,
    });
    const send = jest.fn();

    reader.start(plan, readerEnv, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeNull();
    expect(send.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        tagID: "const_tag",
        value: 280,
        alarm: "No",
        supportingTag: "No",
      }),
    ]);
    expect(send.mock.calls[0][2]).toEqual({
      payload: expect.objectContaining({
        equipmentId: plan.equipmentId,
        state: "constants",
        count: 1,
      }),
    });

    reader.stop(plan.equipmentId);
  });

  test("legacy calc.from normalizes to inputs.x", () => {
    const profile = adaptTelemetryTemplateToReadProfile("mbmu_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_P_BAT_CHG",
          pollClass: "fast",
          calc: {
            from: "BMS_P_SYS",
            expr: "max(0, -x)",
          },
        },
      ],
    } as any);

    expect(profile.tags[0].calc).toEqual({
      inputs: { x: "BMS_P_SYS" },
      expr: "max(0, -x)",
    });
  });

  test("reader evaluates multi-input calc from cached values", () => {
    const profile = {
      profileId: "calc_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        {
          name: "SE_POWER_RAW",
          function: "HRUS",
          address: 100,
          pollClass: "fast",
        },
        {
          name: "SE_POWER_SF",
          function: "HR",
          address: 220,
          pollClass: "fast",
        },
        {
          name: "SE_POWER",
          pollClass: "fast",
          calc: {
            inputs: {
              raw: "SE_POWER_RAW",
              sf: "SE_POWER_SF",
            },
            expr: "raw * pow(10, sf)",
          },
        },
      ],
    };

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const send = jest.fn();
    reader.start(plan, readerEnv, send);

    const rawBlockIdx = plan.blocks.findIndex((b: any) =>
      b.map.some((m: any) => m.tagID === "SE_POWER_RAW")
    );
    const sfBlockIdx = plan.blocks.findIndex((b: any) =>
      b.map.some((m: any) => m.tagID === "SE_POWER_SF")
    );

    const rawRes = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: rawBlockIdx },
        payload: [1234],
      },
      plan,
      readerEnv
    );
    expect(rawRes.out2).toEqual([
      expect.objectContaining({
        tagID: "SE_POWER_RAW",
        value: 1234,
      }),
    ]);

    const sfRes = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: sfBlockIdx },
        payload: [0xffff],
      },
      plan,
      readerEnv
    );
    expect(sfRes.out2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagID: "SE_POWER_SF",
          value: -1,
        }),
        expect.objectContaining({
          tagID: "SE_POWER",
          value: 123.4,
        }),
      ])
    );

    reader.stop(plan.equipmentId);
  });

  test("virtual placeholder tags compile outside Modbus blocks", () => {
    const profile = adaptTelemetryTemplateToReadProfile("mbmu_virtual_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_TEMP_CELL_AVG",
          function: null,
          address: null,
          pollClass: "normal",
        },
      ],
    } as any);

    expect(profile.tags[0].virtual).toBe(true);
    expect(profile.tags[0].function).toBeUndefined();
    expect(profile.tags[0].address).toBeUndefined();

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.blocks).toHaveLength(0);
    expect(plan.virtuals).toEqual([
      {
        tagID: "BMS_TEMP_CELL_AVG",
        pollClass: "normal",
        alarm: "No",
        supportingTag: "No",
      },
    ]);
  });

  test("reader emits diagnostic for skipped virtual tags on start", () => {
    const profile = adaptTelemetryTemplateToReadProfile("mbmu_virtual_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_TEMP_CELL_AVG",
          function: null,
          address: null,
          pollClass: "normal",
        },
      ],
    } as any);

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const send = jest.fn();

    reader.start(plan, readerEnv, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeNull();
    expect(send.mock.calls[0][1]).toBeNull();
    expect(send.mock.calls[0][2]).toEqual({
      payload: expect.objectContaining({
        equipmentId: plan.equipmentId,
        state: "virtual-tags-skipped",
        count: 1,
        tagIDs: ["BMS_TEMP_CELL_AVG"],
      }),
    });

    reader.stop(plan.equipmentId);
  });

  test("flat enumStatus is normalized and surfaced in reader output", () => {
    const profile = adaptTelemetryTemplateToReadProfile("enum_status_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_AUX_POWER_STATE",
          function: "HRUS",
          address: 898,
          pollClass: "fast",
          enumStatus: {
            "0": "Normal",
            "1": "AuxPowerLose",
          },
        },
      ],
    } as any);

    expect(profile.tags[0].enumStatus).toEqual({
      "0": "Normal",
      "1": "AuxPowerLose",
    });
    expect(profile.tags[0].status).toBe("Yes");

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [1],
      },
      plan,
      readerEnv
    );

    expect(res.out2[0]).toEqual(
      expect.objectContaining({
        tagID: "BMS_AUX_POWER_STATE",
        value: 1,
        enumLabel: "AuxPowerLose",
      })
    );
    expect(res.out2[1]).toEqual(
      expect.objectContaining({
        tagID: "BMS_AUX_POWER_STATE_str",
        value: "AuxPowerLose",
        supportingTag: "No",
        rawValue: 1,
      })
    );
  });

  test("bitfieldStatus mapping decodes active bits and labels", () => {
    const profile = adaptTelemetryTemplateToReadProfile("bitfield_status_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_ALARM_WORD_0",
          function: "HRUS",
          address: 500,
          pollClass: "fast",
          bitfieldStatus: {
            "0": "OverVoltage",
            "2": "OverTemp",
            "3": "CommFault",
          },
        },
      ],
    } as any);

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [5],
      },
      plan,
      readerEnv
    );

    expect(res.out2[0]).toEqual(
      expect.objectContaining({
        tagID: "BMS_ALARM_WORD_0",
        value: 5,
        activeBits: [0, 2],
        activeLabels: ["OverVoltage", "OverTemp"],
      })
    );
    expect(res.out2[1]).toEqual(
      expect.objectContaining({
        tagID: "BMS_ALARM_WORD_0_str",
        value: "OverVoltage, OverTemp",
        supportingTag: "No",
        rawValue: 5,
      })
    );
  });

  test("bitfieldStatus true decodes active bits without labels", () => {
    const profile = adaptTelemetryTemplateToReadProfile("bitfield_status_bool_test", {
      version: "2",
      device: {
        vendor: "EnerOne",
        model: "BMS",
        protocol: "modbus-tcp",
      },
      telemetry: [
        {
          id: "BMS_ALARM_WORD_0",
          function: "HRUS",
          address: 500,
          pollClass: "fast",
          bitfieldStatus: true,
        },
      ],
    } as any);

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [5],
      },
      plan,
      readerEnv
    );

    expect(res.out2[0]).toEqual(
      expect.objectContaining({
        tagID: "BMS_ALARM_WORD_0",
        value: 5,
        activeBits: [0, 2],
      })
    );
    expect(res.out2[0].activeLabels).toBeUndefined();
    expect(res.out2[1]).toEqual(
      expect.objectContaining({
        tagID: "BMS_ALARM_WORD_0_str",
        value: "0,2",
        supportingTag: "No",
        rawValue: 5,
      })
    );
  });

  test("commands are compiled into the read plan by default", () => {
    const profile = adaptTelemetryTemplateToReadProfile("command_readback_test", {
      version: "2",
      device: {
        vendor: "Sinexcel",
        model: "PCS",
        protocol: "modbus-tcp",
      },
      telemetry: [],
      commands: [
        {
          id: "Start",
          function: "HRUS",
          address: 100,
          enumStatus: {
            "0": "Stop",
            "1": "Start",
          },
        },
      ],
    } as any);

    expect(profile.tags).toHaveLength(1);
    expect(profile.tags[0]).toEqual(
      expect.objectContaining({
        name: "Start",
        function: "HRUS",
        address: 100,
        pollClass: "normal",
        enumStatus: {
          "0": "Stop",
          "1": "Start",
        },
      })
    );

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].pollMs).toBe(1000);
  });

  test("legacy command enum is normalized for command status decoding", () => {
    const profile = adaptTelemetryTemplateToReadProfile("command_enum_compat_test", {
      version: "2",
      device: {
        vendor: "Sinexcel",
        model: "PCS",
        protocol: "modbus-tcp",
      },
      telemetry: [],
      commands: [
        {
          id: "OnOffGridSwitch",
          function: "HRUS",
          address: 200,
          pollClass: "normal",
          enum: {
            "2": "GT",
            "6": "SA",
          },
        },
      ],
    } as any);

    const plan = buildReadPlan(profile, instance, compilerEnv);
    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [6],
      },
      plan,
      readerEnv
    );

    expect(res.out2[0]).toEqual(
      expect.objectContaining({
        tagID: "OnOffGridSwitch",
        value: 6,
        enumLabel: "SA",
      })
    );
    expect(res.out2[1]).toEqual(
      expect.objectContaining({
        tagID: "OnOffGridSwitch_str",
        value: "SA",
        rawValue: 6,
      })
    );
  });

  test("HR (S16)", () => {
    const plan = makePlanForTag({
      name: "hr_s16",
      function: "HR",
      address: 100,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    const res = simulateReply(plan, 0, [0xfffe]); // -2
    const sample = res.out2[0];
    expect(sample.tagID).toBe("hr_s16");
    expect(sample.value).toBe(-2);
  });

  test("HRUS (U16)", () => {
    const plan = makePlanForTag({
      name: "hr_us",
      function: "HRUS",
      address: 101,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    const res = simulateReply(plan, 0, [65535]);
    const sample = res.out2[0];
    expect(sample.value).toBe(65535);
  });

  test("HRI (S32)", () => {
    const plan = makePlanForTag({
      name: "hri_s32",
      function: "HRI",
      address: 200,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(2);

    // value just over 2^31 to force negative sign
    const hi = 0x8000;
    const lo = 0x0001;
    const res = simulateReply(plan, 0, [hi, lo]);
    const sample = res.out2[0];
    expect(sample.value).toBeLessThan(0); // signed
  });

  test("HRUI (U32)", () => {
    const plan = makePlanForTag({
      name: "hrui_u32",
      function: "HRUI",
      address: 210,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(2);

    const expected = 2350317571;
    const hi = Math.floor(expected / 0x10000);
    const lo = expected & 0xffff;
    const res = simulateReply(plan, 0, [hi, lo]);
    const sample = res.out2[0];
    expect(sample.value).toBe(expected);
  });

  test("HRF (F32)", () => {
    const plan = makePlanForTag({
      name: "hrf_f32",
      function: "HRF",
      address: 220,
    });
    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(2);

    // encode 1.5 as F32 big-endian
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setFloat32(0, 1.5, false);
    const hi = dv.getUint16(0, false);
    const lo = dv.getUint16(2, false);

    const res = simulateReply(plan, 0, [hi, lo]);
    const sample = res.out2[0];
    expect(Math.abs(sample.value - 1.5)).toBeLessThan(1e-6);
  });

  test("HRUI_64 reads four registers and preserves the exact U64 bitfield", () => {
    const plan = makePlanForTag({
      name: "hrui_64",
      function: "HRUI_64",
      address: 300,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(4);

    const res = simulateReply(plan, 0, [0x8000, 0x0000, 0x0000, 0x0001]);
    const sample = res.out2[0];
    expect(sample.value).toBe("0x8000000000000001");
  });

  test("calculated tags can test HRUI_64 values with 64-bit masks", () => {
    const plan = makePlanForTag({
      name: "fault_word",
      function: "HRUI_64",
      address: 300,
    });
    (plan as any).calcs = [
      {
        tagID: "fault_calc",
        inputs: { word: "fault_word" },
        expr: "has(word, '0x8000000000000000') | (bit(word, 0) << 1)",
        alarm: "Yes",
        supportingTag: "No",
      },
    ];

    const res = simulateReply(plan, 0, [0x8000, 0x0000, 0x0000, 0x0001]);
    expect(res.out2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagID: "fault_calc",
          value: 3,
        }),
      ])
    );
  });

  test("calculated tags do not reuse stale cached inputs after freshness window", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);

    const profile = {
      profileId: "stale_calc_profile",
      defaults: {
        byteOrder: "BE",
        wordOrder32: "ABCD",
      },
      tags: [
        {
          name: "StatusWord36",
          function: "HRUS",
          address: 36,
          pollClass: "normal",
        },
        {
          name: "FaultWord106",
          function: "HRUS",
          address: 106,
          pollClass: "normal",
        },
        {
          name: "pcsWarning",
          calc: {
            inputs: {
              w36: "StatusWord36",
              w106: "FaultWord106",
            },
            expr: "(((w36 >>> 5) & 1) << 0) | (((w106 >>> 13) & 1) << 4)",
          },
        },
      ],
    };
    const plan = buildReadPlan(profile, instance, compilerEnv);
    const sends: any[] = [];
    reader.start(plan, { ...readerEnv, CALC_INPUT_MAX_AGE_MS: 1000 }, (...args) => {
      sends.push(args);
    });

    try {
      const faultBlockIdx = plan.blocks.findIndex((block: any) =>
        block.map.some((item: any) => item.tagID === "FaultWord106")
      );
      const statusBlockIdx = plan.blocks.findIndex((block: any) =>
        block.map.some((item: any) => item.tagID === "StatusWord36")
      );

      expect(faultBlockIdx).toBeGreaterThanOrEqual(0);
      expect(statusBlockIdx).toBeGreaterThanOrEqual(0);

      reader.onReply(
        {
          _reader: { equipmentId: plan.equipmentId, blockIdx: faultBlockIdx },
          payload: [0x2000],
        },
        plan,
        { ...readerEnv, CALC_INPUT_MAX_AGE_MS: 1000 }
      );

      jest.setSystemTime(1_002_500);
      const result = reader.onReply(
        {
          _reader: { equipmentId: plan.equipmentId, blockIdx: statusBlockIdx },
          payload: [0],
        },
        plan,
        { ...readerEnv, CALC_INPUT_MAX_AGE_MS: 1000 }
      );

      expect(result.out2).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({ tagID: "pcsWarning" }),
        ])
      );
    } finally {
      reader.stop(plan.equipmentId);
      jest.useRealTimers();
    }
  });

  test("C (coil)", () => {
    const plan = makePlanForTag({
      name: "coil_flag",
      function: "C",
      address: 10,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(1);
    expect(blk.quantity).toBe(1);

    const res0 = simulateReply(plan, 0, [0]);
    const res1 = simulateReply(plan, 0, [1]);

    expect(res0.out2[0].value).toBe(0);
    expect(res1.out2[0].value).toBe(1);
  });

  test("IRS10 (string)", () => {
    const plan = makePlanForTag({
      name: "device_name",
      function: "IRS10",
      address: 400,
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(4);
    expect(blk.quantity).toBe(10);

    // 10 registers, 10 chars, 1 char per word: "HELLOWORLD"
    const text = "HELLOWORLD";
    const regs = [];
    for (let i = 0; i < text.length; i++) {
      regs.push(text.charCodeAt(i));
    }

    const res = simulateReply(plan, 0, regs);
    const sample = res.out2[0];
    expect(sample.value).toBe("HELLOWORLD");
  });
  test("HRUS with linear scaling (no clamp)", () => {
    const plan = makePlanForTag({
      name: "scaled_hrus",
      function: "HRUS",      // 16-bit unsigned
      address: 500,
      // scale config: 0–1000 raw -> 0–100 eng
      scale: {
        mode: "Linear",
        rawLow: 0,
        rawHigh: 1000,
        engLow: 0,
        engHigh: 100,
        clamp: false,        // explicit: do not clamp
      },
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    // raw = 500 -> mid-point -> ~50 eng units
    const res = simulateReply(plan, 0, [500]);
    const sample = res.out2[0];

    expect(sample.tagID).toBe("scaled_hrus");
    expect(sample.value).toBeCloseTo(50, 6);
  });
  test("HRUS with scaling and clamp enabled", () => {
    const plan = makePlanForTag({
      name: "scaled_hrus_clamped",
      function: "HRUS",
      address: 510,
      scale: {
        mode: "Linear",
        rawLow: 0,
        rawHigh: 1000,
        engLow: 0,
        engHigh: 100,
        clamp: true,          // enable clamp
      },
    });

    const blk = plan.blocks[0];
    expect(blk.fc).toBe(3);
    expect(blk.quantity).toBe(1);

    // Use readerEnv with SCALE_CLAMP_DEFAULT false so "clamp" flag is respected
    const localReaderEnv: ReaderEnv = {
      ...readerEnv,
      SCALE_CLAMP_DEFAULT: false,
      RESPECT_TAG_CLAMP: true,
    } as any;

    // Bypass simulateReply just to inject custom env:
    const msg = {
      _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
      payload: [1500], // raw above rawHigh
    };

    const res = reader.onReply(msg, plan, localReaderEnv);
    const sample = res.out2[0];

    // value should be clamped to engHigh (100)
    expect(sample.value).toBeCloseTo(100, 6);
  });
});

describe("Telemetry baseline lock", () => {
  test("SolarEdge template resolves aliases and keeps raw/SF calc", () => {
    const template = resolveTelemetryTemplate("udt_solarEdge_V1");
    const aliasTemplate = resolveTelemetryTemplate("solarEdge");
    expect(aliasTemplate.device.vendor).toBe("SolarEdge");

    const profile = adaptTelemetryTemplateToReadProfile(
      "udt_solarEdge_V1",
      template
    );
    const acPower = profile.tags.find((tag) => tag.name === "AC_POWER");
    const raw = profile.tags.find((tag) => tag.name === "AC_POWER_RAW");
    const sf = profile.tags.find((tag) => tag.name === "AC_POWER_SF");

    expect(raw?.supportingTag).toBe("Yes");
    expect(sf?.function).toBe("HR");
    expect(acPower?.calc).toEqual({
      inputs: {
        raw: "AC_POWER_RAW",
        sf: "AC_POWER_SF",
      },
      expr: "raw * pow(10, sf)",
    });

    const plan = buildReadPlan(profile, instance, compilerEnv);
    expect(plan.calcs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagID: "AC_POWER",
          inputs: {
            raw: "AC_POWER_RAW",
            sf: "AC_POWER_SF",
          },
          expr: "raw * pow(10, sf)",
        }),
      ])
    );
  });

  test("SolarEdge template includes live SunSpec telemetry and SS40K AC-coupled PV fields", () => {
    const template = resolveTelemetryTemplate("solarEdge");
    const profile = adaptTelemetryTemplateToReadProfile("solarEdge", template);

    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "DEVICE_ADDRESS",
          function: "HRUS",
          address: 40068,
        }),
        expect.objectContaining({
          name: "AC_ENERGY_WH_RAW",
          function: "HR",
          address: 40093,
          supportingTag: "Yes",
        }),
        expect.objectContaining({
          name: "AC_ENERGY_WH",
          calc: {
            inputs: {
              raw: "AC_ENERGY_WH_RAW",
              sf: "AC_ENERGY_WH_SF",
            },
            expr: "raw * pow(10, sf)",
          },
        }),
        expect.objectContaining({
          name: "GLOBAL_EVENTS",
          function: "HRUS",
          address: 40127,
          alarm: "Yes",
          status: "Yes",
        }),
      ])
    );

    expect(template.telemetry.find((tag) => tag.id === "AC_POWER")?.ss40k).toEqual({
      name: "pAcCplTot",
      model: "40101",
    });
    expect(template.telemetry.find((tag) => tag.id === "AC_ENERGY_WH")?.ss40k).toEqual({
      name: "ePvTot",
      model: "40102",
    });
  });

  test("SEL851 template resolves live register and coil points", () => {
    const template = resolveTelemetryTemplate("udt_SEL851_v1");
    const profile = adaptTelemetryTemplateToReadProfile("SEL851", template);

    expect(template.device.vendor).toBe("SEL");
    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ROW_46",
          function: "HRUS",
          address: 12,
          status: "Yes",
        }),
        expect.objectContaining({
          name: "RB_1",
          function: "C",
          address: 5,
        }),
        expect.objectContaining({
          name: "RB_2",
          function: "C",
          address: 6,
        }),
      ])
    );
  });

  test("SEL751 template resolves relay word and RB01 points", () => {
    const template = resolveTelemetryTemplate("udt_SEL751_v1");
    const profile = adaptTelemetryTemplateToReadProfile("SEL751", template);

    expect(template.device.vendor).toBe("SEL");
    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ROW_19",
          function: "HRUS",
          address: 1779,
          status: "Yes",
        }),
        expect.objectContaining({
          name: "ROW_44",
          function: "HRUS",
          address: 1804,
          status: "Yes",
        }),
        expect.objectContaining({
          name: "RB_1",
          function: "C",
          address: 27,
        }),
      ])
    );
  });

  test("Mission Energy eGauge template uses live telemetry addresses and derived power tags", () => {
    const template = resolveTelemetryTemplate("eGauge_Mission_Energy");
    const profile = adaptTelemetryTemplateToReadProfile(
      "eGauge_Mission_Energy",
      template
    );

    expect(template.device.name).toBe("udt_eGauge_Mission_Energy_V1");
    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "L1_Voltage",
          function: "IRF",
          address: 9000,
        }),
        expect.objectContaining({
          name: "Utility_L1_Power",
          function: "IRF",
          address: 9030,
        }),
        expect.objectContaining({
          name: "Utility_Total_Power",
          function: "IRF",
          address: 9058,
        }),
        expect.objectContaining({
          name: "Load_Active_Power",
          virtual: true,
          supportingTag: "Yes",
        }),
        expect.objectContaining({
          name: "Generator_Total_Power",
          function: "IRF",
          address: 9064,
        }),
        expect.objectContaining({
          name: "Utility_Import_Power",
          calc: {
            inputs: {
              utility: "Utility_Total_Power",
            },
            expr: "max(utility, 0)",
          },
        }),
      ])
    );
  });

  test("Mission Energy Meter2 template uses the two-tag SolarEdge meter map", () => {
    const template = resolveTelemetryTemplate("eGauge_Mission_Energy_Meter2");
    const profile = adaptTelemetryTemplateToReadProfile(
      "eGauge_Mission_Energy_Meter2",
      template
    );

    expect(template.device.name).toBe("udt_eGauge_Mission_Energy_Meter2_V1");
    expect(profile.tags).toEqual([
      expect.objectContaining({
        name: "Grid",
        function: "IRF",
        address: 9000,
      }),
      expect.objectContaining({
        name: "Solar",
        function: "IRF",
        address: 9004,
      }),
    ]);
  });

  test("Sinexcel Mini PCS template owns aggregate PV energy but excludes PVDC-owned status and power telemetry", () => {
    const template = resolveTelemetryTemplate("Sinexcel_Mini_PCS_ss40k");
    const legacyAliasTemplate = resolveTelemetryTemplate("Sinexcel_Mini_ss40k");
    const profile = adaptTelemetryTemplateToReadProfile(
      "Sinexcel_Mini_PCS_ss40k",
      template
    );

    expect(legacyAliasTemplate.device.model).toBe(template.device.model);
    expect(profile.tags.map((tag) => tag.name)).not.toEqual(
      expect.arrayContaining([
        "PVDCStatusWord",
        "PVSideTotalPower",
      ])
    );
    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "SerialNumber",
          function: "HRUS",
          address: 0,
          length: 11,
          parser: "STR16BE",
          pollClass: "startup",
        }),
        expect.objectContaining({
          name: "SystemStatusMap",
          function: "HRUS",
          address: 32,
          bitfieldStatus: expect.objectContaining({
            "4": "Grid-tied",
            "5": "Off-grid",
          }),
        }),
        expect.objectContaining({
          name: "InverterOperationStatus",
          calc: {
            inputs: {
              status: "SystemStatusMap",
            },
            expr: "(bit(status, 4) || bit(status, 5)) ? 1 : 0",
          },
        }),
        expect.objectContaining({
          name: "UnderVoltRegion1Boundary",
          function: "HRUS",
          address: 1345,
        }),
        expect.objectContaining({
          name: "PVDC1GeneratedEnergyHighWord",
          function: "HRUS",
          address: 34082,
          supportingTag: "Yes",
        }),
        expect.objectContaining({
          name: "PVDC2GeneratedEnergyHighWord",
          function: "HRUS",
          address: 34382,
          supportingTag: "Yes",
        }),
        expect.objectContaining({
          name: "PVDC3GeneratedEnergyHighWord",
          function: "HRUS",
          address: 34682,
          supportingTag: "Yes",
        }),
        expect.objectContaining({
          name: "PVGeneratedEnergy",
          calc: {
            inputs: {
              hi1: "PVDC1GeneratedEnergyHighWord",
              lo1: "PVDC1GeneratedEnergyLowWord",
              hi2: "PVDC2GeneratedEnergyHighWord",
              lo2: "PVDC2GeneratedEnergyLowWord",
              hi3: "PVDC3GeneratedEnergyHighWord",
              lo3: "PVDC3GeneratedEnergyLowWord",
            },
            expr: "((hi1 * 65536 + lo1) + (hi2 * 65536 + lo2) + (hi3 * 65536 + lo3)) * 0.1",
          },
        }),
      ])
    );

    expect(template.telemetry.find((tag) => tag.id === "PVGeneratedEnergy")?.ss40k).toEqual({
      name: "ePvTot",
      model: "40102",
      exportMultiplier: 1000,
    });
  });

  test("Sinexcel Mini PCS template calculates SS40K 40103 fault fields", () => {
    const template = resolveTelemetryTemplate("Sinexcel_Mini_PCS_ss40k");
    const profile = adaptTelemetryTemplateToReadProfile(
      "Sinexcel_Mini_PCS_ss40k",
      template
    );

    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "SinexcelStatusWord36",
          function: "HRUS",
          address: 36,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "SinexcelStatusWord37",
          function: "HRUS",
          address: 37,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "SinexcelFaultWord106",
          function: "HRUS",
          address: 106,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "SinexcelFaultWord115",
          function: "HRUS",
          address: 115,
        }),
        expect.objectContaining({
          name: "pcsFault",
          calc: expect.objectContaining({
            inputs: expect.objectContaining({
              w115: "SinexcelFaultWord115",
            }),
          }),
          alarm: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "gridWarning",
          calc: expect.objectContaining({
            inputs: expect.objectContaining({
              w118: "SinexcelFaultWord118",
            }),
          }),
        }),
        expect.objectContaining({
          name: "rsdEPOFault",
          calc: expect.objectContaining({
            inputs: expect.objectContaining({
              w106: "SinexcelFaultWord106",
            }),
          }),
        }),
      ])
    );

    const pcsFault = template.telemetry.find((tag) => tag.id === "pcsFault");
    expect(pcsFault?.ss40k).toEqual({
      name: "pcsFault",
      model: "40103",
    });
    expect(pcsFault?.calc?.expr).toContain("w115 >>> 0");
    expect(pcsFault?.calc?.expr).toContain("<< 3");

    const pcsWarning = template.telemetry.find((tag) => tag.id === "pcsWarning");
    expect(pcsWarning?.calc?.inputs).toEqual(
      expect.objectContaining({
        w36: "SinexcelStatusWord36",
        w37: "SinexcelStatusWord37",
      })
    );
    expect(pcsWarning?.calc?.expr).toContain("w36 >>> 5");
    expect(pcsWarning?.calc?.expr).toContain("w36 >>> 6");

    expect(
      template.telemetry.find((tag) => tag.id === "SinexcelFaultWord106")?.ss40k
    ).toEqual({
      name: "pcsFaultWord106",
      model: "50103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "SinexcelFaultWord121")?.ss40k
    ).toEqual({
      name: "pcsFaultWord121",
      model: "50103",
    });
  });

  test("Sinexcel Mini Gateway template exports cabinet alarms into product-neutral 50103", () => {
    const template = resolveTelemetryTemplate("mini_gateway");

    expect(template.device.name).toBe("udt_Sinexcel_Gateway_A_V2");
    expect(
      template.telemetry.find((tag) => tag.id === "GatewaySummaryWord")
    ).toMatchObject({
      function: "HRUS",
      address: 5999,
      alarm: true,
      bitfieldStatus: expect.objectContaining({
        "0": "Summary fault status",
        "1": "Summary alarm status",
      }),
      ss40k: {
        name: "gatewaySummaryWord",
        model: "50103",
      },
    });
    expect(
      template.telemetry.find((tag) => tag.id === "GatewayAirConditionerStatusWord")
    ).toMatchObject({
      function: "HRUS",
      address: 50000,
      alarm: true,
      ss40k: {
        name: "gatewayAirConditionerStatusWord",
        model: "50103",
      },
    });
    expect(
      template.telemetry.find((tag) => tag.id === "CabinetEpoFault")?.ss40k
    ).toEqual({
      name: "cabinetEpoFaultWord",
      model: "50103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "cabinetGatewayFaultWord")
    ).toMatchObject({
      alarm: true,
      calc: {
        inputs: expect.objectContaining({
          summary: "GatewaySummaryWord",
          epo: "CabinetEpoFault",
        }),
      },
      ss40k: {
        name: "cabinetGatewayFaultWord",
        model: "50103",
      },
    });
    expect(
      template.telemetry.find((tag) => tag.id === "cabinetGatewayWarningWord")
    ).toMatchObject({
      alarm: true,
      calc: {
        inputs: expect.objectContaining({
          summary: "GatewaySummaryWord",
          door: "CabinetDoorAlarm",
        }),
      },
      ss40k: {
        name: "cabinetGatewayWarningWord",
        model: "50103",
      },
    });
  });

  test("Sinexcel Mini PVDC module templates apply supplier address offsets", () => {
    const modules = [
      {
        profileName: "pvdc_module_1",
        statusAddress: 34032,
        fault40Address: 34040,
        fault48Address: 34048,
        powerAddress: 34053,
        energyHighAddress: 34082,
      },
      {
        profileName: "pvdc_module_2",
        statusAddress: 34332,
        fault40Address: 34340,
        fault48Address: 34348,
        powerAddress: 34353,
        energyHighAddress: 34382,
      },
      {
        profileName: "pvdc_module_3",
        statusAddress: 34632,
        fault40Address: 34640,
        fault48Address: 34648,
        powerAddress: 34653,
        energyHighAddress: 34682,
      },
    ];

    for (const module of modules) {
      const template = resolveTelemetryTemplate(module.profileName);
      const profile = adaptTelemetryTemplateToReadProfile(
        module.profileName,
        template
      );

      expect(profile.tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "PVDCStatusWord",
            address: module.statusAddress,
          }),
          expect.objectContaining({
            name: "PVDCFaultWord40",
            address: module.fault40Address,
            alarm: "Yes",
            supportingTag: "Yes",
            bitfieldStatus: true,
          }),
          expect.objectContaining({
            name: "PVDCFaultWord48",
            address: module.fault48Address,
            alarm: "Yes",
            supportingTag: "Yes",
            bitfieldStatus: true,
          }),
          expect.objectContaining({
            name: "PVSideTotalPower",
            address: module.powerAddress,
          }),
          expect.objectContaining({
            name: "PV1SideTotalPower",
            address: module.powerAddress + 1,
          }),
          expect.objectContaining({
            name: "PVGeneratedEnergyHighWord",
            address: module.energyHighAddress,
          }),
          expect.objectContaining({
            name: "PVGeneratedEnergy",
            calc: {
              inputs: {
                hi: "PVGeneratedEnergyHighWord",
                lo: "PVGeneratedEnergyLowWord",
              },
              expr: "(hi * 65536 + lo) * 0.1",
            },
          }),
        ])
      );

      const pvTotalPower = template.telemetry.find(
        (tag) => tag.id === "PVSideTotalPower"
      );
      expect(pvTotalPower?.ss40k).toEqual({
        name: "pPvTotal",
        model: "40101",
        exportMultiplier: 1000,
      });

      const pvEnergy = template.telemetry.find(
        (tag) => tag.id === "PVGeneratedEnergy"
      );
      expect(pvEnergy?.ss40k).toBeUndefined();

      const dcPvWarning = template.telemetry.find(
        (tag) => tag.id === "dcPvWarning"
      );
      expect(dcPvWarning?.ss40k).toEqual({
        name: "dcPvWarning",
        model: "40103",
      });
      expect(dcPvWarning?.calc?.inputs).toEqual({
        w46: "PVDCFaultWord46",
        w47: "PVDCFaultWord47",
      });
      expect(dcPvWarning?.calc?.expr).toContain("w46 >>> 6");
      expect(dcPvWarning?.calc?.expr).toContain("w47 >>> 10");

      const dcPvFault = template.telemetry.find(
        (tag) => tag.id === "dcPvFault"
      );
      expect(dcPvFault?.ss40k).toEqual({
        name: "dcPvFault",
        model: "40103",
      });
      expect(dcPvFault?.calc?.expr).toContain("w47 >>> 7");
      expect(dcPvFault?.calc?.expr).toContain("w47 >>> 8");
      expect(dcPvFault?.calc?.expr).toContain("w46 >>> 0");
    }
  });

  test("configured eGauge site-meter template maps useful SS40K readings", () => {
    const template = resolveTelemetryTemplate("eGauge_Site_Meter");
    const profile = adaptTelemetryTemplateToReadProfile(
      "eGauge_Site_Meter",
      template
    );

    expect(template.device.name).toBe("udt_eGauge_Site_Meter_V1");
    expect(resolveTelemetryTemplate("eGauge_Assisted_Living")).toEqual(template);
    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Utility_Total_Power",
          function: "IRF",
          address: 9006,
          supportingTag: "Yes",
        }),
        expect.objectContaining({
          name: "Backup_Load_Total_Power",
          function: "IRF",
          address: 9032,
        }),
        expect.objectContaining({
          name: "Load_Active_Power",
          calc: {
            inputs: {
              utility: "Utility_Total_Power",
              bess: "BESS_Total_Power",
            },
            expr: "utility + bess",
          },
        }),
        expect.objectContaining({
          name: "Utility_Import_Power",
          calc: {
            inputs: {
              utility: "Utility_Total_Power",
            },
            expr: "max(utility, 0)",
          },
        }),
        expect.objectContaining({
          name: "Utility_Export_Power",
          calc: {
            inputs: {
              utility: "Utility_Total_Power",
            },
            expr: "max(-utility, 0)",
          },
        }),
      ])
    );

    expect(
      template.telemetry.find((tag) => tag.id === "Backup_Load_Total_Power")
        ?.ss40k
    ).toEqual({
      name: "pBkupTot",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(
      template.telemetry.find((tag) => tag.id === "Load_Active_Power")?.ss40k
    ).toEqual({
      name: "pLoad",
      model: "40101",
      exportMultiplier: 1000,
    });
  });

  test("Sinexcel Mini Load template exposes supplier load telemetry block", () => {
    const template = resolveTelemetryTemplate("mini_load");
    const profile = adaptTelemetryTemplateToReadProfile("mini_load", template);

    expect(template.device.vendor).toBe("Sinexcel");
    expect(template.device.model).toBe("Mini Load");
    expect(profile.tags).toHaveLength(26);
    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "LoadTotalPowerFactor",
          function: "HR",
          address: 276,
          scale: expect.objectContaining({
            rawLow: 0,
            rawHigh: 100,
            engLow: 0,
            engHigh: 1,
          }),
        }),
        expect.objectContaining({
          name: "LoadTotalActivePower",
          function: "HR",
          address: 280,
          scale: expect.objectContaining({
            rawLow: 0,
            rawHigh: 10,
            engLow: 0,
            engHigh: 1,
          }),
        }),
        expect.objectContaining({
          name: "LoadL1ActivePower",
          function: "HR",
          address: 281,
        }),
        expect.objectContaining({
          name: "LoadFrequency",
          function: "HRUS",
          address: 295,
          scale: expect.objectContaining({
            rawLow: 0,
            rawHigh: 100,
            engLow: 0,
            engHigh: 1,
          }),
        }),
        expect.objectContaining({
          name: "LoadL3NVoltage",
          function: "HRUS",
          address: 301,
          scale: expect.objectContaining({
            rawLow: 0,
            rawHigh: 10,
            engLow: 0,
            engHigh: 1,
          }),
        }),
      ])
    );

    const loadTotalActivePower = template.telemetry.find(
      (tag) => tag.id === "LoadTotalActivePower"
    );
    expect(loadTotalActivePower?.ss40k).toEqual({
      name: "pLoad",
      model: "40101",
      exportMultiplier: 1000,
    });

    const loadL3NVoltage = template.telemetry.find(
      (tag) => tag.id === "LoadL3NVoltage"
    );
    expect(loadL3NVoltage?.ss40k).toEqual({
      name: "vLoadL3N",
      model: "40101",
    });
  });

  test("MBMU template keeps status/readback normalization contracts", () => {
    const template = resolveTelemetryTemplate("MBMU_280_ss40k");
    const profile = adaptTelemetryTemplateToReadProfile(
      "MBMU_280_ss40k",
      template
    );

    const powerOnState = profile.tags.find(
      (tag) => tag.name === "BMS_PowerOn_State"
    );
    expect(powerOnState?.enumStatus).toEqual({
      "0": "Power off ready",
      "1": "Power on ready",
      "2": "Power on fault",
      "3": "Power off fault",
    });

    const warningWord = profile.tags.find(
      (tag) => tag.name === "MBMU_Warnings_Word0000"
    );
    expect(warningWord?.alarm).toBe("Yes");
    expect(warningWord?.supportingTag).toBe("No");

    const readbackCommand = profile.tags.find((tag) => tag.name === "EMS_Cmd");
    expect(readbackCommand?.pollClass).toBe("normal");
    expect(readbackCommand?.enumStatus).toBeUndefined();

    const rackDisable = profile.tags.find(
      (tag) => tag.name === "Racks_disable_Command"
    );
    expect(rackDisable?.pollClass).toBe("normal");
  });

  test("Ampace BMS template exposes Mini control input tags", () => {
    const template = resolveTelemetryTemplate("AMPACE_Mini_ss40k");
    const profile = adaptTelemetryTemplateToReadProfile(
      "AMPACE_Mini_ss40k",
      template
    );

    expect(template.device.vendor).toBe("Ampace");
    expect(template.device.name).toBe("udt_Ampace_A_V3");
    expect(resolveTelemetryTemplate("udt_Ampace_A_V3").device.model).toBe(
      "BMS"
    );

    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "BcuCount",
          function: "HRUS",
          address: 0,
          pollClass: "startup",
        }),
        expect.objectContaining({
          name: "BamsSoc",
          function: "HRUS",
          address: 62006,
          scale: expect.objectContaining({
            rawLow: 0,
            rawHigh: 1000,
            engLow: 0,
            engHigh: 1,
          }),
        }),
        expect.objectContaining({
          name: "BamsPermitChgCurrent",
          function: "HRUI",
          address: 62012,
          scale: expect.objectContaining({
            rawLow: 0,
            rawHigh: 10,
            engLow: 0,
            engHigh: 1,
          }),
        }),
        expect.objectContaining({
          name: "BamsPermitDsgCurrent",
          function: "HRUI",
          address: 62014,
        }),
        expect.objectContaining({
          name: "BamsDischargePower",
          calc: {
            inputs: {
              p: "BamsPower",
            },
            expr: "max(p, 0)",
          },
        }),
        expect.objectContaining({
          name: "BamsChargePower",
          calc: {
            inputs: {
              p: "BamsPower",
            },
            expr: "max(-p, 0)",
          },
        }),
        expect.objectContaining({
          name: "BamsMaxCellVol",
          function: "HRUS",
          address: 62021,
        }),
        expect.objectContaining({
          name: "BamsMinCellVol",
          function: "HRUS",
          address: 62024,
        }),
        expect.objectContaining({
          name: "BamsMaxCellT",
          function: "HR",
          address: 62029,
        }),
        expect.objectContaining({
          name: "BamsMinCellT",
          function: "HR",
          address: 62032,
        }),
        expect.objectContaining({
          name: "BamsProtAlarm0_8",
          function: "HRUI_64",
          address: 62122,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
          noMerge: true,
        }),
        expect.objectContaining({
          name: "BamsSysFaultCode0_8",
          function: "HRUI_64",
          address: 62126,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "BamsOtherErrCode0_8",
          function: "HRUI_64",
          address: 62130,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "BamsHwErrCode0_8",
          function: "HRUI_64",
          address: 62134,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "BamsFaultNotAllowHvFlg",
          function: "HRUS",
          address: 62146,
          alarm: "Yes",
          supportingTag: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "batWarning",
          calc: expect.objectContaining({
            inputs: expect.objectContaining({
              p: "BamsProtAlarm0_8",
              h: "BamsHwErrCode0_8",
            }),
          }),
          alarm: "Yes",
          bitfieldStatus: true,
        }),
        expect.objectContaining({
          name: "batFault",
          calc: expect.objectContaining({
            inputs: expect.objectContaining({
              p: "BamsProtAlarm0_8",
              s: "BamsSysFaultCode0_8",
            }),
          }),
          alarm: "Yes",
          bitfieldStatus: true,
        }),
      ])
    );

    const batWarning = template.telemetry.find((tag) => tag.id === "batWarning");
    expect(batWarning?.ss40k).toEqual({
      name: "batWarning",
      model: "40103",
    });
    expect(batWarning?.calc?.expr).toContain("<< 2");

    const batFault = template.telemetry.find((tag) => tag.id === "batFault");
    expect(batFault?.ss40k).toEqual({
      name: "batFault",
      model: "40103",
    });
    expect(batFault?.calc?.expr).toContain("<< 1");
    expect(
      template.telemetry.find((tag) => tag.id === "BamsProtAlarm0_8")?.ss40k
    ).toBeUndefined();
    expect(
      template.telemetry.find((tag) => tag.id === "BamsSysFaultCode0_8")?.ss40k
    ).toBeUndefined();
    expect(
      template.telemetry.find((tag) => tag.id === "BamsOtherErrCode0_8")?.ss40k
    ).toBeUndefined();
    expect(
      template.telemetry.find((tag) => tag.id === "BamsHwErrCode0_8")?.ss40k
    ).toBeUndefined();
    expect(
      template.telemetry.find((tag) => tag.id === "BamsHwStaCode0_8")?.ss40k
    ).toBeUndefined();

    expect(
      template.telemetry.find((tag) => tag.id === "batteryProtectionWarningWord")?.ss40k
    ).toEqual({
      name: "batteryProtectionWarningWord",
      model: "52103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "batteryProtectionFaultWord")?.ss40k
    ).toEqual({
      name: "batteryProtectionFaultWord",
      model: "52103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "batterySystemFaultWordA")?.ss40k
    ).toEqual({
      name: "batterySystemFaultWordA",
      model: "52103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "batterySystemFaultWordA")?.notes
    ).toContain("Do not pack any alarm into output bit 31");
    expect(
      template.telemetry.find((tag) => tag.id === "batterySystemFaultWordB")?.ss40k
    ).toEqual({
      name: "batterySystemFaultWordB",
      model: "52103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "batteryOtherErrorWordA")?.ss40k
    ).toEqual({
      name: "batteryOtherErrorWordA",
      model: "52103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "batteryOtherErrorWordA")?.notes
    ).toContain("Do not pack any alarm into output bit 31");
    expect(
      template.telemetry.find((tag) => tag.id === "batteryOtherErrorWordB")?.ss40k
    ).toEqual({
      name: "batteryOtherErrorWordB",
      model: "52103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "batteryHardwareErrorWord")?.ss40k
    ).toEqual({
      name: "batteryHardwareErrorWord",
      model: "52103",
    });
    expect(
      template.telemetry.find((tag) => tag.id === "batteryHardwareStatusWord")?.ss40k
    ).toEqual({
      name: "batteryHardwareStatusWord",
      model: "52103",
    });

    expect(
      template.telemetry.find((tag) => tag.id === "BamsDischargePower")?.ss40k
    ).toEqual({
      name: "pBatDischg",
      model: "40101",
      exportMultiplier: 1000,
    });
    expect(
      template.telemetry.find((tag) => tag.id === "BamsChargePower")?.ss40k
    ).toEqual({
      name: "pBatChg",
      model: "40101",
      exportMultiplier: 1000,
    });

    const readPlan = buildReadPlan(profile, instance, compilerEnv);
    const bamsProtAlarmBlock = readPlan.blocks.find((block: any) =>
      block.map.some((item: any) => item.name === "BamsProtAlarm0_8")
    );
    expect(bamsProtAlarmBlock).toMatchObject({
      function: "HRUI_64",
      start: 62122,
      quantity: 4,
    });
  });

  test("AMPACE Mini BAMS other-error U64 uses vendor byte order for SS52K alarms", () => {
    const template = resolveTelemetryTemplate("AMPACE_Mini_ss40k");
    const profile = adaptTelemetryTemplateToReadProfile("BMS", template);
    const readPlan = buildReadPlan(profile, instance, compilerEnv);
    const blockIdx = readPlan.blocks.findIndex((block: any) =>
      block.map.some((item: any) => item.name === "BamsOtherErrCode0_8")
    );

    expect(blockIdx).toBeGreaterThanOrEqual(0);
    expect(readPlan.blocks[blockIdx]).toMatchObject({
      function: "HRUI_64",
      start: 62130,
      quantity: 4,
    });

    const result = simulateReply(readPlan, blockIdx, [0, 0, 0, 0x0040]);

    expect(result.out2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagID: "BamsOtherErrCode0_8",
          value: "0x0000000000000040",
        }),
        expect.objectContaining({
          tagID: "batteryOtherErrorWordA",
          value: 0,
        }),
        expect.objectContaining({
          tagID: "batteryOtherErrorWordB",
          value: 2,
        }),
      ])
    );
  });

  test("Ampace BCU 42K JSON template shifts by BCU index and inverts current", () => {
    const baseTemplate = resolveTelemetryTemplate("AMPACE_Mini_BCU_42k");
    expect(baseTemplate.telemetry.find((tag) => tag.id === "SerialNumber")).toMatchObject({
      function: "HRUI",
      address: 39,
      pollClass: "startup",
    });

    const template = buildAmpaceBcu42kTemplate({
      bcuIndex: 1,
      modelName: "MINI-90-135-288",
    });
    const profile = adaptTelemetryTemplateToReadProfile(
      "AMPACE_Mini_BCU2_42k",
      template
    );

    expect(profile.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "SerialNumber",
          function: "HRUI",
          address: 50239,
          pollClass: "startup",
        }),
        expect.objectContaining({
          name: "AmpaceCurrentRaw",
          function: "HR",
          address: 50201,
        }),
        expect.objectContaining({
          name: "BcuCurrent",
          calc: {
            inputs: { current: "AmpaceCurrentRaw" },
            expr: "-current",
          },
        }),
        expect.objectContaining({
          name: "BcuPower",
          calc: {
            inputs: { voltage: "InternalSumVoltage", current: "BcuCurrent" },
            expr: "voltage * current",
          },
        }),
        expect.objectContaining({
          name: "BcuBatteryFault",
          calc: expect.objectContaining({
            inputs: {
              p3: "ProtectAlarmLevel3",
              s3: "SysFaultLevel3",
              h3: "HwErrLevel3",
            },
          }),
          alarm: "Yes",
        }),
      ])
    );
  });

  test("Delta global state emits a fresh _str sample from enumStatus", () => {
    const fullProfile = adaptTelemetryTemplateToReadProfile(
      "Delta_280_ss40k",
      resolveTelemetryTemplate("Delta_280_ss40k")
    );
    const targetTag = fullProfile.tags.find(
      (tag) => tag.name === "SYSTEM_GLOBAL_STATE"
    );
    expect(targetTag).toBeDefined();

    const profile = {
      profileId: "Delta_280_state_only",
      defaults: fullProfile.defaults,
      tags: [targetTag],
    };

    const plan = buildReadPlan(profile, instance, compilerEnv);

    const res = reader.onReply(
      {
        _reader: { equipmentId: plan.equipmentId, blockIdx: 0 },
        payload: [3],
      },
      plan,
      readerEnv
    );

    expect(res.out2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagID: "SYSTEM_GLOBAL_STATE",
          value: 3,
          enumLabel: "GT Normal",
        }),
        expect.objectContaining({
          tagID: "SYSTEM_GLOBAL_STATE_str",
          value: "GT Normal",
          rawValue: 3,
        }),
      ])
    );
  });
});
