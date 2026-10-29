#!/usr/bin/env python3
import json
import sys
from pathlib import Path


UNUSED = ("unused", "127.0.0.1", 502, 1)


def as_int(value, fallback):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def product_default_ip(profile, equipment_id):
    profile = str(profile or "")
    if profile.startswith("MINI-"):
        if equipment_id == "AMPACE":
            return "192.168.1.100"
        if equipment_id in {"PCS", "Load", "PVDC1", "PVDC2", "PVDC3"}:
            return "192.168.1.10"
    if profile.upper() == "NANO" or profile.upper().startswith("NANO-"):
        if equipment_id == "PCS":
            return "192.168.1.7"
    if profile == "eSpire280":
        if equipment_id == "PCS":
            return "192.168.1.136"
        if equipment_id == "MBMU":
            return "192.168.1.50"
    return ""


def patch_node(node, name, ip, port, unit_id):
    node["name"] = name
    node["tcpHost"] = ip
    node["tcpPort"] = str(port)
    node["unit_id"] = str(unit_id)


def target_tuple(profile, target):
    equipment_id = str(target.get("equipmentId") or target.get("route") or "unused")
    ip = str(target.get("ip") or product_default_ip(profile, equipment_id) or UNUSED[1])
    port = as_int(target.get("port"), 502)
    unit_id = as_int(target.get("unitId", target.get("unit_id")), 1)
    return equipment_id, ip, port, unit_id


def normalize_profile(profile):
    if not profile:
        return ""
    profile = str(profile)
    if profile == "udt_eGauge_V1":
        return "eGauge_280_ss40k"
    return profile


def source_value(source, *keys):
    if not isinstance(source, dict):
        return None
    for key in keys:
        value = source.get(key)
        if value not in (None, ""):
            return value
    return None


def source_ip(source, fallback=""):
    return str(source_value(source, "ip", "host", "tcpHost") or fallback or "")


def source_port(source, fallback=502):
    return as_int(source_value(source, "port", "tcpPort"), fallback)


def source_unit(source, fallback=1):
    return as_int(source_value(source, "unitId", "unit_id"), fallback)


def source_profile(source, fallback=""):
    return normalize_profile(
        source_value(source, "profileName", "profile", "modbusProfile") or fallback
    )


def asset_lookup(config):
    by_key = {}
    network = config.get("network") if isinstance(config, dict) else {}
    for asset in (network or {}).get("assets") or []:
        if not isinstance(asset, dict):
            continue
        for key in ("id", "role"):
            value = asset.get(key)
            if value:
                by_key[str(value)] = asset
    return by_key


def product_ip(profile, equipment_id, source=None, asset=None, fallback=""):
    return source_ip(
        source,
        source_ip(asset, product_default_ip(profile, equipment_id) or fallback),
    )


def add_target(targets, target):
    if not isinstance(target, dict):
        return
    if not target.get("equipmentId") or not target.get("profileName") or not target.get("ip"):
        return
    equipment_id = str(target["equipmentId"])
    if any(existing.get("equipmentId") == equipment_id for existing in targets):
        return
    targets.append(
        {
            "equipmentId": equipment_id,
            "profileName": normalize_profile(target["profileName"]),
            "ip": str(target["ip"]),
            "port": source_port(target, 502),
            "unitId": source_unit(target, 1),
            "route": str(target.get("route") or target.get("serverKey") or equipment_id),
        }
    )


def default_readers(config):
    readers = []
    if not isinstance(config, dict):
        return readers
    if isinstance(config.get("telemetryReaders"), list):
        for reader in config["telemetryReaders"]:
            add_target(readers, reader)
        return readers

    profile = str((config.get("system") or {}).get("systemProfile") or "eSpire280")
    is_mini = profile.startswith("MINI-")
    is_nano = profile.upper() == "NANO" or profile.upper().startswith("NANO-")
    sources = (config.get("signalMapping") or {}).get("sources") or {}
    metering = config.get("metering") or {}
    assets = asset_lookup(config)
    network = config.get("network") or {}
    controller = network.get("controller") or {}
    modbus_server = controller.get("modbusServer") or {}
    pcs_source = sources.get("PCS") or {}
    pcs_asset = assets.get("PCS") or assets.get("pcs") or {}
    bms_asset = (
        assets.get("AMPACE")
        or assets.get("ampace")
        or assets.get("BMS")
        or assets.get("bms")
        or assets.get("MBMU")
        or assets.get("mbmu")
        or {}
    )
    load_asset = assets.get("Load") or assets.get("load") or {}
    pcs_ip = product_ip(profile, "PCS", pcs_source, pcs_asset, modbus_server.get("ip"))
    pcs_port = source_port(pcs_source, source_port(pcs_asset, modbus_server.get("port") or 502))
    pcs_unit = source_unit(pcs_source, source_unit(pcs_asset, 1))

    if is_mini:
        add_target(readers, {"equipmentId": "PCS", "profileName": "Sinexcel_Mini_PCS_ss40k", "ip": pcs_ip, "port": pcs_port, "unitId": pcs_unit, "route": "PCS"})
        add_target(readers, {"equipmentId": "AMPACE", "profileName": "AMPACE_Mini_ss40k", "ip": product_ip(profile, "AMPACE", sources.get("AMPACE"), bms_asset, pcs_ip), "port": source_port(sources.get("AMPACE"), pcs_port), "unitId": source_unit(sources.get("AMPACE"), 1), "route": "AMPACE"})
        add_target(readers, {"equipmentId": "Load", "profileName": "Sinexcel_Mini_Load_ss40k", "ip": product_ip(profile, "Load", sources.get("Load"), load_asset, pcs_ip), "port": source_port(sources.get("Load"), pcs_port), "unitId": source_unit(sources.get("Load"), 1), "route": "Load"})
        try:
            dc_pv_kw = float(profile.split("-")[2])
        except (IndexError, ValueError):
            dc_pv_kw = 0
        modules = max(0, min(3, round(dc_pv_kw / 45)))
        for index in range(1, modules + 1):
            equipment_id = f"PVDC{index}"
            add_target(readers, {"equipmentId": equipment_id, "profileName": f"Sinexcel_Mini_PVDC_Module{index}_ss40k", "ip": product_ip(profile, equipment_id, sources.get(equipment_id), assets.get(equipment_id), pcs_ip), "port": source_port(assets.get(equipment_id), pcs_port), "unitId": source_unit(assets.get(equipment_id), 1), "route": equipment_id})
    elif is_nano:
        add_target(readers, {"equipmentId": "PCS", "profileName": "NANO_Hybrid_PCS_ss40k", "ip": pcs_ip, "port": pcs_port, "unitId": pcs_unit, "route": "PCS"})
    else:
        add_target(readers, {"equipmentId": "PCS", "profileName": "Delta_280_ss40k", "ip": pcs_ip, "port": pcs_port, "unitId": pcs_unit, "route": "PCS"})
        add_target(readers, {"equipmentId": "MBMU", "profileName": "MBMU_280_ss40k", "ip": product_ip(profile, "MBMU", sources.get("MBMU"), bms_asset, pcs_ip), "port": source_port(sources.get("MBMU"), pcs_port), "unitId": source_unit(sources.get("MBMU"), 1), "route": "MBMU"})
        if metering.get("ip"):
            add_target(readers, {"equipmentId": "Meter", "profileName": normalize_profile(metering.get("modbusProfile") or "eGauge_280_ss40k"), "ip": metering.get("ip"), "port": metering.get("port") or 502, "unitId": metering.get("unitId") or 1, "route": "Meter"})

    product_owned = {"PCS"} if is_nano else (
        {"PCS", "MBMU", "AMPACE", "Load", "PVDC1", "PVDC2", "PVDC3"} if is_mini else {"PCS", "MBMU"}
    )
    for equipment_id, source in sources.items():
        if equipment_id in product_owned:
            continue
        ip = source_ip(source, metering.get("ip") if equipment_id == "Meter" else "")
        profile_name = source_profile(source, "eGauge_280_ss40k" if equipment_id in {"Meter", "Meter2"} else "")
        if ip and profile_name:
            add_target(readers, {"equipmentId": equipment_id, "profileName": profile_name, "ip": ip, "port": source_port(source, 502), "unitId": source_unit(source, 1), "route": source.get("route") or equipment_id})
    return readers


def default_writer_targets(config):
    if not isinstance(config, dict):
        return []
    if isinstance(config.get("writerTargets"), list):
        targets = []
        for target in config["writerTargets"]:
            add_target(targets, target)
        return targets
    return default_readers(config)


def extract_status(status_raw):
    if not isinstance(status_raw, dict):
        raise ValueError("control status must be a JSON object")

    status = status_raw
    for key in ("data", "status"):
        candidate = status_raw.get(key)
        if isinstance(candidate, dict):
            status = candidate
            break
    config = (
        status.get("controlConfig")
        or status.get("unifiedControlConfig")
        or status.get("siteConfig")
        or status
    )
    profile = (
        status.get("systemProfile")
        or ((config.get("system") or {}).get("systemProfile") if isinstance(config, dict) else "")
        or ""
    )
    if status.get("telemetryReaderConfig") or status.get("writerTargets"):
        return {**status, "systemProfile": profile}

    return {
        **(status if isinstance(status, dict) else {}),
        "systemProfile": profile,
        "telemetryReaderConfig": default_readers(config),
        "writerTargets": default_writer_targets(config),
    }


def slot_plan(profile, telemetry_readers, writer_targets):
    telemetry = unique_endpoint_slots(profile, telemetry_readers)
    writers = unique_endpoint_slots(profile, writer_targets)
    while len(telemetry) < 6:
        telemetry.append(UNUSED)
    while len(writers) < 6:
        writers.append(UNUSED)
    return telemetry, writers


def unique_endpoint_slots(profile, targets):
    slots = []
    seen = set()
    for item in targets:
        equipment_id, ip, port, unit_id = target_tuple(profile, item)
        key = (ip, port, unit_id)
        if key in seen:
            continue
        seen.add(key)
        slots.append((equipment_id, ip, port, unit_id))
        if len(slots) >= 6:
            break
    return slots


def main():
    if len(sys.argv) != 3:
        print(
            "usage: apply-node-red-fixed-slots.py /path/to/flows.json /path/to/control-status.json",
            file=sys.stderr,
        )
        return 2

    flows_path = Path(sys.argv[1])
    status_path = Path(sys.argv[2])
    flows = json.loads(flows_path.read_text())
    status_raw = json.loads(status_path.read_text())
    status = extract_status(status_raw)
    profile = status.get("systemProfile") or ""
    telemetry, writers = slot_plan(
        profile,
        status.get("telemetryReaderConfig") or [],
        status.get("writerTargets") or [],
    )

    patched = []
    for node in flows:
        node_id = node.get("id", "")
        if node_id.startswith("platform_tslot") and node_id.endswith("_client"):
            index = int(node_id.split("platform_tslot", 1)[1].split("_client", 1)[0]) - 1
            equipment_id, ip, port, unit_id = telemetry[index]
            patch_node(node, f"telemetry_slot_{index + 1}_{equipment_id}", ip, port, unit_id)
            patched.append((node_id, node["name"], ip, port, unit_id))
        elif node_id.startswith("platform_wslot") and node_id.endswith("_client"):
            index = int(node_id.split("platform_wslot", 1)[1].split("_client", 1)[0]) - 1
            equipment_id, ip, port, unit_id = writers[index]
            patch_node(node, f"writer_slot_{index + 1}_{equipment_id}", ip, port, unit_id)
            patched.append((node_id, node["name"], ip, port, unit_id))

    flows_path.write_text(json.dumps(flows, indent=2) + "\n")
    print(json.dumps({"systemProfile": profile, "patched": patched}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
