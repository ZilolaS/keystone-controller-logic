# keystone-controller-logic
Typed helper library for Keystone EMS / Node-RED controllers (Welotec Azure IoT Edge).

## Dev
npm install
npm test
npm run build

If `npm` is broken in WSL due to Windows Node wrappers, use the direct scripts:

```
./scripts/build-local.sh
./scripts/test-local.sh
./scripts/check-local.sh
```

These use `scripts/with-local-node.sh`, which downloads a Linux Node runtime to `/tmp` and runs with safe temp paths.

If your `npm` command is healthy, these aliases are also available:

```
npm run build:local
npm run test:local
npm run check:local
```

## Deploy
./scripts/deploy.sh NodeRedModule /data-internal/dist

## Node-RED Flow
- `flows/keystone_legacy_addition_flow.json`
  - canonical importable flow for adding the unified runtime to an existing legacy controller flow
  - contains the `ESR + EdgeScheduler API` tab for Schedule UI, AWSFeedModule CGI, and VPP command handling
  - contains the `Unified Platform Runtime` tab for site-config-driven telemetry, SS40K/SS42K export, scheduler execution, and command runtime
  - intended as an additive legacy-compatible flow until the full legacy Node-RED flow is replaced

## Device Runtime Layout (Confirmed on 10.253.1.16)
- Container: `NodeRedModule`
- Active compiled library path: `/data-internal/dist`
- Secondary source workspace path (lightweight copy): `/data-internal/logic`
- Node-RED settings file: `/data-internal/settings.js`

### Node-RED Global Context Settings
The function nodes are configured to load this repo bundle from global context:

```js
module.exports.functionExternalModules = true;
module.exports.functionGlobalContext = Object.assign(
  {},
  module.exports.functionGlobalContext || {},
  { lib: require("/data-internal/dist") }
);
```

This enables function-node usage like:

```js
const lib = global.get("lib");
// lib.telemetry.handleTelemetryMessage(...)
```
