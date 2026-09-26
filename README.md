# Makronexus Status

Independent public service status for Makronexus Education.

This repository contains only the public monitoring surface, sanitized status history, incident communication, and GitHub Pages deployment workflow. It intentionally contains no school source code, credentials, tenant data, or private infrastructure details.

## Production boundaries

- `education.makronexus.com` — Makronexus Education web application on Vercel.
- `api.makronexus.com` — Makronexus Education API on Railway.
- `status.makronexus.com` — independent public status site on GitHub Pages.

## Local verification

```bash
node scripts/self-test.mjs
node scripts/check.mjs
node scripts/validate.mjs
node scripts/build.mjs
```

The static site is built to `dist/`.

## Monitoring

The monitor checks:

- the public web application;
- API liveness and readiness;
- the public authentication verification endpoint;
- the sanitized backend status contract.

Only monitored components are published. Finance, Attendance, Admissions, Academics, or other business modules are not independently labelled operational until they have dedicated safe synthetic probes.

Monitoring history is retained for 90 days. Status changes create automatic incident lifecycle entries. Availability and data integrity remain separate concepts.

## Public safety

Never place student, guardian, staff, school-specific, financial-record, credential, token, secret, hostname, bucket, stack trace, or private infrastructure data in this repository.

## Custom domain

GitHub Pages custom domain:

```text
status.makronexus.com
```

Authoritative DNS:

```text
status CNAME lgadza.github.io
```
