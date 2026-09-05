#!/usr/bin/env python3

import argparse
import json
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


MONTH_NAMES = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


def compact_numbers(values):
    values = sorted(set(values))
    ranges = []
    start = previous = values[0]
    for value in values[1:]:
        if value == previous + 1:
            previous = value
            continue
        ranges.append(str(start) if start == previous else f"{start}-{previous}")
        start = previous = value
    ranges.append(str(start) if start == previous else f"{start}-{previous}")
    return ",".join(ranges)


def payload_signature(payload):
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def local_segments(job, zone):
    start_utc = datetime.fromtimestamp(job["startTs"], timezone.utc)
    end_utc = start_utc + timedelta(seconds=job["durationSec"])
    cursor = start_utc.astimezone(zone)
    end = end_utc.astimezone(zone)

    while cursor < end:
        next_midnight = datetime.combine(cursor.date() + timedelta(days=1), time.min, zone)
        segment_end = min(end, next_midnight)
        wall_duration = int((segment_end.replace(tzinfo=None) - cursor.replace(tzinfo=None)).total_seconds())
        if wall_duration <= 0:
            raise ValueError(f"Invalid local segment for job {job['jobId']}")
        yield cursor, wall_duration
        cursor = segment_end


def schedule_plan(job):
    payload = job["payload"]
    return {
        "planID": str(job["jobId"]),
        "jobId": job["jobId"],
        "name": job["jobName"],
        "version": "3.0",
        "owner": job["owner"],
        "priority": job["priority"],
        "execType": "Cron",
        "timezone": job["timezone"],
        "cron": job["cronExpr"],
        "until": datetime.fromtimestamp(job["expireTs"], timezone.utc).isoformat().replace("+00:00", "Z"),
        "duration": {"unit": "minutes", "value": job["durationSec"] / 60},
        "payload": payload,
        "strategy": {
            "meter_rule": {
                "discharge": {"net_load_threshold": {"value": payload["dischargeThresholdKw"], "unit": "kW"}},
                "charge": {"net_load_threshold": {"value": payload["chargeThresholdKw"], "unit": "kW"}},
            },
            "pv_rule": {"name": "GridSupplement"},
        },
        "constraints": {
            "min_soc": {"value": payload["minSocPct"], "unit": "%"},
            "max_soc": {"value": payload["maxSocPct"], "unit": "%"},
            "max_charge_power": {"value": payload["maxChargePowerPct"], "unit": "%"},
            "max_discharge_power": {"value": payload["maxDischargePowerPct"], "unit": "%"},
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Compress dated EdgeScheduler jobs into exact cron groups")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--job-base", required=True, type=int)
    parser.add_argument("--name", default="Schedule")
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    source_jobs = sorted(source["edgeSchedulerJobs"].values(), key=lambda job: (job["startTs"], job["jobId"]))
    if not source_jobs:
        raise ValueError("The source schedule contains no jobs")
    if any(job.get("execType") != "Once" for job in source_jobs):
        raise ValueError("Compression input must contain only Once jobs")

    timezone_name = source_jobs[0]["timezone"]
    if any(job.get("timezone") != timezone_name for job in source_jobs):
        raise ValueError("All jobs must use the same timezone")
    zone = ZoneInfo(timezone_name)
    expire_ts = max(job["startTs"] + job["durationSec"] for job in source_jobs)

    groups = defaultdict(lambda: {"days": set(), "sourceJobIds": []})
    segment_count = 0
    for job in source_jobs:
        for local_start, duration_sec in local_segments(job, zone):
            key = (
                local_start.year,
                local_start.month,
                local_start.hour,
                local_start.minute,
                local_start.second,
                duration_sec,
                job.get("priority", 50),
                job.get("owner", "LocalSchedule"),
                payload_signature(job["payload"]),
            )
            groups[key]["days"].add(local_start.day)
            groups[key]["sourceJobIds"].append(job["jobId"])
            segment_count += 1

    jobs = {}
    plans = []
    for index, (key, group) in enumerate(sorted(groups.items())):
        year, month, hour, minute, second, duration_sec, priority, owner, payload_json = key
        job_id = args.job_base + index
        if job_id > 0xFFFFFFFF:
            raise ValueError(f"Generated jobId {job_id} exceeds uint32")
        day_expression = compact_numbers(group["days"])
        cron = f"{second} {minute} {hour} {day_expression} {MONTH_NAMES[month - 1]} ? {year}"
        job_name = f"{args.name} {MONTH_NAMES[month - 1]} {hour:02d}:{minute:02d} {index + 1}"[:31]
        payload = json.loads(payload_json)
        job = {
            "protocolVer": 1,
            "flags": 0,
            "jobId": job_id,
            "jobName": job_name,
            "priority": priority,
            "owner": owner,
            "execType": "Cron",
            "timezone": timezone_name,
            "startTs": 0,
            "expireTs": expire_ts,
            "cronExpr": cron,
            "durationSec": duration_sec,
            "payload": payload,
            "payloadJson": json.dumps(payload, separators=(",", ":")),
            "state": "Pending",
        }
        jobs[str(job_id)] = job
        plans.append(schedule_plan(job))

    output = {
        "conversion": {
            **source.get("conversion", {}),
            "compression": "exact-month-day-of-month-cron",
            "sourceJobCount": len(source_jobs),
            "sourceSegmentCount": segment_count,
            "compressedJobCount": len(jobs),
        },
        "edgeSchedulerJobs": jobs,
        "schedulePlans": [{
            "version": "3.0",
            "source": "compressed-from-dated-edge-schedule",
            "timezone": timezone_name,
            "timed": plans,
        }],
    }
    Path(args.output).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["conversion"], indent=2))


if __name__ == "__main__":
    main()
