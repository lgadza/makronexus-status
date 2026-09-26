const STATUS_COPY = {
  unknown: {
    label: 'Status unconfirmed',
    headline: 'Current service status is being established.',
  },
  operational: {
    label: 'Operational',
    headline: 'All monitored services are operating normally.',
  },
  degraded: {
    label: 'Degraded performance',
    headline: 'Some monitored services are operating with reduced availability.',
  },
  outage: {
    label: 'Service disruption',
    headline: 'One or more monitored services are currently unavailable.',
  },
  maintenance: {
    label: 'Scheduled maintenance',
    headline: 'Planned maintenance is currently in progress.',
  },
};

function statusCopy(status) {
  return STATUS_COPY[status] || STATUS_COPY.unknown;
}

function statusPill(status) {
  const span = document.createElement('span');
  span.className = `status-pill status-${status}`;
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = statusCopy(status).label;
  span.append(dot, label);
  return span;
}

function formatDate(value, { long = false } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, long
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

async function getJson(url) {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}

const LIVE_WEB_PROBE_URL = 'https://education.makronexus.com/api/status-probe';
const LIVE_API_STATUS_URL = 'https://api.makronexus.com/status.json';
const LIVE_REFRESH_MS = 60_000;
const LIVE_TIMEOUT_MS = 8_000;
const PROBE_SEEN_PREFIX = 'makronexus-status-probe-seen:';

const PUBLISHED_COMPONENTS = [
  {
    id: 'web-application',
    name: 'Web application',
    description: 'Access to the Makronexus Education web experience.',
  },
  {
    id: 'api-sign-in',
    name: 'API & sign-in',
    description: 'Core API availability and sign-in supporting services.',
  },
  {
    id: 'core-services',
    name: 'Core school services',
    description: 'Application services used for day-to-day school operations.',
  },
  {
    id: 'school-data',
    name: 'School data services',
    description: 'Availability of school records and transactional data.',
  },
  {
    id: 'background-processing',
    name: 'Background processing',
    description: 'Shared queue and session infrastructure used by background work.',
  },
  {
    id: 'file-services',
    name: 'Files & documents',
    description: 'Persistent file and document storage used by the platform.',
  },
];

function normalizeStatus(value) {
  return ['operational', 'degraded', 'outage', 'maintenance'].includes(value)
    ? value
    : 'unknown';
}

function markProbeSeen(id) {
  try {
    sessionStorage.setItem(`${PROBE_SEEN_PREFIX}${id}`, '1');
  } catch {}
}

function hasProbeBeenSeen(id) {
  try {
    return sessionStorage.getItem(`${PROBE_SEEN_PREFIX}${id}`) === '1';
  } catch {
    return false;
  }
}

function failedProbeStatus(id) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'unknown';
  return hasProbeBeenSeen(id) ? 'outage' : 'unknown';
}

async function getRemoteJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}?v=${Date.now()}`, {
      cache: 'no-store',
      mode: 'cors',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function overallStatus(statuses) {
  if (statuses.includes('outage')) return 'outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('maintenance')) return 'maintenance';
  if (statuses.length > 0 && statuses.every((status) => status === 'operational')) return 'operational';
  return 'unknown';
}

async function loadLiveCurrent() {
  const [webResult, apiResult] = await Promise.allSettled([
    getRemoteJson(LIVE_WEB_PROBE_URL),
    getRemoteJson(LIVE_API_STATUS_URL),
  ]);

  const webValid =
    webResult.status === 'fulfilled' &&
    webResult.value?.schemaVersion === 1 &&
    webResult.value?.status === 'operational';

  if (webValid) markProbeSeen('web');

  const apiValid =
    apiResult.status === 'fulfilled' &&
    apiResult.value?.schemaVersion === 1 &&
    Array.isArray(apiResult.value?.components);

  if (apiValid) markProbeSeen('api');

  const webStatus = webValid ? 'operational' : failedProbeStatus('web');
  const apiSnapshot = apiValid ? apiResult.value : null;
  const apiStatus = apiSnapshot ? normalizeStatus(apiSnapshot.status) : failedProbeStatus('api');
  const backendById = new Map(
    (apiSnapshot?.components || []).map((component) => [
      component.id,
      normalizeStatus(component.status),
    ]),
  );

  const components = PUBLISHED_COMPONENTS.map((component) => {
    if (component.id === 'web-application') return { ...component, status: webStatus };
    if (component.id === 'api-sign-in') return { ...component, status: apiStatus };

    const status = apiSnapshot
      ? (backendById.get(component.id) || 'outage')
      : failedProbeStatus('api');

    return { ...component, status };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: overallStatus(components.map((component) => component.status)),
    components,
    dataIntegrity: apiSnapshot?.dataIntegrity || {
      status: 'not-assessed',
      message: 'Availability monitoring does not determine whether data loss occurred.',
    },
  };
}

function renderOverall(current) {
  const root = document.querySelector('#overall');
  root.replaceChildren();
  const row = document.createElement('div');
  row.className = 'overall-row';
  const copy = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'overall-title';
  title.textContent = statusCopy(current.status).headline;
  const description = document.createElement('p');
  description.textContent = current.status === 'unknown'
    ? 'The status page is online, but one or more live checks have not yet been confirmed from this browser.'
    : current.status === 'operational'
      ? 'Live checks are confirming normal availability across the services listed below.'
      : 'Live checks are reporting reduced availability. See the affected services and incident history below.';
  copy.append(title, description);
  row.append(copy, statusPill(current.status));
  root.append(row);
}

function renderComponents(current) {
  const root = document.querySelector('#components');
  root.replaceChildren();
  for (const component of current.components || []) {
    const row = document.createElement('article');
    row.className = 'component';
    const copy = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = component.name;
    const description = document.createElement('p');
    description.textContent = component.description;
    copy.append(title, description);
    row.append(copy, statusPill(component.status));
    root.append(row);
  }
}

function renderUptime(uptime) {
  const root = document.querySelector('#uptime');
  const section = document.querySelector('#reliability-section');
  const periods = ['30d', '90d'];
  const hasMeasuredHistory = periods.some(
    (period) => typeof uptime.periods?.[period]?.overall === 'number',
  );

  if (!hasMeasuredHistory) {
    if (section) section.hidden = true;
    root.replaceChildren();
    return;
  }

  if (section) section.hidden = false;
  root.replaceChildren();

  for (const period of periods) {
    const card = document.createElement('article');
    card.className = 'uptime-card';
    const label = document.createElement('div');
    label.className = 'period';
    label.textContent = period === '30d' ? 'Last 30 days' : 'Last 90 days';
    const value = document.createElement('div');
    value.className = 'uptime-value';
    const measured = uptime.periods?.[period]?.overall;
    value.textContent = typeof measured === 'number' ? `${measured.toFixed(3)}%` : 'Not enough history';
    const description = document.createElement('p');
    description.textContent = typeof measured === 'number'
      ? 'Observed availability. Degraded periods remain available; confirmed outages count as unavailable.'
      : 'This period does not yet contain enough continuous observations.';
    card.append(label, value, description);
    root.append(card);
  }
}

function renderMaintenance(maintenance) {
  const windows = (maintenance.windows || [])
    .filter((window) => window?.startsAt && window?.endsAt && Date.parse(window.endsAt) >= Date.now())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const section = document.querySelector('#maintenance-section');
  if (!windows.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const root = document.querySelector('#maintenance');
  root.replaceChildren();
  for (const window of windows) {
    const item = document.createElement('article');
    item.className = 'timeline-item';
    const top = document.createElement('div');
    top.className = 'timeline-top';
    const title = document.createElement('h3');
    title.textContent = window.title || 'Scheduled maintenance';
    const meta = document.createElement('span');
    meta.className = 'timeline-meta';
    meta.textContent = `${formatDate(window.startsAt, { long: true })} – ${formatDate(window.endsAt, { long: true })}`;
    top.append(title, meta);
    const description = document.createElement('p');
    description.textContent = window.message || 'Planned platform maintenance.';
    item.append(top, description);
    root.append(item);
  }
}

function renderIncidents(automatic, manual) {
  const incidents = [...(manual.incidents || []), ...(automatic.incidents || [])]
    .filter((incident) => incident?.id && incident?.startedAt)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, 12);
  const root = document.querySelector('#incidents');
  root.replaceChildren();

  if (!incidents.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No incidents have been recorded by this status system.';
    root.append(empty);
    return;
  }

  for (const incident of incidents) {
    const item = document.createElement('article');
    item.className = 'timeline-item';
    const top = document.createElement('div');
    top.className = 'timeline-top';
    const title = document.createElement('h3');
    title.textContent = incident.title || 'Service incident';
    const meta = document.createElement('span');
    meta.className = 'timeline-meta';
    meta.textContent = `${incident.status || 'investigating'} · ${formatDate(incident.startedAt, { long: true })}`;
    top.append(title, meta);

    const integrity = document.createElement('p');
    const integrityLabel = incident.dataIntegrity || 'unknown';
    integrity.textContent = `Data integrity: ${integrityLabel}.`;
    item.append(top, integrity);

    if (Array.isArray(incident.updates) && incident.updates.length) {
      const updates = document.createElement('ul');
      updates.className = 'incident-updates';
      for (const update of [...incident.updates].reverse().slice(0, 4)) {
        const entry = document.createElement('li');
        entry.textContent = `${formatDate(update.timestamp, { long: true })} — ${update.message}`;
        updates.append(entry);
      }
      item.append(updates);
    }
    root.append(item);
  }
}

function renderFailure() {
  const root = document.querySelector('#overall');
  root.classList.add('error-panel');
  root.replaceChildren();
  const title = document.createElement('div');
  title.className = 'overall-title';
  title.textContent = 'Status data could not be loaded.';
  const description = document.createElement('p');
  description.textContent = 'The independent status page is reachable, but its latest monitoring snapshot is unavailable. Treat service availability as unconfirmed.';
  root.append(title, description);
}

async function refreshCurrentStatus() {
  try {
    const current = await loadLiveCurrent();
    document.querySelector('#last-checked').textContent =
      `Live check ${formatDate(current.generatedAt, { long: true })} · refreshes every 60 seconds`;
    renderOverall(current);
    renderComponents(current);
  } catch (error) {
    console.error(error);
    document.querySelector('#last-checked').textContent = 'Current availability unconfirmed';
    renderFailure();
  }
}

async function init() {
  try {
    const [uptime, automaticIncidents, manualIncidents, maintenance] = await Promise.all([
      getJson('./data/uptime.json'),
      getJson('./data/incidents.json'),
      getJson('./data/manual-incidents.json'),
      getJson('./data/maintenance.json'),
    ]);

    renderUptime(uptime);
    renderMaintenance(maintenance);
    renderIncidents(automaticIncidents, manualIncidents);
  } catch (error) {
    console.error('Unable to load historical status data', error);
  }

  await refreshCurrentStatus();

  window.setInterval(refreshCurrentStatus, LIVE_REFRESH_MS);
  window.addEventListener('focus', refreshCurrentStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshCurrentStatus();
  });
}

init();
