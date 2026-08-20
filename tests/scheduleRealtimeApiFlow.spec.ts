import { readFileSync } from "fs";
import path from "path";

type FlowNode = {
  id?: string;
  type?: string;
  url?: string;
  method?: string;
  func?: string;
};

describe("schedule realtime API flow", () => {
  const flow = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../flows/schedule_realtime_api_flow.json"),
      "utf8"
    )
  ) as FlowNode[];

  function node(id: string): FlowNode {
    const found = flow.find((item) => item.id === id);
    expect(found).toBeDefined();
    return found || {};
  }

  test("exposes ESR and AWSFeedModule command routes", () => {
    expect(node("sched_api_esr_http")).toMatchObject({
      type: "http in",
      url: "/api/esr",
      method: "post",
    });
    expect(node("sched_api_control_command_http")).toMatchObject({
      type: "http in",
      url: "/api/control/command",
      method: "post",
    });
  });

  test("supports EdgeScheduler VPP command methods", () => {
    const body = node("sched_api_esr_handler").func || "";

    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("EdgeScheduler");
    expect(body).toContain("commandId");
    expect(body).toContain("methodKey === 'createjob'");
    expect(body).toContain("methodKey === 'startjob'");
    expect(body).toContain("methodKey === 'stopjob'");
    expect(body).toContain("methodKey === 'deletejob'");
    expect(body).toContain("methodKey === 'getjob'");
    expect(body).toContain("methodKey === 'getjoblist'");
    expect(body).toContain("edgeSchedulerJobs");
    expect(body).toContain("schedulePlans");
  });

  test("accepts V1.6 job envelopes and adapts them into controller schedules", () => {
    const body = node("sched_api_esr_handler").func || "";

    expect(body).toContain("jobFromData");
    expect(body).toContain("data.job");
    expect(body).toContain("payloadJson");
    expect(body).toContain("durationSec / 60");
    expect(body).toContain("time: isCron ? undefined");
    expect(body).toContain("jobListItem");
  });

  test("keeps VPP scheduling payloads as canonical EdgeScheduler command plans", () => {
    const body = node("sched_api_esr_handler").func || "";

    expect(body).toContain("edgeSchedulerScheduleInfoFromPayload");
    expect(body).toContain("peakshaving");
    expect(body).toContain("maximizepvselfconsumption");
    expect(body).toContain("command === 'charge' || command === 'discharge'");
    expect(body).toContain("payload: job.payload");
    expect(body).toContain("payloadJson");
    expect(body).toContain("minSocPct");
    expect(body).toContain("maxDischargePowerPct");
    expect(body).toContain("constraints");
  });

  test("supports Keystone CGI discovery commands used by FMP equipment refresh", () => {
    const body = node("sched_api_esr_handler").func || "";

    expect(body).toContain("buildKeystoneProducts");
    expect(body).toContain("buildGuardianInfo");
    expect(body).toContain("endpointKey === 'product' && methodKey === 'getlist'");
    expect(body).toContain("endpointKey === 'guardian' && methodKey === 'getinfo'");
    expect(body).toContain("Keystone-Controller");
    expect(body).toContain("eSpire-Mini-PCS");
    expect(body).toContain("eSpire-Mini-BMS");
  });
});
