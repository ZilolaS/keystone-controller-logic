import { readFileSync } from "fs";
import path from "path";

type FlowNode = {
  id?: string;
  type?: string;
  url?: string;
  method?: string;
  func?: string;
};

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
    expect(body).toContain("time: isCron ? undefined");
    expect(body).toContain("jobListItem");
    expect(body).toContain("method === 'CreateJob'");
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
});
