const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const func = fs.readFileSync(path.join(root, 'flows/functions/ampace-bcu-power.js'), 'utf8').trim();
for (const name of ['unified_platform_runtime_flow.json', 'keystone_legacy_addition_flow.json']) {
  const target = path.join(root, 'flows', name);
  const nodes = JSON.parse(fs.readFileSync(target, 'utf8'));
  const store = nodes.find(n => n.id === 'platform_store_telemetry');
  const start = store.func.indexOf('function upsertBcuPower(');
  const end = store.func.indexOf('function pruneAmpaceBcuEquipmentConfig(', start);
  if (start < 0 || end < 0) throw Error('BCU power function not found: ' + name);
  store.func = store.func.slice(0, start) + func + '\n' + store.func.slice(end);
  fs.writeFileSync(target, JSON.stringify(nodes, null, 2) + '\n');
}
