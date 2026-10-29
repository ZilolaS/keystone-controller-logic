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
      path.resolve(__dirname, "../flows/keystone_legacy_addition_flow.json"),
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
    expect(body).toContain("endpoint === 'EdgeScheduler'");
    expect(body).toContain("method === 'CreateJob'");
    expect(body).toContain("method === 'StartJob'");
    expect(body).toContain("method === 'StopJob'");
    expect(body).toContain("method === 'DeleteJob'");
    expect(body).toContain("method === 'GetJob'");
    expect(body).toContain("method === 'GetJobList'");
    expect(body).toContain("edgeSchedulerJobs");
    expect(body).toContain("schedulePlans");
  });

  test("accepts V2.0 direct job data and adapts it into controller schedules", () => {
    const body = node("sched_api_esr_handler").func || "";

    expect(body).toContain("jobFromData");
    expect(body).toContain("const job = jobFromData(data)");
    expect(body).toContain("payloadJson");
    expect(body).toContain("durationSec / 60");
    expect(body).toContain("start: p.start === null ? null");
    expect(body).toContain("start: isCron ? null : startIso");
    expect(body).toContain("time: isCron ? undefined");
    expect(body).toContain("jobListItem");
    expect(body).toContain("intervalSec is reserved");
    expect(body).toContain("localWallMsToEpochSec");
    expect(body).toContain("previousLocalSec");
    expect(body).toContain("cronTimeCandidates");
    expect(body).toContain("cronDateMatches");
    expect(body).not.toContain("for (let minute = firstMinute");
  });

  test("keeps VPP scheduling payloads as canonical EdgeScheduler command plans", () => {
    const body = node("sched_api_esr_handler").func || "";

    expect(body).toContain("edgeSchedulerStrategyFromPayload");
    expect(body).toContain("command === 'peakShaving'");
    expect(body).toContain("command === 'maximizePvSelfConsumption'");
    expect(body).toContain("command === 'charge' || command === 'discharge'");
    expect(body).toContain("payload: job.payload");
    expect(body).toContain("payloadJson");
    expect(body).toContain("minSocPct");
    expect(body).toContain("maxDischargePowerPct");
    expect(body).toContain("constraints");
    expect(body).toContain("unsupported payload field");
    expect(body).toContain("holdAtThreshold");
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
