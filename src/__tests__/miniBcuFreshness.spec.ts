import fs from "fs";
import path from "path";
import { buildReadPlan } from "../compiler/compiler";
import * as reader from "../reader/reader";
import { buildAmpaceBcu42kTemplate } from "../telemetry/ampaceBcu42k";
import { adaptTelemetryTemplateToReadProfile } from "../telemetry/templateAdapter";
import type { ReadPlan } from "../types";

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "flows/functions/ampace-bcu-power.js"), "utf8");
const updatePower = new Function("store", "equipmentName", "bcuEquipmentInfo",
  source + "\nupsertBcuPower(store, equipmentName);");
const compilerEnv = { maxQty: 120, maxSpan: 80, maxHole: 4, pollFast: 250, pollNormal: 1000, pollSlow: 300000 };
const readerEnv = { MODBUS_ZERO_BASED: false, CALC_INPUT_MAX_AGE_MS: 15000 };
const now = Date.parse("2026-10-21T01:00:00Z");
type Block = {start:number;quantity:number;pollMs:number;map:Array<{tagID:string}>};

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
afterEach(() => { jest.useRealTimers(); });

test.each([0, 1])("BCU %i polls dynamic values in compact blocks without accelerating the entire template", bcuIndex => {
  const template = buildAmpaceBcu42kTemplate({ bcuIndex });
  const profile = adaptTelemetryTemplateToReadProfile("AMPACE_Mini_BCU_42k", template);
  const plan: ReadPlan = buildReadPlan(profile, {equipmentId:`Battery_BCU_${bcuIndex+1}`,serverKey:"BMS",unitId:1}, compilerEnv);
  for (const id of ["InternalSumVoltage", "AmpaceCurrentRaw", "USOC", "HvPowOnState"]) {
    const blocks = plan.blocks.filter((b:Block) => b.map.some(t => t.tagID === id));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].pollMs).toBe(1000);
  }
  expect(template.telemetry.find(t => t.id === "CycleCount")?.pollClass).toBe("slow");
  const dynamic: Block[] = plan.blocks.filter((b:Block) => b.pollMs === 1000);
  expect(dynamic).toHaveLength(3);
  // Adjacent slow points share a read; retain the compiler's existing merged-block behavior.
  expect(dynamic.find(b => b.start === 50000 + bcuIndex * 200)?.quantity).toBe(24);
  expect(plan.blocks.some((b:Block) => b.pollMs === 300000)).toBe(true);
});

test("both shared flows contain the same freshness-safe helper", () => {
  for (const name of ["unified_platform_runtime_flow.json", "keystone_legacy_addition_flow.json"]) {
    const flow = JSON.parse(fs.readFileSync(path.join(root,"flows",name),"utf8"));
    expect(flow.find((n: any) => n.id === "platform_store_telemetry").func).toContain(source.trim());
  }
});

function samples(current: unknown = 2) {
  return [
    {tagID:"Battery_BCU_1.InternalSumVoltage",value:640,timestamp:new Date(now-2000).toISOString()},
    {tagID:"Battery_BCU_1.AmpaceCurrentRaw",value:current,timestamp:new Date(now-1000).toISOString()},
    {tagID:"Battery_BCU_1.BcuPower",value:12345,timestamp:new Date(now).toISOString()},
  ];
}
function calculated(input: any[]) {
  const store = {Battery_BCU_1:input};
  updatePower(store,"Battery_BCU_1",()=>({parent:"Battery",index:1}));
  return store.Battery_BCU_1.find(s=>s.tagID.endsWith(".BcuPower"));
}
test.each([2, -2, 0])("BCU power preserves sign, zero and oldest input time for current %s", current => {
  const input = samples(current);
  expect(calculated(input)).toMatchObject({value:current === 0 ? 0 : -640*current,timestamp:new Date(now-2000).toISOString()});
  jest.setSystemTime(now+5000);
  expect(calculated(input)?.timestamp).toBe(new Date(now-2000).toISOString());
});
test.each(["stale", "bad", "uncertain", "missing", "invalid-time", "future", "expired", "null"])("BCU power does not refresh %s inputs", problem => {
  const input: any[] = samples();
  if(problem === "stale") input[1].stale = true;
  if(problem === "bad" || problem === "uncertain") input[1].quality = problem;
  if(problem === "missing") input.splice(1,1);
  if(problem === "invalid-time") input[1].timestamp = "invalid";
  if(problem === "future") input[1].timestamp = now+1;
  if(problem === "expired") input[1].timestamp = now-15001;
  if(problem === "null") input[1].value = null;
  expect(calculated(input)).toBeUndefined();
});

test("reader calculations retain oldest dependency time on unrelated replies and expire correctly", () => {
  const profile: any = {profileId:"freshness",defaults:{byteOrder:"BE",wordOrder32:"ABCD"},tags:[
    {name:"voltage",function:"HRUS",address:1,pollClass:"normal"},
    {name:"current",function:"HR",address:20,pollClass:"normal"},
    {name:"other",function:"HRUS",address:40,pollClass:"normal"},
    {name:"power",calc:{inputs:{v:"voltage",a:"current"},expr:"v*a"}},
  ]};
  const plan: ReadPlan = buildReadPlan(profile,{equipmentId:"freshness-test",serverKey:"BMS",unitId:1},compilerEnv);
  const reply = (tag:string,value:number) => reader.onReply({
    _reader:{equipmentId:plan.equipmentId,blockIdx:plan.blocks.findIndex((b:Block)=>b.map.some(t=>t.tagID===tag))},
    payload:[value],
  },plan,readerEnv).out2;
  reader.start(plan,readerEnv,()=>{});
  try {
    reply("voltage",640);
    jest.setSystemTime(now+1000);
    expect(reply("current",2).find((t:any)=>t.tagID==="power")).toMatchObject({value:1280,timestamp:now});
    jest.setSystemTime(now+9000);
    expect(reply("other",1).find((t:any)=>t.tagID==="power")).toMatchObject({value:1280,timestamp:now});
    jest.setSystemTime(now+15001);
    expect(reply("other",2).find((t:any)=>t.tagID==="power")).toBeUndefined();
    reply("voltage",641);
    expect(reply("current",0).find((t:any)=>t.tagID==="power")).toMatchObject({value:0,timestamp:now+15001});
  } finally { reader.stop(plan.equipmentId); }
});
