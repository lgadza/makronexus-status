export const STATUS_SCHEMA_VERSION = 1;
export const HISTORY_RETENTION_DAYS = 90;
export const HISTORY_HEARTBEAT_MINUTES = 60;
export const REQUEST_TIMEOUT_MS = 10_000;

export const TARGETS = {
  web: process.env.STATUS_WEB_URL || 'https://education.makronexus.com',
  api: (process.env.STATUS_API_URL || 'https://api.makronexus.com').replace(/\/$/, ''),
};

export const COMPONENTS = [
  {
    id: 'web-application',
    name: 'Web application',
    description: 'Access to the Makronexus Education web experience.',
  },
  {
    id: 'api-sign-in',
    name: 'API & sign-in',
    description: 'Core API availability and the public sign-in verification substrate.',
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

export const STATUS_RANK = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  outage: 3,
};

export function worstStatus(statuses) {
  if (!statuses.length) return 'outage';
  return statuses.reduce((worst, status) =>
    STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst
  , 'operational');
}

export function componentDefinition(id) {
  return COMPONENTS.find((component) => component.id === id) || null;
}
