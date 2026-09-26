const LIVE_WEB_PROBE_URL = 'https://education.makronexus.com/api/status-probe';
const LIVE_WEB_REACHABILITY_FALLBACK_URL = 'https://education.makronexus.com/api/platform-status';
const LIVE_API_STATUS_URL = 'https://api.makronexus.com/status.json';
const LIVE_REFRESH_MS = 60_000;
const LIVE_TIMEOUT_MS = 8_000;
const PROBE_SEEN_PREFIX = 'makronexus-status-probe-seen:';

const COMPONENTS = [
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
    description: 'Queues, sessions, notifications, and deferred processing.',
  },
  {
    id: 'file-services',
    name: 'Files & documents',
    description: 'Persistent files and documents used across school workflows.',
  },
];

const STATUS_LABELS = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  maintenance: 'Maintenance',
  unknown: 'Unconfirmed',
};

const OVERALL_COPY = {
  operational: {
    title: 'All core systems operational',
    message: "We're not aware of any issues affecting Makronexus Education.",
    icon: '✓',
  },
  degraded: {
    title: 'Some services are experiencing reduced availability',
    message: 'Makronexus Education remains available, but one or more monitored services are degraded.',
    icon: '!',
  },
  outage: {
    title: 'We are investigating a service disruption',
    message: 'One or more monitored services are currently unavailable. See affected services and continuity guidance below.',
    icon: '×',
  },
  maintenance: {
    title: 'Scheduled maintenance is in progress',
    message: 'Planned work is affecting one or more services. See the maintenance notice below for scope and timing.',
    icon: '!',
  },
  unknown: {
    title: 'Checking platform status…',
    message: 'Live checks are establishing the current availability of Makronexus Education.',
    icon: '•',
  },
};

const GUIDANCE_LIBRARY = {
  'web-application': {
    title: 'If the web application is unavailable',
    summary: 'Continue through your school’s local or offline workflow if it is configured.',
    detail:
      'Avoid repeatedly refreshing or resubmitting the same action. If your school has Local Hub or offline access configured, continue there and allow normal synchronization after cloud access returns.',
    icon: 'W',
  },
  'api-sign-in': {
    title: 'If sign-in is affected',
    summary: 'Avoid repeated sign-in attempts and preserve any active working session.',
    detail:
      'Existing sessions may continue for a period depending on the workflow. If your school has a configured local/offline environment, use that path. Do not share credentials or create temporary accounts as a workaround.',
    icon: 'S',
  },
  'core-services': {
    title: 'If core school services are disrupted',
    summary: 'Pause duplicate submissions and preserve source records until service is restored.',
    detail:
      'For admissions, attendance, finance, academics, and other transactional workflows, keep the original paper or digital source record. Enter or reconcile it once normal service returns rather than submitting the same operation repeatedly.',
    icon: 'E',
  },
  'school-data': {
    title: 'If school data access is degraded',
    summary: 'Do not recreate missing records while availability is uncertain.',
    detail:
      'A temporarily unavailable record is not proof that it has been deleted. Avoid duplicate student, payment, admission, or staff entries until data services are confirmed healthy.',
    icon: 'D',
  },
  'background-processing': {
    title: 'If processing is delayed',
    summary: 'Allow queued work time to complete before retrying the same task.',
    detail:
      'Notifications, report generation, imports, synchronization, and other deferred work can recover after the service returns. Repeated retries can create duplicate operational work.',
    icon: 'Q',
  },
  'file-services': {
    title: 'If files or documents are unavailable',
    summary: 'Keep local copies and upload again only after file services recover.',
    detail:
      'Do not assume an upload has failed solely because a preview is unavailable. Preserve the original document and verify the final status before uploading a duplicate.',
    icon: 'F',
  },
};

let latestCurrent = null;
let observedHistory = { samples: [] };
let uptimeDocument = { periods: {} };
let incidentDocument = { incidents: [] };
let manualIncidentDocument = { incidents: [] };
let maintenanceDocument = { windows: [] };

function normalizeStatus(value) {
  return ['operational', 'degraded', 'outage', 'maintenance'].includes(value)
    ? value
    : 'unknown';
}

function formatDate(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, options.long
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
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

async function getJson(url) {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
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

async function probeWebApplication() {
  try {
    const payload = await getRemoteJson(LIVE_WEB_PROBE_URL);
    if (payload?.schemaVersion !== 1 || payload?.status !== 'operational') {
      throw new Error('Invalid web probe contract');
    }
    return payload;
  } catch {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);

    try {
      await fetch(
        `${LIVE_WEB_REACHABILITY_FALLBACK_URL}?reachability=${Date.now()}`,
        {
          cache: 'no-store',
          mode: 'no-cors',
          signal: controller.signal,
        },
      );

      return {
        schemaVersion: 1,
        status: 'operational',
        generatedAt: new Date().toISOString(),
        reachabilityOnly: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function worstStatus(statuses) {
  if (statuses.includes('outage')) return 'outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('maintenance')) return 'maintenance';
  if (statuses.length && statuses.every((status) => status === 'operational')) {
    return 'operational';
  }
  return 'unknown';
}

async function loadLiveCurrent() {
  const [webResult, apiResult] = await Promise.allSettled([
    probeWebApplication(),
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
  const apiStatus = apiSnapshot
    ? normalizeStatus(apiSnapshot.status)
    : failedProbeStatus('api');

  const backendById = new Map(
    (apiSnapshot?.components || []).map((component) => [
      component.id,
      normalizeStatus(component.status),
    ]),
  );

  const components = COMPONENTS.map((component) => {
    if (component.id === 'web-application') {
      return { ...component, status: webStatus };
    }

    if (component.id === 'api-sign-in') {
      return { ...component, status: apiStatus };
    }

    return {
      ...component,
      status: apiSnapshot
        ? backendById.get(component.id) || 'outage'
        : failedProbeStatus('api'),
    };
  });

  const activeMaintenance = (maintenanceDocument.windows || []).filter((window) => {
    const startsAt = Date.parse(window?.startsAt);
    const endsAt = Date.parse(window?.endsAt);
    const now = Date.now();
    return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now < endsAt;
  });

  const measured = worstStatus(components.map((component) => component.status));
  const status =
    measured === 'operational' && activeMaintenance.length ? 'maintenance' : measured;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    components,
    activeMaintenance,
    dataIntegrity: apiSnapshot?.dataIntegrity || {
      status: 'not-assessed',
      message: 'Availability monitoring does not determine whether data loss occurred.',
    },
  };
}

function currentComponentMap(current) {
  return new Map((current?.components || []).map((component) => [component.id, component]));
}

function renderOverall(current) {
  const panel = document.querySelector('#overall-panel');
  const title = document.querySelector('#overall-title');
  const message = document.querySelector('#overall-message');
  const icon = panel.querySelector('.overall-icon');

  const status = normalizeStatus(current?.status);
  const copy = OVERALL_COPY[status] || OVERALL_COPY.unknown;

  panel.className = `overall-panel status-${status}`;
  title.textContent = copy.title;
  message.textContent = copy.message;
  icon.textContent = copy.icon;

  document.querySelector('#last-checked').textContent =
    `Live check ${formatDate(current.generatedAt, { long: true })} · refreshes every 60 seconds`;
}

function historyStatusesForComponent(componentId, count = 30) {
  const samples = Array.isArray(observedHistory.samples)
    ? observedHistory.samples
    : [];

  const values = samples
    .slice(-count)
    .map((sample) => normalizeStatus(sample.components?.[componentId]));

  while (values.length < count) values.unshift('unknown');
  return values.slice(-count);
}

function renderHistoryStrip(componentId) {
  const strip = document.createElement('div');
  strip.className = 'history-strip';
  strip.setAttribute('aria-label', 'Recent observed availability');

  for (const status of historyStatusesForComponent(componentId)) {
    const bar = document.createElement('span');
    bar.className = `history-bar ${status}`;
    bar.title = STATUS_LABELS[status] || 'Unconfirmed';
    strip.append(bar);
  }

  return strip;
}

function componentUptime(componentId) {
  const value = uptimeDocument.periods?.['30d']?.components?.[componentId];
  return typeof value === 'number' ? value : null;
}

function renderServices(current) {
  const root = document.querySelector('#service-list');
  root.replaceChildren();

  const byId = currentComponentMap(current);

  for (const definition of COMPONENTS) {
    const component = byId.get(definition.id) || {
      ...definition,
      status: 'unknown',
    };

    const row = document.createElement('article');
    row.className = 'service-row';

    const identity = document.createElement('div');
    identity.className = 'service-identity';

    const icon = document.createElement('span');
    icon.className = `service-status-icon ${component.status}`;
    icon.textContent =
      component.status === 'operational'
        ? '✓'
        : component.status === 'outage'
          ? '×'
          : component.status === 'unknown'
            ? '•'
            : '!';

    const name = document.createElement('div');
    name.className = 'service-name';

    const strong = document.createElement('strong');
    strong.textContent = component.name;

    const description = document.createElement('span');
    description.textContent = component.description;

    name.append(strong, description);
    identity.append(icon, name);

    const history = renderHistoryStrip(component.id);

    const summary = document.createElement('div');
    summary.className = 'service-summary';

    const status = document.createElement('strong');
    status.className = component.status;

    const uptime = componentUptime(component.id);
    if (uptime !== null) {
      status.textContent = `${uptime.toFixed(2)}%`;
    } else {
      status.textContent = STATUS_LABELS[component.status] || 'Unconfirmed';
    }

    const secondary = document.createElement('span');
    secondary.textContent =
      uptime !== null ? '30-day observed uptime' : 'History collecting';

    summary.append(status, secondary);
    row.append(identity, history, summary);
    root.append(row);
  }
}

function affectedComponents(current) {
  return (current.components || []).filter(
    (component) => !['operational', 'unknown'].includes(component.status),
  );
}

function renderActiveIncident(current) {
  const section = document.querySelector('#active-incident-section');
  const body = document.querySelector('#active-incident-body');
  const badge = document.querySelector('#active-incident-status');
  const affected = affectedComponents(current);

  if (!affected.length || current.status === 'operational') {
    section.hidden = true;
    body.replaceChildren();
    return;
  }

  section.hidden = false;

  const status = current.status === 'maintenance' ? 'monitoring' : 'investigating';
  badge.className = `incident-badge ${status}`;
  badge.textContent =
    current.status === 'maintenance' ? 'In progress' : 'Investigating';

  body.replaceChildren();

  const content = document.createElement('div');
  content.className = 'active-incident-content';

  const message = document.createElement('p');
  message.textContent =
    current.status === 'maintenance'
      ? 'Scheduled work is currently affecting the services listed below.'
      : 'Live monitoring has detected reduced availability. Makronexus is verifying customer impact and the underlying cause.';

  const chips = document.createElement('div');
  chips.className = 'affected-services';

  for (const component of affected) {
    const chip = document.createElement('span');
    chip.className = 'affected-chip';
    chip.textContent = component.name;
    chips.append(chip);
  }

  content.append(message, chips);
  body.append(content);
}

function incidentSortValue(incident) {
  return Date.parse(incident.startedAt || incident.timestamp || 0) || 0;
}

function renderIncidents() {
  const root = document.querySelector('#incidents');
  root.replaceChildren();

  const incidents = [
    ...(manualIncidentDocument.incidents || []),
    ...(incidentDocument.incidents || []),
  ]
    .filter((incident) => incident?.id || incident?.title)
    .sort((a, b) => incidentSortValue(b) - incidentSortValue(a))
    .slice(0, 6);

  if (!incidents.length) {
    const empty = document.createElement('div');
    empty.className = 'timeline-empty';
    empty.textContent =
      'No incidents have been recorded in the current reporting history.';
    root.append(empty);
    return;
  }

  for (const incident of incidents) {
    const item = document.createElement('article');
    item.className = 'timeline-item';

    const top = document.createElement('div');
    top.className = 'timeline-item-top';

    const left = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'timeline-title';

    const strong = document.createElement('strong');
    strong.textContent = incident.title || 'Service incident';

    title.append(strong);

    const meta = document.createElement('div');
    meta.className = 'timeline-meta';
    meta.textContent = incident.startedAt
      ? formatDate(incident.startedAt, { long: true })
      : 'Time not available';

    left.append(title, meta);

    const badge = document.createElement('span');
    const incidentStatus = incident.status || 'investigating';
    badge.className = `incident-badge ${incidentStatus}`;
    badge.textContent =
      incidentStatus.charAt(0).toUpperCase() + incidentStatus.slice(1);

    top.append(left, badge);

    item.append(top);

    const latestUpdate = Array.isArray(incident.updates)
      ? incident.updates[incident.updates.length - 1]
      : null;

    if (latestUpdate?.message) {
      const copy = document.createElement('p');
      copy.className = 'timeline-copy';
      copy.textContent = latestUpdate.message;
      item.append(copy);
    }

    root.append(item);
  }
}

function renderMaintenance() {
  const section = document.querySelector('#maintenance-section');
  const root = document.querySelector('#maintenance');

  const windows = (maintenanceDocument.windows || [])
    .filter((window) => window?.startsAt && window?.endsAt && Date.parse(window.endsAt) >= Date.now())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  if (!windows.length) {
    section.hidden = true;
    root.replaceChildren();
    return;
  }

  section.hidden = false;
  root.replaceChildren();

  for (const window of windows) {
    const item = document.createElement('article');
    item.className = 'timeline-item';

    const top = document.createElement('div');
    top.className = 'timeline-item-top';

    const left = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'timeline-title';

    const strong = document.createElement('strong');
    strong.textContent = window.title || 'Scheduled maintenance';

    title.append(strong);

    const meta = document.createElement('div');
    meta.className = 'timeline-meta';
    meta.textContent =
      `${formatDate(window.startsAt, { long: true })} – ${formatDate(window.endsAt, { long: true })}`;

    left.append(title, meta);

    const badge = document.createElement('span');
    badge.className = 'incident-badge monitoring';
    badge.textContent = 'Scheduled';

    top.append(left, badge);

    const copy = document.createElement('p');
    copy.className = 'timeline-copy';
    copy.textContent = window.message || 'Planned Makronexus platform maintenance.';

    item.append(top, copy);
    root.append(item);
  }
}

function guidanceOrder(current) {
  const nonOperational = (current.components || [])
    .filter((component) => component.status !== 'operational')
    .map((component) => component.id);

  const all = COMPONENTS.map((component) => component.id);

  return [
    ...nonOperational,
    ...all.filter((id) => !nonOperational.includes(id)),
  ].slice(0, 4);
}

function renderGuidance(current) {
  const root = document.querySelector('#continuity-guidance');
  root.replaceChildren();

  for (const id of guidanceOrder(current)) {
    const guidance = GUIDANCE_LIBRARY[id];
    if (!guidance) continue;

    const item = document.createElement('article');
    item.className = 'guidance-item';

    const button = document.createElement('button');
    button.className = 'guidance-button';
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');

    const icon = document.createElement('span');
    icon.className = 'guidance-icon';
    icon.textContent = guidance.icon;

    const copy = document.createElement('span');
    copy.className = 'guidance-copy';

    const strong = document.createElement('strong');
    strong.textContent = guidance.title;

    const summary = document.createElement('span');
    summary.textContent = guidance.summary;

    copy.append(strong, summary);

    const chevron = document.createElement('span');
    chevron.className = 'guidance-chevron';
    chevron.textContent = '›';

    button.append(icon, copy, chevron);

    const detail = document.createElement('div');
    detail.className = 'guidance-detail';
    detail.textContent = guidance.detail;

    button.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
    });

    item.append(button, detail);
    root.append(item);
  }
}

function renderCurrent(current) {
  latestCurrent = current;
  renderOverall(current);
  renderServices(current);
  renderActiveIncident(current);
  renderGuidance(current);
}

async function refreshCurrentStatus() {
  try {
    const current = await loadLiveCurrent();
    renderCurrent(current);
  } catch (error) {
    console.error('Unable to complete live status checks', error);

    renderCurrent({
      generatedAt: new Date().toISOString(),
      status: 'unknown',
      components: COMPONENTS.map((component) => ({
        ...component,
        status: 'unknown',
      })),
    });
  }
}

async function loadStaticStatusData() {
  const results = await Promise.allSettled([
    getJson('./data/history.json'),
    getJson('./data/uptime.json'),
    getJson('./data/incidents.json'),
    getJson('./data/manual-incidents.json'),
    getJson('./data/maintenance.json'),
  ]);

  if (results[0].status === 'fulfilled') observedHistory = results[0].value;
  if (results[1].status === 'fulfilled') uptimeDocument = results[1].value;
  if (results[2].status === 'fulfilled') incidentDocument = results[2].value;
  if (results[3].status === 'fulfilled') manualIncidentDocument = results[3].value;
  if (results[4].status === 'fulfilled') maintenanceDocument = results[4].value;

  renderIncidents();
  renderMaintenance();
}

async function init() {
  await loadStaticStatusData();
  await refreshCurrentStatus();

  window.setInterval(refreshCurrentStatus, LIVE_REFRESH_MS);

  window.addEventListener('focus', refreshCurrentStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshCurrentStatus();
  });
}

init();
