# NodeRedModule 3.0.22

Build from a clean, recorded commit after `npm run build` and tests:

```sh
docker build -f deployment/nodered/Dockerfile \
  --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" \
  -t csedgeplatform.azurecr.io/noderedmodule:3.0.22-amd64 .
```

This release packages the current shared library and unified flow, including the
reader starvation, Mini BCU watt scaling, grid status and fan-stop alarm fixes.
BCU 42101.W is rounded to the nearest whole watt at export; source precision,
voltage, current, sign convention and energy accumulation are unchanged.

## Required Authentication Configuration

Before upgrading EACH controller, preserve its existing Node-RED users as JSON
in `/data/node-red/admin-auth.json` on the persistent `/iotedge` mount. The format
is an object with a `users` array; each user has `username`, a bcrypt `password`
hash and `permissions` (`*` or `read`). Do not store plaintext passwords. Preserve
existing working hashes, and verify login after replacement. Treat the file as a
secret; do not commit it. `NODE_RED_AUTH_FILE` can select another mounted path.

The image has no default password and refuses startup if authentication is
missing or invalid. This prevents an image upgrade from resetting site logins.
The file is independent of site power/schedule configuration.

## Rollout Gates

- Back up active flows, settings, context and module twins before touching a site.
- Seed and validate site configuration, authentication and schedule before
  applying an image that forces the bundled unified flow on startup.
- Do not start a control writer until fresh telemetry and 30/60/etc. kW site
  limits, SOC protections and schedule timing have been checked.
- Preserve Levtex's existing site configuration and schedule.
- Davis Nursery uses MINI-30-0-81-480, America/Los_Angeles, 30 kW limits and AC PV.
- Azure deployment content is immutable. Replacing content requires explicitly
  approved recreation, even when reusing the exact same deployment ID. Do not
  overwrite the old image tag, create another layer, or bypass deployment
  management with a device twin image override.

Run `node --test deployment/nodered/auth.test.cjs` for authentication checks.
