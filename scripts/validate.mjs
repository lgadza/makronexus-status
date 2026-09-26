import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPONENTS } from '../config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const runtimePath = path.join(root, '.runtime', 'current.json');
const incidentsPath = path.join(root, 'data', 'incidents.json');
const uptimePath = path.join(root, 'data', 'uptime.json');

const allowedStatuses = new Set(['operational', 'maintenance', 'degraded', 'outage']);
const expectedIds = new Set(COMPONENTS.map((component) => component.id));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

await Promise.all([
  access(path.join(root, 'public', 'index.html')),
  access(path.join(root, 'public', 'assets', 'styles.css')),
  access(path.join(root, 'public', 'assets', 'app.js')),
  access(path.join(root, 'public', 'CNAME')),
]);

const current = await json(runtimePath);
assert(current.schemaVersion === 1, 'current status schemaVersion must be 1');
assert(allowedStatuses.has(current.status), `invalid overall status: ${current.status}`);
assert(Array.isArray(current.components), 'current components must be an array');
assert(current.components.length === expectedIds.size, 'current status must contain every published component');

for (const component of current.components) {
  assert(expectedIds.has(component.id), `unexpected public component: ${component.id}`);
  assert(allowedStatuses.has(component.status), `invalid component status: ${component.status}`);
}

const publicPayload = JSON.stringify(current);
const forbiddenKeys = [
  'latencyMs', 'durationMs', 'statusCode', 'host', 'bucket', 'version', 'stack', 'error',
  'tenantId', 'tenant_id', 'schoolId', 'school_id', 'password', 'secret', 'token', 'authorization',
];
for (const key of forbiddenKeys) {
  assert(!publicPayload.toLowerCase().includes(`"${key.toLowerCase()}"`), `public current.json leaks forbidden key: ${key}`);
}

const incidents = await json(incidentsPath);
assert(Array.isArray(incidents.incidents), 'incidents document must contain an incidents array');
for (const incident of incidents.incidents) {
  assert(incident.dataIntegrity, `incident ${incident.id} must state data-integrity status`);
  assert(['unknown', 'unaffected', 'monitoring', 'affected'].includes(incident.dataIntegrity), `incident ${incident.id} has invalid data-integrity status`);
}

const uptime = await json(uptimePath);
for (const period of ['30d', '90d']) {
  const value = uptime.periods?.[period]?.overall;
  assert(value === null || (Number.isFinite(value) && value >= 0 && value <= 100), `invalid ${period} uptime`);
}

process.stdout.write('Public status contract validation passed.\n');
