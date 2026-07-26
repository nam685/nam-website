# Uptime + error monitoring via Sentry

Source: [issue #291](https://github.com/nam685/nam-website/issues/291), item 2 (P1, extends backlog `038-uptime-monitoring.md`).

## Problem

`/api/health/` exists on both Django and Next.js but nothing calls it —
there is no uptime monitoring, no error tracking SDK, and no alert channel
at all for the live site or its scheduled jobs. A broken deploy or crashed
process is only discovered by manually visiting the site.

## Architecture

Sentry (free tier) covers all three monitoring needs in one account: error
tracking (SDKs in both apps), uptime monitoring (external HTTP polling,
no app changes), and cron monitoring (check-ins from scheduled jobs). The
backup job's existing healthchecks.io dead-man's-switch (issue #291 item 1)
is left untouched — it's freshly verified in production including a real
incident/recovery, and moving it to Sentry now is pure churn.

## Components

### Sentry resources managed as code (OpenTofu)

`infra/sentry/*.tf`, using the officially-sponsored `jianyuan/sentry`
Terraform provider (compatible with OpenTofu via its own registry —
confirmed it covers everything needed: `sentry_project`,
`sentry_uptime_monitor`, `sentry_cron_monitor`, and an issue-alert
resource). This replaces manual Sentry-dashboard clicking with a reviewable,
version-controlled declaration:

- Two `sentry_project` resources — backend (Django) and frontend (Next.js)
  — under one Sentry org. Standard Sentry practice: keeps issue grouping
  and each project's monitor list clean per platform.
- Two `sentry_uptime_monitor` resources:
  - `https://nam685.de/api/health/` — Django liveness.
  - `https://nam685.de/` — homepage. Caddy routes all `/api/*` paths to
    Django, so Next.js's own `/api/health` route is unreachable from the
    public domain and cannot detect a Next.js outage; the homepage check
    is the only way to catch that independently of Django.
- One `sentry_cron_monitor` for `sync_prices` — matching
  `sync-prices.timer`'s daily 06:00 schedule and a grace window. This is
  the one genuinely new job monitor; the backup job already has its own via
  healthchecks.io (item 1) and is not touched here.
- Alert-rule resource(s) routing all of the above (unhandled exceptions,
  uptime failures, missed/failed cron check-ins) to email
  (nam685@proton.me). Start high-signal only — exceptions, not warnings;
  hard down/missed, not degraded-latency — per the "few, high-signal
  alerts" lesson from the source issue. Exact resource/attribute names
  verified against the provider's registry docs at implementation time
  rather than assumed.

**State:** local, gitignored (`infra/sentry/*.tfstate*`,
`infra/sentry/.terraform/`) — applied manually from the operator's own
machine when the config changes, not part of CI. Matches how
`~/.config/rclone/rclone.conf` and the age keypair are handled: operator-
managed, never version-controlled, infrequent-change config at this scale
doesn't justify a remote backend. The Sentry API token used to run
`tofu apply` is supplied via a local env var at apply time, never
committed.

**Project creation produces the two DSNs as outputs** — the operator
copies these into the app's own secret storage (see below) after apply.

### App-side wiring

- **Error tracking — backend**: `sentry-sdk` initialized in
  `config/settings.py`, reading `SENTRY_DSN` from Bitwarden Secrets Manager
  (same `nam-website-prod` project + `bws run` pattern everything else
  uses). `send_default_pii=False`. Scrub the `Authorization` header and
  request bodies via Sentry's `before_send` hook — this app carries admin
  tokens and OAuth client secrets that must never reach Sentry's servers.
  No-ops cleanly when `SENTRY_DSN` is unset (local dev).
- **Error tracking — frontend**: `@sentry/nextjs`, configured for Next.js
  16 App Router (exact file layout — `instrumentation.ts` /
  `instrumentation-client.ts` / server / edge configs — verified against
  the installed SDK version's current docs at implementation time, since
  this has changed across SDK majors). Sentry DSNs are not secret (they're
  designed to be embedded in client bundles), so the frontend DSN doesn't
  need Bitwarden: it's inlined at build time via a GitHub Actions repo
  secret passed into `deploy.yml`'s existing `pnpm exec next build` step
  (same tier as `DEPLOY_HOST`/`DEPLOY_SSH_KEY` — a repo secret, not because
  the DSN is sensitive, but because it keeps the value out of a public
  diff and easy to rotate without a code change).
- **Cron check-in — `sync_prices`**: `website/management/commands/sync_prices.py`
  reports start/success/failure to the Sentry cron monitor declared above
  (monitor slug must match between the `.tf` config and the Python call
  site). Reports status alongside the command's existing per-ticker error
  collection — doesn't gate or change that behavior.

## Error handling

- If `SENTRY_DSN` (backend) or its frontend equivalent is unset (e.g. in
  local dev), the SDKs must no-op cleanly rather than raising — Sentry's
  SDKs already do this by default when initialized with an empty DSN, but
  this needs to be verified rather than assumed, since a raise on missing
  config would break local dev entirely.
- The `sync_prices` cron check-in must not change the command's own
  exit/error behavior — it reports status to Sentry alongside whatever
  `sync_prices` already does (existing per-ticker error collection is
  untouched), it doesn't gate it.

## Testing

- OpenTofu: `tofu fmt -check` and `tofu validate` against `infra/sentry/*.tf`
  (no real apply in CI/tests — this needs a live Sentry org/API token and
  is applied manually per the State note above).
- Backend: a test verifying `sentry_sdk.init()` is called with
  `send_default_pii=False` when `SENTRY_DSN` is configured, and a test of
  the `before_send` scrubbing hook against a fabricated event containing an
  `Authorization` header, asserting it's stripped before "send" (mocking
  the actual network call).
  `sync_prices`: a test verifying the cron check-in helper is invoked in
  both the success and exception paths (mocking Sentry's check-in call),
  without needing a real Sentry account.
- Frontend: `@sentry/nextjs` config files are mostly declarative
  (DSN + options); the pure-logic test bar in this repo (`src/lib/`) may
  not apply here — cover with a build-time check (`pnpm build` succeeds
  with the SDK wired in) rather than forcing a synthetic unit test.
- Uptime monitors and the error-tracking pipeline end-to-end (a real
  exception showing up in Sentry, a real downtime alert firing) are
  ops-verification, not unit-testable — confirmed manually once deployed,
  same pattern as item 1's manual backup verification.

## Documentation

`docs/infrastructure.md` gets a new "Monitoring" section: how to get a
Sentry API token and run `tofu apply` in `infra/sentry/` (one-time and on
future config changes), where the resulting DSN outputs go (`SENTRY_DSN`
into Bitwarden Secrets Manager's `nam-website-prod` project; frontend DSN
into a GitHub Actions repo secret consumed by `deploy.yml`), and a note
that the uptime monitors/cron monitor/alert rules themselves need no
further manual setup — they're created by the `tofu apply`.

## Out of scope

- Deploy pipeline changes (issue #291 items 3-4).
- Disaster-recovery runbook (item 5).
- Migrating the backup job's healthchecks.io monitor to Sentry.
