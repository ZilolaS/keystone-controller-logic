# Local Scheduler Default

The unified controller supports an optional boolean `default` job-descriptor
field for the commercial UI's local fallback. This is a Keystone extension,
not a field defined by the proposed EdgeScheduler 2.0 specification. Numeric
`flags` remains reserved at zero. No cloud changes are required for ordinary
EdgeScheduler jobs, and job names do not determine control behavior.

A default uses `owner: "LocalSchedule"`, `execType: "Cron"`,
`cronExpr: "0 0 0 * * ? *"`, `startTs: 0`, `expireTs: 0`, and
`durationSec: 86400`. This canonical descriptor is retained for serialization;
`default: true` makes eligibility continuous rather than dependent on a daily
trigger or daylight-saving transition. Payload and SOC constraints are unchanged.

Any eligible non-default job takes precedence, including a VPP job, regardless
of the default's priority. The fallback resumes when no timed job is eligible.
A stopped default cannot drive control. GetJob/GetJobList expose the boolean,
and report a superseded fallback as Preempted, not simultaneously Running.

Once/Immediate jobs use their absolute start/end timestamps for eligibility,
without reinterpreting UTC bounds as local wall-clock bounds. This prevents a
fallback from masking a dated job during the timezone-offset hours.

CreateJob with a new ID and `default: true` validates the entire request before
replacing the previous explicit default in job and control-plan storage. Normal
jobs are retained; an invalid request leaves the existing default intact. Reusing
an existing job ID is still rejected. The UI uses a fresh ID when saving a default.

The commercial UI preserves the boolean in JSON import/export and shows the
default separately from calendar events. Historical jobs without the boolean
are not automatically changed by deploying this release. Site migrations must
explicitly select and back up the intended fallback before converting it.
