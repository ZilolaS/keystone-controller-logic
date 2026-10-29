import { readFileSync } from "fs";
import path from "path";

type FlowNode = {
  id?: string;
  type?: string;
  url?: string;
  method?: string;
  func?: string;
};

describe.each(["unified_platform_runtime_flow.json", "keystone_legacy_addition_flow.json"])(
  "%s BCU startup", (filename) => {
    const nodes = JSON.parse(readFileSync(path.resolve(__dirname, "../flows", filename), "utf8")) as FlowNode[];

    test("keeps template power scaling and starts readers from parent telemetry", () => {
      function context(values: Record<string, any> = {}) {
        return { get: (key: string) => values[key], set: (key: string, value: any) => { values[key] = value; } };
      }
      const generated = {
        AMPACE_BCU_1: {
          profileName: "AMPACE_Mini_BCU_42k", route: "slot2",
          template: { telemetry: [{ id: "BcuPower", ss40k: { exportMultiplier: 1 }, calc: {} }] },
        },
      };
      const lib = { telemetry: {
        buildAmpaceBcu42kEquipmentConfig: jest.fn(() => generated),
        buildSs40kLookup: jest.fn(() => ({ lookup: {}, equipmentToProfile: {}, modelIndexMap: {} })),
      } };
      const globalContext = context({ lib, unifiedTelemetry: {} });
      const flowContext = context({
        controlConfig: { system: { systemProfile: "MINI-60-90-122-480" } },
        telemetryReaderConfig: [{ equipmentId: "AMPACE", profileName: "AMPACE_Mini_ss40k", route: "slot2" }],
        telemetryEquipmentConfig: { AMPACE: { route: "slot2" } },
      });
      const node = { send: jest.fn(), status: jest.fn() };
      const body = nodes.find(n => n.id === "platform_store_telemetry")!.func!;
      const execute = new Function("msg", "global", "flow", "context", "node", "setTimeout", body);
      expect(() => execute({ equipmentId: "AMPACE", payload: [{ tagID: "BcuCount", value: 1 }] },
        globalContext, flowContext, context(), node, (callback: () => void) => callback())).not.toThrow();
      expect(lib.telemetry.buildAmpaceBcu42kEquipmentConfig).toHaveBeenCalled();
      expect(generated.AMPACE_BCU_1.template.telemetry[0].ss40k.exportMultiplier).toBe(1);
      expect(node.send.mock.calls.some(([outputs]) => outputs[1]?.payload?.cmd === "compile")).toBe(true);
      expect(node.send.mock.calls.some(([outputs]) => outputs[1]?.payload?.cmd === "start")).toBe(true);
      expect(nodes.find(n => n.id === "platform_setup_telemetry")!.func).not.toContain("tag.ss40k.exportMultiplier = 10");
    });
  }
);

describe("unified platform runtime flow", () => {
  const flow = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../flows/keystone_legacy_addition_flow.json"),
      "utf8"
    )
  ) as FlowNode[];

  function functionBody(id: string): string {
    const node = flow.find((item) => item.id === id);
    expect(node).toBeDefined();
    expect(node?.type).toBe("function");
    return node?.func || "";
  }

  test("uses unified telemetry store for runtime APIs", () => {
    expect(functionBody("platform_read_telemetry")).toContain(
      "global.get('unifiedTelemetry')"
    );
    expect(functionBody("platform_status_handler")).toContain(
      "global.get('unifiedTelemetry')"
    );
    expect(functionBody("platform_sched_api_rt_handler")).toContain(
      "lastUnifiedControlCycle"
    );
  });

  test("prefers configured total PV over the raw DC-only fallback", () => {
    expect(functionBody("platform_sched_api_rt_handler")).toContain(
      "telemetry.pvPowerKw ?? telemetry.pvKw ?? directPvPowerKw"
    );
  });

  test("does not use hardcoded eGauge/default waveform signal sources", () => {
    const runtimeBodies = [
      "platform_run",
      "platform_sched_api_rt_handler",
      "platform_read_telemetry",
      "platform_status_handler",
    ].map(functionBody);

    for (const body of runtimeBodies) {
      expect(body).not.toContain("Meter.Utility_Total_Power");
      expect(body).not.toContain("Meter2.Solar");
      expect(body).not.toContain("PCS.SYSTEM_POWER_ACTIVE_ALL");
      expect(body).not.toContain("node-red-test-waveform");
      expect(body).not.toContain("global.get('telemetry')");
    }
  });

  test("uses Nano PCS defaults for telemetry and writers", () => {
    const telemetrySetup = functionBody("platform_setup_telemetry");
    const writerSetup = functionBody("platform_setup_writers");

    expect(telemetrySetup).toContain("192.168.1.7");
    expect(telemetrySetup).toContain("NANO_Hybrid_PCS_ss40k");

    expect(writerSetup).toContain("192.168.1.7");
    expect(writerSetup).toContain("const isNano = /^NANO");
    expect(writerSetup).toContain("NANO_Hybrid_PCS_ss40k");
    expect(writerSetup).toContain("isNano ? ['PCS']");
  });

  test("uses the V2.0 EdgeScheduler handler on the unified /api/esr route", () => {
    const body = functionBody("platform_sched_api_esr_handler");

    expect(body).toContain("endpoint === 'EdgeScheduler'");
    expect(body).toContain("jobFromData");
    expect(body).toContain("const job = jobFromData(data)");
    expect(body).toContain("payloadJson");
    expect(body).toContain("durationSec / 60");
    expect(body).toContain("start: p.start === null ? null");
    expect(body).toContain("start: isCron ? null : startIso");
    expect(body).toContain("time: isCron ? undefined");
    expect(body).toContain("cronTimeCandidates");
    expect(body).not.toContain("for (let minute = firstMinute");
    expect(body).toContain("jobListItem");
    expect(body).toContain("method === 'CreateJob'");
    expect(body).toContain("localWallMsToEpochSec");
    expect(body).toContain("previousLocalSec");
    expect(body).toContain("edgeResponse");
  });
});

describe("standalone unified platform runtime flow", () => {
  const flow = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../flows/unified_platform_runtime_flow.json"),
      "utf8"
    )
  ) as FlowNode[];

  function node(id: string): FlowNode {
    const found = flow.find((item) => item.id === id);
    expect(found).toBeDefined();
    return found || {};
  }

  test("exposes products API for AWS shadow publishing", () => {
    expect(node("platform_products_http")).toMatchObject({
      type: "http in",
      url: "/api/products",
      method: "get",
    });

    expect(node("platform_products_request").func).toContain(
      "endPoint: 'Product'"
    );
    expect(node("platform_products_request").func).toContain(
      "msg.req.body = msg.payload"
    );
  });

  test("exposes CGI command API for AWSFeed RPC requests", () => {
    expect(node("platform_control_command_http")).toMatchObject({
      type: "http in",
      url: "/api/control/command",
      method: "post",
    });
  });

  test("uses site signal mapping for total PV in realtime UI data", () => {
    expect(node("platform_sched_api_rt_handler").func).toContain(
      "telemetry.pvPowerKw ?? telemetry.pvKw ?? directPvPowerKw"
    );
  });

  test("uses the same validated EdgeScheduler implementation as the legacy addition flow", () => {
    const legacyFlow = JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../flows/keystone_legacy_addition_flow.json"),
        "utf8"
      )
    ) as FlowNode[];
    const legacyHandler = legacyFlow.find(
      (item) => item.id === "sched_api_esr_handler"
    );
    const standaloneHandler = node("platform_sched_api_esr_handler");

    expect(legacyHandler).toBeDefined();
    expect(standaloneHandler.func).toBe(legacyHandler?.func);
    expect(standaloneHandler.func).toContain("edgeProtocolError");
    expect(standaloneHandler.func).toContain("rejectUnknownPayloadFields");
    expect(standaloneHandler.func).toContain("activeRunningJobId");
    expect(standaloneHandler.func).toContain("start: isCron ? null : startIso");
  });
});
