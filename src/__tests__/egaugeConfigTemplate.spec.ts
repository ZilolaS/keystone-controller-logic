import {
  adaptTelemetryTemplateToReadProfile,
  buildConfiguredEgaugeTemplate,
  buildConfiguredEgaugeTemplates,
  buildSiteTelemetryEquipmentConfig,
  buildSs40kLookup,
} from "../telemetry";
import type { MeteringConfig, SiteConfig } from "../config";

describe("configured eGauge register map template", () => {
  test("builds a site-specific eGauge template from canonical register rows", () => {
    const metering: MeteringConfig = {
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "192.168.1.64",
      reads: {
        pv: true,
        pvFromInverter: false,
        utility: true,
        load: true,
      },
      registerMap: [
        {
          signal: "utilityPowerKw",
          tagID: "Meter.Utility_Total_Power",
          register: 9020,
          function: "IRF",
          scale: 0.001,
          sign: 1,
        },
        {
          signal: "siteLoadKw",
          tagID: "Meter.Load_Active_Power_Raw",
          register: 9032,
          function: "IRF",
          scale: 0.001,
        },
        {
          signal: "pvKw",
          tagID: "Meter.PV_Total_Power_Raw",
          register: 9040,
          function: "IRF",
          scale: 0.001,
          sign: -1,
        },
      ],
    };

    const template = buildConfiguredEgaugeTemplate(metering, "site_eGauge");

    expect(template).not.toBeNull();
    expect(template?.device.sourceFormat).toBe("site-config-register-map");
    expect(template?.telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "Utility_Total_Power",
          function: "IRF",
          address: 9020,
          scale: expect.objectContaining({ rawHigh: 1, scaledHigh: 0.001 }),
        }),
        expect.objectContaining({
          id: "Utility_Import_Power",
          calc: {
            inputs: { utility: "Utility_Total_Power" },
            expr: "max(utility, 0)",
          },
          ss40k: expect.objectContaining({ name: "pGridImpTot" }),
        }),
        expect.objectContaining({
          id: "Utility_Export_Power",
          calc: {
            inputs: { utility: "Utility_Total_Power" },
            expr: "max(-utility, 0)",
          },
          ss40k: expect.objectContaining({ name: "pGridExpTot" }),
        }),
        expect.objectContaining({
          id: "Load_Active_Power",
          calc: {
            inputs: { load: "Load_Active_Power_Raw" },
            expr: "load",
          },
          ss40k: expect.objectContaining({ name: "pLoad" }),
        }),
        expect.objectContaining({
          id: "PV_Total_Power",
          calc: {
            inputs: { pv: "PV_Total_Power_Raw" },
            expr: "pv",
          },
          ss40k: expect.objectContaining({ name: "pPvTotal" }),
        }),
      ])
    );
  });

  test("generated template normalizes and exports through SS40K lookup", () => {
    const template = buildConfiguredEgaugeTemplate({
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "192.168.1.64",
      reads: { pv: false, pvFromInverter: false, utility: true, load: true },
      registerMap: [
        {
          signal: "utilityPowerKw",
          tagID: "Meter.POI",
          register: 100,
          function: "HRF",
        },
        {
          signal: "siteLoadKw",
          tagID: "Meter.Load",
          register: 102,
          function: "HRF",
        },
      ],
    });

    expect(template).not.toBeNull();
    const profile = adaptTelemetryTemplateToReadProfile("Meter", template!);
    expect(profile.tags.map((tag) => tag.name)).toEqual(
      expect.arrayContaining([
        "POI",
        "Load",
        "Utility_Import_Power",
        "Utility_Export_Power",
        "Load_Active_Power",
      ])
    );

    expect(profile.tags.map((tag) => tag.name)).toContain("Utility_Import_Power");

    const lookup = buildSs40kLookup({
      Meter: { profileName: "configured_eGauge", route: "Meter", template: template! },
    });

    expect(lookup.lookup["Meter.Utility_Import_Power"]).toMatchObject({
      model: "40101",
      name: "pGridImpTot",
    });
    expect(lookup.lookup["Meter.Load_Active_Power"]).toMatchObject({
      model: "40101",
      name: "pLoad",
    });
  });

  test("builds multiple site-configured eGauge meter templates", () => {
    const equipmentConfig = buildConfiguredEgaugeTemplates({
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "unused-when-meters-are-configured",
      reads: { pv: true, pvFromInverter: false, utility: true, load: true },
      meters: [
        {
          id: "Meter",
          meterType: "eGauge",
          ip: "192.168.1.64",
          route: "Meter",
          registerMap: [
            {
              signal: "utilityPowerKw",
              tagID: "Meter.Utility_Total_Power",
              register: 9000,
              function: "IRF",
              scale: 0.001,
              supportingTag: true,
            },
            {
              signal: "loadEnergyKwh",
              tagID: "Meter.Load_Energy",
              register: 9010,
              function: "IRF",
              scale: 1,
            },
            {
              signal: "energyImportKwh",
              tagID: "Meter.Utility_Import_Energy",
              register: 9014,
              function: "IRF",
              scale: 1,
            },
          ],
        },
        {
          id: "Meter2",
          meterType: "eGauge",
          ip: "192.168.1.65",
          route: "Meter2",
          registerMap: [
            {
              signal: "acCoupledPvKw",
              tagID: "Meter2.Solar",
              register: 9004,
              function: "IRF",
              scale: 0.001,
            },
            {
              signal: "acCoupledPvEnergyKwh",
              tagID: "Meter2.Solar_Energy",
              register: 9012,
              function: "IRF",
              scale: 1,
            },
          ],
        },
      ],
    });

    expect(Object.keys(equipmentConfig).sort()).toEqual(["Meter", "Meter2"]);
    expect(equipmentConfig.Meter.route).toBe("Meter");
    expect(equipmentConfig.Meter2.route).toBe("Meter2");

    const lookup = buildSs40kLookup(equipmentConfig);
    expect(lookup.lookup["Meter.Utility_Import_Energy"]).toMatchObject({
      model: "40102",
      name: "eGridImpTot",
    });
    expect(lookup.lookup["Meter.Load_Energy"]).toMatchObject({
      model: "40102",
      name: "eLoadTot",
    });
    expect(lookup.lookup["Meter2.Solar"]).toMatchObject({
      model: "40101",
      name: "pAcCplTot",
      exportMultiplier: 1000,
    });
    expect(lookup.lookup["Meter2.Solar_Energy"]).toMatchObject({
      model: "40102",
      name: "eAcCplTot",
    });
  });

  test("site-configured meters can extend an existing template", () => {
    const equipmentConfig = buildConfiguredEgaugeTemplates({
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "unused-when-meters-are-configured",
      reads: { pv: true, pvFromInverter: false, utility: true, load: true },
      meters: [
        {
          id: "Meter",
          meterType: "eGauge",
          baseProfile: "eGauge_Mission_Energy_ss40k",
          ip: "192.168.1.88",
          route: "Meter",
          registerMap: [
            {
              signal: "energyExportKwh",
              tagID: "Meter.Utility_Energy",
              register: 34058,
              function: "IRF",
              scale: 1,
            },
            {
              signal: "generatorEnergyKwh",
              tagID: "Meter.Generator_Energy",
              register: 34064,
              function: "IRF",
              scale: 1,
            },
          ],
        },
      ],
    });

    const template = equipmentConfig.Meter.template!;
    expect(template.telemetry.some((entry) => entry.id === "Generator_Total_Power")).toBe(true);
    expect(template.telemetry.some((entry) => entry.id === "Utility_Energy")).toBe(true);

    const lookup = buildSs40kLookup(equipmentConfig);
    expect(lookup.lookup["Meter.Utility_Energy"]).toMatchObject({
      model: "40102",
      name: "eGridExpTot",
    });
    expect(lookup.lookup["Meter.Generator_Energy"]).toMatchObject({
      model: "40102",
      name: "eGenTot",
    });
  });

  test("site telemetry equipment config overlays generated meters onto normal sources", () => {
    const config: SiteConfig = {
      system: {
        systemProfile: "eSpire280",
        controllerTimezone: "America/Los_Angeles",
        nominal: { voltageVll: 480, frequencyHz: 60 },
      },
      network: {
        controller: { ip: "127.0.0.1", modbusServer: { ip: "127.0.0.1", port: 502 } },
      },
      operation: {
        mode: "grid-tied",
        gridCode: "IEEE1547-2018",
        crdMode: "no-restriction",
        scheduledControlEnabled: false,
      },
      pcs: { pcsDaisyChain: [1], maxChargeKw: 125, maxDischargeKw: 125 },
      mbmu: { sbmuStrings: [2] },
      battery: { minSoc: 0.2, maxSoc: 0.95 },
      pv: { acInverters: [], curtailmentMethod: "modbus" },
      metering: {
        meterType: "eGauge",
        modbusProfile: "configured_eGauge",
        ip: "unused-when-meters-are-configured",
        reads: { pv: true, pvFromInverter: false, utility: true, load: true },
        meters: [
          {
            id: "Meter2",
            meterType: "eGauge",
            ip: "192.168.1.65",
            registerMap: [
              {
                signal: "acCoupledPvKw",
                tagID: "Meter2.Solar",
                register: 9004,
                function: "IRF",
                scale: 0.001,
              },
            ],
          },
        ],
      },
      signalMapping: {
        sources: {
          PCS: { profile: "Delta_280_ss40k", route: "PCS", role: "pcs" },
          Meter2: { profile: "old_repo_template_that_should_be_overlaid", route: "Meter2" },
        },
      },
    };

    const equipmentConfig = buildSiteTelemetryEquipmentConfig(config);

    expect(equipmentConfig.PCS).toMatchObject({
      profileName: "Delta_280_ss40k",
      route: "PCS",
    });
    expect(equipmentConfig.Meter2).toMatchObject({
      profileName: "configured_eGauge_Meter2",
      route: "Meter2",
      template: expect.objectContaining({
        device: expect.objectContaining({
          sourceFormat: "site-config-register-map",
        }),
      }),
    });
  });

  test("can model Assisted Living eGauge rows from site config", () => {
    const template = buildConfiguredEgaugeTemplate({
      meterType: "eGauge",
      modbusProfile: "configured_eGauge",
      ip: "192.168.1.64",
      reads: { pv: false, pvFromInverter: false, utility: true, load: true },
      registerMap: [
        { signal: "voltageL1N", tagID: "Meter.L1_Voltage", register: 9002, function: "IRF", ss40kName: "vGridL1N" },
        { signal: "voltageL2N", tagID: "Meter.L2_Voltage", register: 9004, function: "IRF", ss40kName: "vGridL2N" },
        { signal: "voltageL3N", tagID: "Meter.L3_Voltage", register: 9006, function: "IRF", ss40kName: "vGridL3N" },
        { signal: "custom", tagID: "Meter.Utility_L1_Power", register: 9014, function: "IRF", scale: 0.001, ss40kName: "pGridL1" },
        { signal: "custom", tagID: "Meter.Utility_L2_Power", register: 9016, function: "IRF", scale: 0.001, ss40kName: "pGridL2" },
        { signal: "custom", tagID: "Meter.Utility_L3_Power", register: 9018, function: "IRF", scale: 0.001, ss40kName: "pGridL3" },
        { signal: "utilityPowerKw", tagID: "Meter.Utility_Total_Power", register: 9020, function: "IRF", scale: 0.001, supportingTag: true },
        { signal: "custom", tagID: "Meter.Backup_Load_L1_Power", register: 9028, function: "IRF", scale: 0.001, ss40kName: "pLoadL1" },
        { signal: "custom", tagID: "Meter.Backup_Load_L2_Power", register: 9030, function: "IRF", scale: 0.001, ss40kName: "pLoadL2" },
        { signal: "custom", tagID: "Meter.Backup_Load_L3_Power", register: 9000, function: "IRF", scale: 0.001, ss40kName: "pLoadL3" },
        { signal: "backupLoadKw", tagID: "Meter.Backup_Load_Total_Power", register: 9032, function: "IRF", scale: 0.001, ss40kName: "pBkupTot" },
      ],
    }, "assisted_living_eGauge");

    expect(template).not.toBeNull();
    expect(template?.telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "L1_Voltage", address: 9002, ss40k: expect.objectContaining({ name: "vGridL1N" }) }),
        expect.objectContaining({ id: "Utility_L1_Power", address: 9014, ss40k: expect.objectContaining({ name: "pGridL1" }) }),
        expect.objectContaining({ id: "Utility_Total_Power", address: 9020, supportingTag: true }),
        expect.objectContaining({ id: "Backup_Load_Total_Power", address: 9032, ss40k: expect.objectContaining({ name: "pBkupTot" }) }),
        expect.objectContaining({
          id: "Load_Active_Power",
          calc: {
            inputs: { load: "Backup_Load_Total_Power" },
            expr: "load",
          },
          ss40k: expect.objectContaining({ name: "pLoad" }),
        }),
      ])
    );

    const lookup = buildSs40kLookup({
      Meter: { profileName: "configured_eGauge", route: "Meter", template: template! },
    });
    expect(lookup.lookup["Meter.Load_Active_Power"]).toMatchObject({ name: "pLoad" });
    expect(lookup.lookup["Meter.Backup_Load_Total_Power"]).toMatchObject({ name: "pBkupTot" });
  });

  test("returns null without register rows", () => {
    expect(
      buildConfiguredEgaugeTemplate({
        meterType: "eGauge",
        modbusProfile: "configured_eGauge",
        ip: "192.168.1.64",
        reads: { pv: false, pvFromInverter: false, utility: false, load: false },
      })
    ).toBeNull();
  });
});
