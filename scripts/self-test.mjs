import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const checkScript = path.join(here, 'check.mjs');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'makronexus-status-test-'));
const dataDir = path.join(tempRoot, 'data');
const runtimeDir = path.join(tempRoot, 'runtime');
const contentDir = path.join(tempRoot, 'content');

await Promise.all([
  mkdir(dataDir, { recursive: true }),
  mkdir(runtimeDir, { recursive: true }),
  mkdir(contentDir, { recursive: true }),
]);

await Promise.all([
  writeFile(path.join(dataDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    lastCurrent: null,
    lastPersistedSampleAt: null,
    activeAutomaticIncidentId: null,
  }), 'utf8'),
  writeFile(path.join(dataDir, 'history.json'), JSON.stringify({ schemaVersion: 1, samples: [] }), 'utf8'),
  writeFile(path.join(dataDir, 'incidents.json'), JSON.stringify({ schemaVersion: 1, incidents: [] }), 'utf8'),
  writeFile(path.join(dataDir, 'uptime.json'), JSON.stringify({ schemaVersion: 1, generatedAt: null, periods: {} }), 'utf8'),
  writeFile(path.join(contentDir, 'maintenance.json'), JSON.stringify({ schemaVersion: 1, windows: [] }), 'utf8'),
]);

let mode = 'healthy';

const backendComponents = () => [
  { id: 'core-services', status: 'operational' },
  { id: 'school-data', status: 'operational' },
  { id: 'background-processing', status: 'operational' },
  { id: 'file-services', status: mode === 'files-outage' ? 'outage' : 'operational' },
];

const server = http.createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Makronexus</title>');
    return;
  }
  if (req.url === '/livez') return json(200, { alive: true });
  if (req.url === '/readyz') return json(200, { ready: true });
  if (req.url === '/.well-known/jwks.json') return json(200, { keys: [{ kty: 'RSA', kid: 'test' }] });
  if (req.url === '/status.json') {
    return json(200, { schemaVersion: 1, status: mode === 'files-outage' ? 'outage' : 'operational', components: backendComponents() });
  }

  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Unable to bind status self-test server');
const baseUrl = `http://127.0.0.1:${address.port}`;

async function runCheck() {
  await execFileAsync(process.execPath, [checkScript], {
    env: {
      ...process.env,
      STATUS_WEB_URL: baseUrl,
      STATUS_API_URL: baseUrl,
      STATUS_DATA_DIR: dataDir,
      STATUS_RUNTIME_DIR: runtimeDir,
      STATUS_CONTENT_DIR: contentDir,
    },
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await runCheck();
  let current = await readJson(path.join(runtimeDir, 'current.json'));
  let incidents = await readJson(path.join(dataDir, 'incidents.json'));

  assert(current.status === 'operational', 'healthy synthetic platform must report operational');
  assert(current.components.every((component) => component.status === 'operational'), 'healthy synthetic components must all be operational');
  assert(incidents.incidents.length === 0, 'healthy baseline must not create an incident');

  mode = 'files-outage';
  await runCheck();
  current = await readJson(path.join(runtimeDir, 'current.json'));
  incidents = await readJson(path.join(dataDir, 'incidents.json'));
  let state = await readJson(path.join(dataDir, 'state.json'));

  assert(current.status === 'outage', 'published component failure must raise overall outage');
  assert(current.components.find((component) => component.id === 'file-services')?.status === 'outage', 'file-services outage must be preserved');
  assert(incidents.incidents.length === 1, 'first outage must create one incident');
  assert(incidents.incidents[0].status === 'investigating', 'new automatic incident must start investigating');
  assert(incidents.incidents[0].dataIntegrity === 'unknown', 'automatic incident must not infer data integrity');
  assert(Boolean(state.activeAutomaticIncidentId), 'outage must retain active automatic incident state');

  mode = 'healthy';
  await runCheck();
  current = await readJson(path.join(runtimeDir, 'current.json'));
  incidents = await readJson(path.join(dataDir, 'incidents.json'));
  state = await readJson(path.join(dataDir, 'state.json'));

  assert(current.status === 'operational', 'recovered synthetic platform must report operational');
  assert(incidents.incidents[0].status === 'resolved', 'recovery must resolve the active automatic incident');
  assert(Boolean(incidents.incidents[0].resolvedAt), 'resolved incident must record resolution time');
  assert(state.activeAutomaticIncidentId === null, 'recovery must clear active automatic incident state');

  process.stdout.write('Independent status monitor self-test passed.\n');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}
