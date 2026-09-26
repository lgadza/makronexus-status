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
    ? 'The independent status site is online, but a fresh monitoring snapshot is not yet available.'
    : current.status === 'operational'
      ? 'Independent checks are currently confirming normal availability across the services listed below.'
      : 'Platform Operations should use the incident history and internal telemetry to confirm scope and customer impact.';
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
  root.replaceChildren();
  for (const period of ['30d', '90d']) {
    const card = document.createElement('article');
    card.className = 'uptime-card';
    const label = document.createElement('div');
    label.className = 'period';
    label.textContent = period === '30d' ? 'Last 30 days' : 'Last 90 days';
    const value = document.createElement('div');
    value.className = 'uptime-value';
    const measured = uptime.periods?.[period]?.overall;
    value.textContent = typeof measured === 'number' ? `${measured.toFixed(3)}%` : 'Building history';
    const description = document.createElement('p');
    description.textContent = typeof measured === 'number'
      ? 'Observed availability. Degraded periods remain available; confirmed outages count as unavailable.'
      : 'The status monitor needs more external observations before publishing a reliability percentage.';
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

async function init() {
  try {
    const [current, uptime, automaticIncidents, manualIncidents, maintenance] = await Promise.all([
      getJson('./data/current.json'),
      getJson('./data/uptime.json'),
      getJson('./data/incidents.json'),
      getJson('./data/manual-incidents.json'),
      getJson('./data/maintenance.json'),
    ]);

    document.querySelector('#last-checked').textContent = `Last checked ${formatDate(current.generatedAt, { long: true })}`;
    renderOverall(current);
    renderComponents(current);
    renderUptime(uptime);
    renderMaintenance(maintenance);
    renderIncidents(automaticIncidents, manualIncidents);
  } catch (error) {
    console.error(error);
    document.querySelector('#last-checked').textContent = 'Current availability unconfirmed';
    renderFailure();
  }
}

init();
