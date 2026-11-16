# Public Status Monitoring Recovery — 16 November 2026

## Observed production failure

- The GitHub Pages branch `gh-pages` still serves `data/summary.json` with
  `generatedAt: 2026-09-26T01:09:07Z`, overall `unknown`, and no current
  independently observed incident/uptime history.
- `.github/workflows/public-status.yml` currently has only `workflow_dispatch`.
  The five-minute scheduled monitor was paused because the account's hosted
  Actions runners were failing before job startup. Merely rebuilding the static
  page once does **not** restore a trustworthy live monitoring service.
- The Makronexus ERP correctly rejects old/unknown JSON as unverified.
- A separate live browser-side probe exists, but its legacy `mode: 'no-cors'`
  fallback could declare the web application operational without inspecting the
  HTTP status. That fallback is removed in this change.

## Recovery requirements

1. Choose an **independently running, durable monitor scheduler**. Restore
   GitHub Actions runners and enable `*/5 * * * *` only after a successful job
   proves startup + full completion; otherwise use an approved independent
   automation host. Do not host the only monitor in the ERP itself.
2. Run `node scripts/self-test.mjs`, `node scripts/check-ui-contract.mjs`,
   `node scripts/check.mjs`, `node scripts/validate.mjs` and
   `node scripts/build.mjs` on an isolated runner. Real runtime probes must
   evaluate all required dependencies, never mask transport/CORS errors, and
   never use dummy or assumed health.
3. Publish built files to the actual GitHub Pages deployment, not merely
   commit `main`. Preserve history via `status-data`; verify successful
   site availability from a network separate from the platform.
4. Check `https://status.makronexus.com/data/summary.json` has all allowed
   statuses, timestamps within 15 minutes, and exactly the monitored components.
   Check origin TLS/DNS and `Cache-Control` independently.
5. Prove a controlled failure changes the status, records an investigating
   incident, and a recovery resolves it. Never claim data integrity from
   availability checks.
6. Configure external alerts for **monitor silence/stale feed**, independent
   of business API alarms. The alert must fire when publication age exceeds
   the allowed freshness window.

## Temporary UI behavior

The ERP frontend may verify live public web and backend health checks when
`summary.json` is stale. This is explicitly labelled `live_core_checks`.
It cannot provide the independent incident timeline, 90-day uptime, or
proof of every ERP module. A failed or partial live check must stay
unavailable (HTTP 503), not show fictitious operational status.

## Non-goals

- No manual green status claims.
- No forced GitHub Actions schedule while runner provisioning is broken.
- No publishing internal service topology, school/guardian records or secrets.
- No weakening separate customer-data authorization or Support Mode.
