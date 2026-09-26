import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPONENTS,
  HISTORY_HEARTBEAT_MINUTES,
  HISTORY_RETENTION_DAYS,
  REQUEST_TIMEOUT_MS,
  STATUS_SCHEMA_VERSION,
  TARGETS,
  componentDefinition,
  worstStatus,
} from '../config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = process.env.STATUS_DATA_DIR
  ? path.resolve(process.env.STATUS_DATA_DIR)
  : path.join(root, 'data');
const runtimeDir = process.env.STATUS_RUNTIME_DIR
  ? path.resolve(process.env.STATUS_RUNTIME_DIR)
  : path.join(root, '.runtime');
const contentDir = process.env.STATUS_CONTENT_DIR
  ? path.resolve(process.env.STATUS_CONTENT_DIR)
  : path.join(root, 'content');

const now = new Date();
const nowIso = now.toISOString();

await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(runtimeDir, { recursive: true })]);

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function request(url, { json = false, validate } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
        'User-Agent': 'Makronexus-Status-Monitor/1.0',
      },
    });

    let body = null;
    if (json) {
      try {
        body = await response.json();
      } catch {
        return { ok: false, statusCode: response.status, durationMs: Date.now() - startedAt };
      }
    }

    const acceptedStatus = response.status >= 200 && response.status < 400;
    const acceptedBody = validate ? validate(body, response) : true;

    return {
      ok: acceptedStatus && acceptedBody,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      body,
    };
  } catch {
    return { ok: false, statusCode: null, durationMs: Date.now() - startedAt, body: null };
  } finally {
    clearTimeout(timer);
  }
}

function safeBackendStatus(value) {
  return ['operational', 'degraded', 'outage'].includes(value) ? value : 'outage';
}

function makeComponent(id, status) {
  const definition = componentDefinition(id);
  if (!definition) throw new Error(`Unknown status component: ${id}`);
  return { ...definition, status };
}

const [webProbe, livenessProbe, readinessProbe, jwksProbe, backendStatusProbe] = await Promise.all([
  request(TARGETS.web),
  request(`${TARGETS.api}/livez`, {
    json: true,
    validate: (body) => body?.alive === true,
  }),
  request(`${TARGETS.api}/readyz`, {
    json: true,
    validate: (body) => body?.ready === true,
  }),
  request(`${TARGETS.api}/.well-known/jwks.json`, {
    json: true,
    validate: (body) => Array.isArray(body?.keys) && body.keys.length > 0,
  }),
  request(`${TARGETS.api}/status.json`, {
    json: true,
    validate: (body) => body?.schemaVersion === 1 && Array.isArray(body?.components),
  }),
]);

const backendComponents = new Map(
  backendStatusProbe.ok
    ? backendStatusProbe.body.components.map((component) => [component.id, safeBackendStatus(component.status)])
    : []
);

const components = [
  makeComponent('web-application', webProbe.ok ? 'operational' : 'outage'),
  makeComponent(
    'api-sign-in',
    livenessProbe.ok && readinessProbe.ok && jwksProbe.ok ? 'operational' : 'outage'
  ),
  ...['core-services', 'school-data', 'background-processing', 'file-services'].map((id) =>
    makeComponent(id, backendStatusProbe.ok ? (backendComponents.get(id) || 'outage') : 'outage')
  ),
];

const measuredStatus = worstStatus(components.map((component) => component.status));
const maintenance = await readJson(path.join(contentDir, 'maintenance.json'), { windows: [] });
const activeMaintenance = (maintenance.windows || []).filter((window) => {
  if (!window?.startsAt || !window?.endsAt) return false;
  const startsAt = Date.parse(window.startsAt);
  const endsAt = Date.parse(window.endsAt);
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now.getTime() && now.getTime() < endsAt;
});
const publicStatus = measuredStatus === 'operational' && activeMaintenance.length > 0 ? 'maintenance' : measuredStatus;

const current = {
  schemaVersion: STATUS_SCHEMA_VERSION,
  generatedAt: nowIso,
  status: publicStatus,
  components,
  activeMaintenance: activeMaintenance.map(({ id, title, startsAt, endsAt, affectedComponents = [] }) => ({
    id,
    title,
    startsAt,
    endsAt,
    affectedComponents,
  })),
  dataIntegrity: {
    status: 'not-assessed',
    message:
      'Availability monitoring does not determine whether data loss occurred. Data integrity is assessed separately during incident response.',
  },
};

const statePath = path.join(dataDir, 'state.json');
const historyPath = path.join(dataDir, 'history.json');
const incidentsPath = path.join(dataDir, 'incidents.json');
const uptimePath = path.join(dataDir, 'uptime.json');

const previousState = await readJson(statePath, {
  schemaVersion: STATUS_SCHEMA_VERSION,
  lastCurrent: null,
  lastPersistedSampleAt: null,
  activeAutomaticIncidentId: null,
});
const historyDocument = await readJson(historyPath, { schemaVersion: STATUS_SCHEMA_VERSION, samples: [] });
const incidentsDocument = await readJson(incidentsPath, { schemaVersion: STATUS_SCHEMA_VERSION, incidents: [] });

const previousCurrent = previousState.lastCurrent;
const previousMeasuredStatus = previousCurrent
  ? worstStatus((previousCurrent.components || []).map((component) => component.status))
  : null;
const previousById = new Map((previousCurrent?.components || []).map((component) => [component.id, component.status]));
const changedComponents = components.filter((component) => previousById.get(component.id) !== component.status);
const statusChanged = previousMeasuredStatus !== measuredStatus || changedComponents.length > 0;

const lastPersistedAt = previousState.lastPersistedSampleAt
  ? Date.parse(previousState.lastPersistedSampleAt)
  : Number.NaN;
const heartbeatElapsed =
  !Number.isFinite(lastPersistedAt) ||
  now.getTime() - lastPersistedAt >= HISTORY_HEARTBEAT_MINUTES * 60_000;

const samples = Array.isArray(historyDocument.samples) ? historyDocument.samples : [];
if (statusChanged || heartbeatElapsed || samples.length === 0) {
  samples.push({
    timestamp: nowIso,
    status: publicStatus,
    measuredStatus,
    components: Object.fromEntries(components.map((component) => [component.id, component.status])),
  });
  previousState.lastPersistedSampleAt = nowIso;
}

const retentionStart = now.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60_000;
const retainedSamples = samples.filter((sample) => {
  const time = Date.parse(sample.timestamp);
  return Number.isFinite(time) && time >= retentionStart;
});
retainedSamples.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

function unavailableComponents(currentComponents) {
  return currentComponents.filter((component) => component.status !== 'operational').map((component) => component.id);
}

function makeIncidentUpdate(status, message) {
  return { timestamp: nowIso, status, message };
}

let activeIncidentId = previousState.activeAutomaticIncidentId || null;
let incidents = Array.isArray(incidentsDocument.incidents) ? incidentsDocument.incidents : [];
let activeIncident = activeIncidentId ? incidents.find((incident) => incident.id === activeIncidentId) : null;

if (!activeIncident && measuredStatus !== 'operational') {
  const id = `auto-${nowIso.replace(/[:.]/g, '-')}`;
  const affectedComponents = unavailableComponents(components);
  activeIncident = {
    id,
    source: 'automatic',
    title: measuredStatus === 'outage' ? 'Service interruption detected' : 'Degraded service detected',
    status: 'investigating',
    impact: measuredStatus === 'outage' ? 'major' : 'degraded',
    startedAt: nowIso,
    resolvedAt: null,
    affectedComponents,
    dataIntegrity: 'unknown',
    updates: [
      makeIncidentUpdate(
        'investigating',
        'Independent monitoring detected reduced service availability. Platform Operations should confirm impact and data integrity separately.'
      ),
    ],
  };
  incidents.unshift(activeIncident);
  activeIncidentId = id;
} else if (activeIncident) {
  if (measuredStatus === 'operational') {
    activeIncident.status = 'resolved';
    activeIncident.resolvedAt = nowIso;
    activeIncident.updates.push(
      makeIncidentUpdate(
        'resolved',
        'External monitoring confirms that measured services have returned to normal operation. This recovery signal does not by itself establish data-integrity impact.'
      )
    );
    activeIncidentId = null;
  } else if (statusChanged) {
    const affectedComponents = unavailableComponents(components);
    const previousAffected = new Set(activeIncident.affectedComponents || []);
    const improved =
      previousMeasuredStatus === 'outage' && measuredStatus === 'degraded' &&
      affectedComponents.every((id) => previousAffected.has(id));

    activeIncident.status = improved ? 'monitoring' : 'investigating';
    activeIncident.impact = measuredStatus === 'outage' ? 'major' : 'degraded';
    activeIncident.affectedComponents = affectedComponents;
    activeIncident.updates.push(
      makeIncidentUpdate(
        activeIncident.status,
        improved
          ? 'External monitoring shows recovery progress. The affected services remain under observation.'
          : 'External monitoring detected a material change in the affected services. Platform Operations should verify customer impact.'
      )
    );
  }
}

incidents = incidents
  .filter((incident) => incident?.id && incident?.startedAt)
  .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  .slice(0, 100);

function windowAvailability(samplesForWindow, windowDays, selector) {
  const windowEnd = now.getTime();
  const windowStart = windowEnd - windowDays * 24 * 60 * 60_000;
  const sorted = [...samplesForWindow].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (sorted.length === 0) return null;

  let indexAtStart = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    if (Date.parse(sorted[index].timestamp) <= windowStart) indexAtStart = index;
    else break;
  }

  const effective = indexAtStart >= 0
    ? sorted.slice(indexAtStart)
    : sorted.filter((sample) => Date.parse(sample.timestamp) >= windowStart);
  if (effective.length === 0) return null;

  let observedMs = 0;
  let availableMs = 0;
  for (let index = 0; index < effective.length; index += 1) {
    const sample = effective[index];
    const sampleTime = Math.max(Date.parse(sample.timestamp), windowStart);
    const nextTime = index + 1 < effective.length
      ? Math.min(Date.parse(effective[index + 1].timestamp), windowEnd)
      : windowEnd;
    const duration = Math.max(0, nextTime - sampleTime);
    if (duration === 0) continue;

    observedMs += duration;
    const status = selector(sample);
    if (status !== 'outage') availableMs += duration;
  }

  if (observedMs === 0) return null;
  return Number(((availableMs / observedMs) * 100).toFixed(3));
}

function uptimePeriod(days) {
  return {
    observedFrom: retainedSamples.length ? retainedSamples[0].timestamp : null,
    overall: windowAvailability(retainedSamples, days, (sample) => sample.measuredStatus || sample.status),
    components: Object.fromEntries(
      COMPONENTS.map((component) => [
        component.id,
        windowAvailability(retainedSamples, days, (sample) => sample.components?.[component.id] || 'outage'),
      ])
    ),
  };
}

const uptime = {
  schemaVersion: STATUS_SCHEMA_VERSION,
  generatedAt: nowIso,
  periods: {
    '30d': uptimePeriod(30),
    '90d': uptimePeriod(90),
  },
};

previousState.schemaVersion = STATUS_SCHEMA_VERSION;
previousState.lastCurrent = current;
previousState.activeAutomaticIncidentId = activeIncidentId;

await Promise.all([
  writeJson(path.join(runtimeDir, 'current.json'), current),
  writeJson(statePath, previousState),
  writeJson(historyPath, { schemaVersion: STATUS_SCHEMA_VERSION, samples: retainedSamples }),
  writeJson(incidentsPath, { schemaVersion: STATUS_SCHEMA_VERSION, incidents }),
  writeJson(uptimePath, uptime),
]);

const statusLine = `${current.status.toUpperCase()} · ${components
  .map((component) => `${component.id}=${component.status}`)
  .join(' ')}`;
process.stdout.write(`${statusLine}\n`);
