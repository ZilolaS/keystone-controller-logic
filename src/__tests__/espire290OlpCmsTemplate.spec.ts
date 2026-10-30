import {
  resolveTelemetryTemplate,
  adaptTelemetryTemplateToReadProfile,
} from "../telemetry/templateAdapter";
import {
  buildEspire290ClusterTemplate,
  buildEspire290EquipmentConfig,
  buildEspire290TmuTemplate,
  espire290ClusterControlBase,
} from "../telemetry";

// eSpire 290 = OLiPower Omni BL 290 CMS. Addresses come from
// OLP290_CMS_ETH2_V3.3 - see docs/eSpire290_OLP_CMS_Modbus_Register_Map.md.
describe("eSpire290 OLP CMS templates", () => {
  test("system template normalizes through the real adapter", () => {
    const template = resolveTelemetryTemplate("eSpire290_OLP_CMS_ss_TEMPLATE");
    expect(template.device.protocol).toBe("modbus-tcp");
    const profile = adaptTelemetryTemplateToReadProfile("eSpire290_OLP_CMS_ss_TEMPLATE", template);
    expect(profile.tags.length).toBe(template.telemetry.length + (template.commands?.length ?? 0));
  });

  test("key CMS points sit at the vendor addresses with the data-rule signedness", () => {
    const template = resolveTelemetryTemplate("eSpire290_OLP_CMS_ss_TEMPLATE");
    const byId = new Map(template.telemetry.map((t) => [t.id, t]));
    expect(byId.get("CmsSoc")).toMatchObject({ function: "IRUS", address: 31962 });
    expect(byId.get("CmsCurrent")).toMatchObject({ function: "IR", address: 31965 });
    expect(byId.get("CmsHvOnStatus")).toMatchObject({ address: 31953 });
    expect(byId.get("CmsFaultWord1")).toMatchObject({ address: 31973 });
    // Sheet V3.3 puts the CMS limits at 3278x; strategy doc V0.4 text says 3178x (typo).
    expect(byId.get("CmsAllowedChargePower")).toMatchObject({ function: "IR", address: 32784 });
    expect(byId.get("CmsAllowedDischargePower")).toMatchObject({ function: "IR", address: 32785 });
    expect(byId.get("ImuStatus")).toMatchObject({ address: 34000 });
  });

  test("control registers use the V3.0+ addresses", () => {
    const template = resolveTelemetryTemplate("eSpire290_OLP_CMS_ss_TEMPLATE");
    const byId = new Map((template.commands ?? []).map((c) => [c.id, c.address]));
    expect(byId.get("SetSysWorkingMode")).toBe(40007);
    expect(byId.get("SetSysOperationMode")).toBe(40019);
    expect(byId.get("SetBmsConfigNumber")).toBe(40032);
    expect(byId.get("SetBmsEnableStatus")).toBe(40033);
    expect(byId.get("ResetCms")).toBe(40214);
    expect(byId.get("SetCmsHvOn")).toBe(40215);
    expect(byId.get("SetCmsHvOff")).toBe(40216);
    for (let n = 1; n <= 16; n += 1) {
      const base = espire290ClusterControlBase(n - 1);
      expect(byId.get(`Bms${n}Reset`)).toBe(base);
      expect(byId.get(`Bms${n}HvOn`)).toBe(base + 1);
      expect(byId.get(`Bms${n}HvOff`)).toBe(base + 2);
      expect(byId.get(`Bms${n}SoftStart`)).toBe(base + 7);
    }
    expect(byId.get("Bms16Reset")).toBe(40420);
  });

  test("cluster template shifts by 50 per cluster", () => {
    const first = buildEspire290ClusterTemplate({ clusterIndex: 0 });
    const third = buildEspire290ClusterTemplate({ clusterIndex: 2 });
    const addr = (doc: typeof first, id: string) => doc.telemetry.find((t) => t.id === id)?.address;
    expect(addr(first, "HvOnStatus")).toBe(31981);
    expect(addr(first, "Soc")).toBe(31984);
    expect(addr(first, "FaultCode1")).toBe(32008);
    expect(addr(first, "WarningCode1")).toBe(32018);
    expect(addr(first, "ContactorOutputs")).toBe(32028);
    expect(addr(first, "BmsSelfCheck")).toBe(32030);
    expect(addr(third, "HvOnStatus")).toBe(32081);
    expect(third.telemetry.find((t) => t.id === "ClusterId")?.constant).toBe(3);
    // Offsets 0..49 exactly fill the 50-register stride.
    const offsets = buildEspire290ClusterTemplate({ clusterIndex: 0 })
      .telemetry.filter((t) => typeof t.address === "number")
      .map((t) => (t.address as number) - 31981);
    expect(Math.min(...offsets)).toBe(0);
    expect(Math.max(...offsets)).toBe(49);
    expect(new Set(offsets).size).toBe(50);
  });

  test("TMU template shifts by 28 per TMU", () => {
    const tmu2 = buildEspire290TmuTemplate({ tmuIndex: 1 });
    expect(tmu2.telemetry.find((t) => t.id === "WorkMode")?.address).toBe(33190);
    expect(tmu2.telemetry.find((t) => t.id === "CompressorStatus")?.address).toBe(33188 + 28);
  });

  test("equipment config = CMS + one cluster and one TMU per cluster, all adaptable", () => {
    const config = buildEspire290EquipmentConfig({ clusterCount: 3 });
    expect(Object.keys(config)).toEqual([
      "E290_CMS",
      "E290_BMS_1",
      "E290_TMU_1",
      "E290_BMS_2",
      "E290_TMU_2",
      "E290_BMS_3",
      "E290_TMU_3",
    ]);
    for (const entry of Object.values(config)) {
      if (typeof entry === "string" || !entry.template) throw new Error("expected template entry");
      expect(() => adaptTelemetryTemplateToReadProfile(entry.profileName, entry.template!)).not.toThrow();
    }
  });
});
