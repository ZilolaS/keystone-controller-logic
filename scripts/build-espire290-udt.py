"""Build legacy Keystone UDTs for the eSpire 290 (OLiPower CMS).

Source of truth is the ss templates in src/templates/eSpire290_OLP_*.json;
this only re-shapes them into the Original_*_udt.json format (same fields
as Original_280_MBMU_udt.json / Original_280_Delta_udt.json). The legacy
format has no per-device base offset, so each cluster / TMU gets its own
UDT with absolute addresses.

Usage:
    python scripts/build-espire290-udt.py [cluster_count] [out_dir]

    cluster_count  clusters (= TMUs) to emit, 1-16, default 1
    out_dir        default src/templates
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES = os.path.join(ROOT, "src", "templates")

CLUSTER_BASE, CLUSTER_STRIDE = 31981, 50
TMU_BASE, TMU_STRIDE = 33162, 28
UDT_VERSION = "V1"

# Bit labels for the decodable fault/status words (vendor sheet V3.3 +
# strategy doc V0.4). Keys are bit numbers, as in the existing UDTs.
PROTECTION_BITS = {
    "0": "Cell overvoltage", "1": "Cell undervoltage",
    "2": "Total voltage overvoltage", "3": "Total voltage undervoltage",
    "4": "Charging high temperature", "5": "Charging low temperature",
    "6": "Discharging high temperature", "7": "Discharging low temperature",
    "8": "Discharging overcurrent", "9": "Charging overcurrent",
    "10": "Cell voltage difference", "11": "Temperature difference",
    "14": "BSU voltage difference",
}
BIT_LABELS = {
    "CmsFaultWord1": {
        "0": "CMS fault", "1": "BMS number config error", "2": "Cell capacity config error",
        "3": "BSU number config error", "4": "Cell number config error", "5": "TC number config error",
        "6": "SOC difference too high", "7": "SOC too low (<10%, blocks HV on)",
        "8": "Cell voltage difference too high (>500 mV, blocks HV on)",
        "9": "Cluster current difference too high (>10 A, blocks HV on)",
    },
    "CmsFaultWord2": {"0": "CMS emergency stop"},
    "CmsWarningWord1": {
        "0": "Online BMS count below config", "4": "SOC difference warning",
        "6": "Cell voltage difference warning", "7": "Current difference warning",
    },
    "CmsWarningWord4": {str(i): f"BMS {i + 1} SOC too low" for i in range(16)},
    "FaultCode1": {k: v + " level-3 (HV off)" for k, v in PROTECTION_BITS.items()},
    "WarningCode1": {k: v + " level-2 (current limited to 0)" for k, v in PROTECTION_BITS.items()},
    "FaultCode2": {
        "0": "L-CAN communication abnormal", "1": "Temperature sensor abnormal",
        "2": "Voltage sensor abnormal", "3": "Insulation fault (<15 kOhm)",
        "4": "Contactor/relay check fault", "5": "Request forced charging",
        "6": "Thermal unit communication error",
    },
    "FaultCode3": {
        "0": "Emergency stop", "1": "Heat/fire detector", "2": "Door open / smoke detector",
        "3": "Water immersion", "4": "Dehumidifier fault", "5": "Combustible gas",
        "6": "HV+ fuse failure", "7": "HV- fuse failure",
    },
    "ContactorOutputs": {"0": "Precharge contactor closed", "1": "Negative contactor closed", "2": "Positive contactor closed"},
    "DigitalOutputHsd": {"0": "Green lamp (powered)", "1": "Yellow lamp (HV on)", "2": "Red lamp (severe alarm)"},
}
MASK_SUFFIX = {"CmsFaultStatus": "faulted", "CmsWarningStatus": "warning", "CmsHvOnStatus": "HV on",
               "BmsChargeForbidStatus": "charge forbidden", "BmsDischargeForbidStatus": "discharge forbidden",
               "BmsEnableStatus": "enabled"}
for tag, suffix in MASK_SUFFIX.items():
    BIT_LABELS[tag] = {str(i): f"Cluster {i + 1} {suffix}" for i in range(16)}

CATEGORY_PREFIX = {
    "Info": "System", "Config": "System", "Status": "Status", "Telemetry": "Telemetry",
    "Faults": "Faults", "Warnings": "warnings", "BMSControl": "Commands",
}


def load(name):
    with open(os.path.join(TEMPLATES, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def udt_tag(entry, address, map_prefix, map_index):
    fn = entry["function"]
    signed = fn in ("IR", "HR")
    scale = entry.get("scale")
    tag = {
        "name": entry["id"],
        "tagType": "Modbus",
        "modbusType": fn,
        "modbusAddress": address,
        "mapPrefix": map_prefix,
        "mapIndex": map_index,
    }
    if scale:
        tag.update(rawLow=scale["rawLow"], rawHigh=scale["rawHigh"],
                   scaledLow=scale.get("engLow", scale.get("scaledLow")),
                   scaledHigh=scale.get("engHigh", scale.get("scaledHigh")))
    else:
        tag.update(rawLow=-32768 if signed else 0, rawHigh=32767 if signed else 65535,
                   scaledLow=-32768 if signed else 0, scaledHigh=32767 if signed else 65535)
    labels = BIT_LABELS.get(entry["id"])
    enum = entry.get("enumStatus")
    tag.update(
        alarm="Yes" if entry.get("alarm") else "No",
        mask="None",
        enabled="Yes",
        scaleMode="Linear" if scale else "Off",
        dataType="short" if signed else "ushort",
        supportingTag="Yes" if entry.get("supportingTag") else "No",
        status="Yes" if (labels or enum) else "No",
        bitfieldStatus="Yes" if (labels or entry.get("bitfieldStatus")) else "No",
    )
    if labels:
        tag["statusList"] = labels
    elif enum:
        tag["statusList"] = enum
    return tag


def build(name, entries, address_of):
    counters = {}
    tags = []
    for entry in entries:
        if entry.get("function") is None or entry.get("address") is None:
            continue  # constants (ClusterId / TmuId) have no UDT equivalent
        prefix = CATEGORY_PREFIX.get(entry.get("category"), "Telemetry")
        index = counters.get(prefix, 0)
        counters[prefix] = index + 1
        tags.append(udt_tag(entry, address_of(entry["address"]), prefix, index))
    return {"name": name, "tags": tags}


def write(out_dir, filename, doc):
    with open(os.path.join(out_dir, filename), "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"{filename}: {doc['name']}, {len(doc['tags'])} tags")


def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    if not 1 <= count <= 16:
        sys.exit("cluster_count must be 1-16")
    out_dir = sys.argv[2] if len(sys.argv) > 2 else TEMPLATES

    cms = load("eSpire290_OLP_CMS_ss_TEMPLATE")
    write(out_dir, "Original_290_OLP_CMS_udt.json",
          build(f"udt_OLP_290_CMS_{UDT_VERSION}", cms["telemetry"] + cms["commands"], lambda a: a))

    cluster = load("eSpire290_OLP_BMS_Cluster_ss_TEMPLATE")
    tmu = load("eSpire290_OLP_TMU_ss_TEMPLATE")
    for n in range(1, count + 1):
        cb = CLUSTER_BASE + CLUSTER_STRIDE * (n - 1)
        tb = TMU_BASE + TMU_STRIDE * (n - 1)
        write(out_dir, f"Original_290_OLP_BMS{n}_udt.json",
              build(f"udt_OLP_290_BMS{n}_{UDT_VERSION}", cluster["telemetry"], lambda a, b=cb: b + a))
        write(out_dir, f"Original_290_OLP_TMU{n}_udt.json",
              build(f"udt_OLP_290_TMU{n}_{UDT_VERSION}", tmu["telemetry"], lambda a, b=tb: b + a))


if __name__ == "__main__":
    main()
