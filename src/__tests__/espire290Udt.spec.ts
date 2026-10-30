import * as fs from "fs";
import * as path from "path";
import {
  resolveTelemetryTemplate,
  type TelemetryTemplateEntry,
} from "../telemetry/templateAdapter";
import { buildEspire290ClusterTemplate, buildEspire290TmuTemplate } from "../telemetry";

// The legacy UDTs are generated from the ss templates by
// scripts/build-espire290-udt.py - this catches them drifting apart.
interface UdtTag {
  name: string;
  modbusType: string;
  modbusAddress: number;
}

function loadUdt(file: string): { name: string; tags: UdtTag[] } {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "templates", file), "utf8"));
}

function expectSameRegisters(udtFile: string, entries: TelemetryTemplateEntry[]) {
  const udt = loadUdt(udtFile);
  const physical = entries.filter((e) => typeof e.address === "number");
  expect(udt.tags.map((t) => t.name)).toEqual(physical.map((e) => e.id));
  for (const entry of physical) {
    const tag = udt.tags.find((t) => t.name === entry.id)!;
    expect({ name: tag.name, fn: tag.modbusType, address: tag.modbusAddress }).toEqual({
      name: entry.id,
      fn: entry.function,
      address: entry.address,
    });
  }
}

describe("eSpire290 legacy UDTs", () => {
  test("CMS UDT = system template telemetry + commands", () => {
    const template = resolveTelemetryTemplate("eSpire290_OLP_CMS_ss_TEMPLATE");
    expectSameRegisters("Original_290_OLP_CMS_udt.json", [
      ...template.telemetry,
      ...(template.commands ?? []),
    ]);
  });

  test("BMS1 / TMU1 UDTs = offset templates at cluster 1 addresses", () => {
    expectSameRegisters(
      "Original_290_OLP_BMS1_udt.json",
      buildEspire290ClusterTemplate({ clusterIndex: 0 }).telemetry
    );
    expectSameRegisters(
      "Original_290_OLP_TMU1_udt.json",
      buildEspire290TmuTemplate({ tmuIndex: 0 }).telemetry
    );
  });
});
