# Uptime + Error Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry-based error tracking (Django + Next.js), uptime monitoring (API health + homepage), and cron monitoring (`sync_prices`), with the Sentry-side configuration (projects, monitors, alert rules) declared as OpenTofu code instead of clicked together in the dashboard.

**Architecture:** `infra/sentry/*.tf` declares all Sentry-side resources via the `jianyuan/sentry` provider, applied manually by the operator (local state, not CI). The two DSNs it produces as outputs get wired into the apps: Django reads `SENTRY_DSN` from Bitwarden Secrets Manager at runtime; Next.js gets its DSN baked in at build time via a GitHub Actions secret. `sync_prices` reports check-ins to its new cron monitor.

**Tech Stack:** OpenTofu + `jianyuan/sentry` provider, `sentry-sdk` (Python), `@sentry/nextjs`, existing Bitwarden Secrets Manager (`bws run`) pattern, GitHub Actions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-uptime-error-monitoring-design.md`
- Backend and frontend get **separate Sentry projects**: slugs `nam-website-backend` and `nam-website-frontend`.
- The cron monitor's `name` in Terraform MUST be the literal string `sync-prices` — chosen because it's already in valid-slug form (lowercase, hyphenated), so Sentry's auto-generated slug should equal it exactly. The Python check-in code uses the same literal string as `monitor_slug`. **This is a live-service assumption that must be verified once the operator actually runs `tofu apply`** (Task 1's docs note covers this) — if the dashboard shows a different slug (e.g. Sentry appended a disambiguating suffix), the Python constant must be updated to match. Do not treat this as resolved until confirmed against a real apply.
- `send_default_pii=False` and explicit scrubbing of the `Authorization` header on both SDKs — this app carries admin tokens and OAuth client secrets that must never reach Sentry.
- Both SDKs must no-op cleanly when their DSN is empty/unset (local dev has no Sentry project).
- Sentry DSNs are not secret (designed for client-bundle embedding) but still travel via: `SENTRY_DSN` → Bitwarden Secrets Manager `nam-website-prod` project (same `bws run` pattern as every other backend/celery/sync-prices secret); frontend DSN → GitHub Actions repo secret `SENTRY_DSN_FRONTEND`, inlined at build time only (Next.js `NEXT_PUBLIC_*` vars are build-time-only, not runtime).
- OpenTofu state (`infra/sentry/*.tfstate*`, `infra/sentry/.terraform/`) is gitignored — applied manually by the operator from their own machine, never in CI.
- No existing `sentry-sdk` / `@sentry/nextjs` dependency in this repo — both are new.
- `sync_prices`'s existing per-ticker error collection (`website/management/commands/sync_prices.py`) is untouched by the cron check-in wrapping — the check-in reports status alongside it, does not gate it.
- Test commands: backend `uv run pytest`, frontend `pnpm build` (SDK config is largely declarative; this repo's `frontend/src/lib/__tests__/` bar is for pure-logic unit tests and doesn't apply to SDK bootstrap files).

---

### Task 1: `infra/sentry/*.tf` — Sentry resources as code

**Files:**
- Create: `infra/sentry/versions.tf`
- Create: `infra/sentry/variables.tf`
- Create: `infra/sentry/main.tf`
- Create: `infra/sentry/outputs.tf`
- Modify: `.gitignore` — add OpenTofu state patterns

**Interfaces:**
- Produces: two Sentry projects (`nam-website-backend`, `nam-website-frontend`), two uptime monitors, one cron monitor named `sync-prices`, two issue-alert rules. `outputs.tf` exposes `backend_dsn` and `frontend_dsn` via `tofu output` — Task 6's docs reference these output names.

- [ ] **Step 1: Write `infra/sentry/versions.tf`**

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    sentry = {
      source  = "jianyuan/sentry"
      version = "~> 0.15"
    }
  }
}

provider "sentry" {
  # Auth token sourced from the SENTRY_AUTH_TOKEN env var at apply time —
  # never hardcode it here. Get one from Sentry: Settings > Auth Tokens,
  # scoped to org:read, project:write, alerts:write.
}
```

- [ ] **Step 2: Write `infra/sentry/variables.tf`**

```hcl
variable "sentry_org" {
  description = "Sentry organization slug"
  type        = string
}

variable "sentry_team" {
  description = "Sentry team slug that owns these projects — find your org's default team slug under Sentry Settings > Teams (one is auto-created when the org is created)"
  type        = string
}
```

- [ ] **Step 3: Write `infra/sentry/main.tf`**

```hcl
resource "sentry_project" "backend" {
  organization = var.sentry_org
  teams        = [var.sentry_team]
  name         = "nam-website-backend"
  slug         = "nam-website-backend"
  platform     = "python-django"
}

resource "sentry_project" "frontend" {
  organization = var.sentry_org
  teams        = [var.sentry_team]
  name         = "nam-website-frontend"
  slug         = "nam-website-frontend"
  platform     = "javascript-nextjs"
}

resource "sentry_uptime_monitor" "api_health" {
  organization     = var.sentry_org
  project          = sentry_project.backend.slug
  name             = "Django API health"
  environment      = "production"
  url              = "https://nam685.de/api/health/"
  method           = "GET"
  interval_seconds = 300
  timeout_ms       = 5000

  assertion_json = provider::sentry::assertion(
    provider::sentry::op_and(
      provider::sentry::op_status_code_check("greater_than", 199),
      provider::sentry::op_status_code_check("less_than", 300),
    )
  )
}

resource "sentry_uptime_monitor" "homepage" {
  organization     = var.sentry_org
  project          = sentry_project.frontend.slug
  name             = "Homepage"
  environment      = "production"
  url              = "https://nam685.de/"
  method           = "GET"
  interval_seconds = 300
  timeout_ms       = 5000

  assertion_json = provider::sentry::assertion(
    provider::sentry::op_and(
      provider::sentry::op_status_code_check("greater_than", 199),
      provider::sentry::op_status_code_check("less_than", 300),
    )
  )
}

resource "sentry_cron_monitor" "sync_prices" {
  organization = var.sentry_org
  project      = sentry_project.backend.slug

  # This name is chosen to already be a valid slug (lowercase, hyphenated).
  # website/management/commands/sync_prices.py's check-in call uses this
  # exact string as monitor_slug — see Global Constraints note on verifying
  # this against the real apply.
  name = "sync-prices"

  checkin_margin_minutes  = 30
  failure_issue_threshold = 1
  max_runtime_minutes     = 15
  recovery_threshold      = 1

  schedule = {
    crontab = "0 6 * * *" # matches infra/sync-prices.timer's OnCalendar
  }

  timezone = "UTC"
}

resource "sentry_issue_alert" "backend_new_issue_email" {
  organization = var.sentry_org
  project      = sentry_project.backend.slug
  name         = "Email on new issue"

  action_match = "any"
  filter_match = "any"
  frequency    = 30

  conditions_v2 = [
    { first_seen_event = {} }
  ]

  actions_v2 = [
    {
      notify_email = {
        target_type      = "IssueOwners"
        fallthrough_type = "ActiveMembers"
      }
    }
  ]
}

resource "sentry_issue_alert" "frontend_new_issue_email" {
  organization = var.sentry_org
  project      = sentry_project.frontend.slug
  name         = "Email on new issue"

  action_match = "any"
  filter_match = "any"
  frequency    = 30

  conditions_v2 = [
    { first_seen_event = {} }
  ]

  actions_v2 = [
    {
      notify_email = {
        target_type      = "IssueOwners"
        fallthrough_type = "ActiveMembers"
      }
    }
  ]
}

data "sentry_key" "backend_default" {
  organization = var.sentry_org
  project      = sentry_project.backend.slug
  first        = true
}

data "sentry_key" "frontend_default" {
  organization = var.sentry_org
  project      = sentry_project.frontend.slug
  first        = true
}
```

- [ ] **Step 4: Write `infra/sentry/outputs.tf`**

```hcl
output "backend_dsn" {
  description = "Django SENTRY_DSN — add to Bitwarden Secrets Manager's nam-website-prod project"
  value       = data.sentry_key.backend_default.dsn.public
}

output "frontend_dsn" {
  description = "Next.js DSN — add as the GitHub Actions repo secret SENTRY_DSN_FRONTEND"
  value       = data.sentry_key.frontend_default.dsn.public
}
```

- [ ] **Step 5: Add OpenTofu state patterns to `.gitignore`**

Add this block to `.gitignore` (near any existing infra-related entries, or at the end):

```
# OpenTofu state (infra/sentry/) — operator-managed, never committed
infra/sentry/*.tfstate
infra/sentry/*.tfstate.backup
infra/sentry/.terraform/
infra/sentry/.terraform.lock.hcl
infra/sentry/*.tfvars
```

- [ ] **Step 6: Validate the config syntax**

Run: `cd infra/sentry && tofu init -backend=false && tofu validate`
Expected: `Success! The configuration is valid.` If `tofu` isn't installed in this environment, install it first (`snap install --classic opentofu` or the OpenTofu install script — check what's available) — this step must actually run, not be skipped. If genuinely impossible to install in this sandbox, run `tofu fmt -check -recursive infra/sentry` at minimum and note in the task report that `validate` could not be run here.

- [ ] **Step 7: Commit**

```bash
git add infra/sentry/ .gitignore
git commit -m "feat(infra): declare Sentry projects, monitors, and alerts as OpenTofu code"
```

---

### Task 2: Backend Sentry SDK — `website/sentry.py` + settings wiring

**Files:**
- Create: `website/sentry.py`
- Modify: `config/settings.py`
- Modify: `pyproject.toml` (add `sentry-sdk` dependency)
- Test: `website/tests/test_sentry.py`

**Interfaces:**
- Produces: `init_sentry(dsn: str) -> None` and `scrub_event(event: dict, hint: dict) -> dict` in `website/sentry.py`. Task 3 imports a different function from this same module (`cron_checkin`, added there) — both live in `website/sentry.py`.

- [ ] **Step 1: Add the dependency**

Run: `uv add sentry-sdk`
This updates `pyproject.toml` and `uv.lock`.

- [ ] **Step 2: Write the failing tests**

Create `website/tests/test_sentry.py`:

```python
from unittest.mock import MagicMock, patch

from website.sentry import init_sentry, scrub_event


class TestInitSentry:
    @patch("website.sentry.sentry_sdk.init")
    def test_noop_when_dsn_empty(self, mock_init):
        init_sentry("")
        mock_init.assert_not_called()

    @patch("website.sentry.sentry_sdk.init")
    def test_initializes_with_pii_disabled(self, mock_init):
        init_sentry("https://fake@o0.ingest.sentry.io/1")
        mock_init.assert_called_once()
        _, kwargs = mock_init.call_args
        assert kwargs["dsn"] == "https://fake@o0.ingest.sentry.io/1"
        assert kwargs["send_default_pii"] is False
        assert kwargs["before_send"] is scrub_event


class TestScrubEvent:
    def test_strips_authorization_header(self):
        event = {"request": {"headers": {"Authorization": "Bearer secret-token", "Accept": "application/json"}}}
        result = scrub_event(event, {})
        assert result["request"]["headers"]["Authorization"] == "[Filtered]"
        assert result["request"]["headers"]["Accept"] == "application/json"

    def test_strips_request_body(self):
        event = {"request": {"data": {"secret": "leak-me"}, "headers": {}}}
        result = scrub_event(event, {})
        assert "data" not in result["request"]

    def test_handles_event_with_no_request(self):
        event = {"message": "no request here"}
        result = scrub_event(event, {})
        assert result == {"message": "no request here"}
```

- [ ] **Step 2b: Run tests, verify they fail with ImportError**

Run: `uv run pytest website/tests/test_sentry.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'website.sentry'` (or `ImportError`).

- [ ] **Step 3: Write `website/sentry.py`**

```python
import sentry_sdk


def init_sentry(dsn: str) -> None:
    """Initialize the Sentry SDK. No-ops if dsn is empty (e.g. local dev)."""
    if not dsn:
        return
    sentry_sdk.init(
        dsn=dsn,
        send_default_pii=False,
        before_send=scrub_event,
    )


def scrub_event(event: dict, hint: dict) -> dict:
    """Strip sensitive data before an event leaves this process for Sentry.

    This app carries admin tokens and OAuth client secrets in request
    headers/bodies that must never reach Sentry's servers.
    """
    request = event.get("request")
    if request:
        headers = request.get("headers")
        if headers and "Authorization" in headers:
            headers["Authorization"] = "[Filtered]"
        request.pop("data", None)
    return event
```

- [ ] **Step 4: Wire into `config/settings.py`**

Add near the top of `config/settings.py`, after the existing `SECRET_KEY`/`DEBUG`/`ALLOWED_HOSTS` block (around line 16):

```python
from website.sentry import init_sentry

SENTRY_DSN = env("SENTRY_DSN", default="")
init_sentry(SENTRY_DSN)
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `uv run pytest website/tests/test_sentry.py -v`
Expected: 5 passed.

- [ ] **Step 6: Run the full backend suite to confirm nothing else broke**

Run: `uv run pytest -q`
Expected: all passing (same pass count as before this task, plus the 5 new tests).

- [ ] **Step 7: Commit**

```bash
git add website/sentry.py website/tests/test_sentry.py config/settings.py pyproject.toml uv.lock
git commit -m "feat(backend): initialize Sentry SDK with PII scrubbing, SENTRY_DSN-gated"
```

---

### Task 3: `sync_prices` cron check-in

**Files:**
- Modify: `website/sentry.py` — add `cron_checkin`
- Modify: `website/management/commands/sync_prices.py`
- Test: `website/tests/test_sentry.py` — add `TestCronCheckin`

**Interfaces:**
- Consumes: `website/sentry.py` from Task 2 (same file, appended to).
- Produces: `cron_checkin(monitor_slug: str)` — a context manager in `website/sentry.py`. `sync_prices.py`'s `handle()` wraps its existing body with `with cron_checkin("sync-prices"):`.

- [ ] **Step 1: Write the failing tests**

Append to `website/tests/test_sentry.py`:

```python
import pytest

from website.sentry import cron_checkin


class TestCronCheckin:
    @patch("website.sentry.sentry_sdk.crons.capture_checkin")
    def test_success_path_reports_in_progress_then_ok(self, mock_checkin):
        mock_checkin.return_value = "checkin-id-123"
        with cron_checkin("sync-prices"):
            pass

        assert mock_checkin.call_count == 2
        first_call, second_call = mock_checkin.call_args_list
        assert first_call.kwargs["monitor_slug"] == "sync-prices"
        assert first_call.kwargs["status"] == "in_progress"
        assert second_call.kwargs["monitor_slug"] == "sync-prices"
        assert second_call.kwargs["check_in_id"] == "checkin-id-123"
        assert second_call.kwargs["status"] == "ok"

    @patch("website.sentry.sentry_sdk.crons.capture_checkin")
    def test_error_path_reports_error_and_reraises(self, mock_checkin):
        mock_checkin.return_value = "checkin-id-456"
        with pytest.raises(ValueError, match="boom"):
            with cron_checkin("sync-prices"):
                raise ValueError("boom")

        assert mock_checkin.call_count == 2
        _, second_call = mock_checkin.call_args_list
        assert second_call.kwargs["check_in_id"] == "checkin-id-456"
        assert second_call.kwargs["status"] == "error"
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `uv run pytest website/tests/test_sentry.py::TestCronCheckin -v`
Expected: FAIL — `ImportError: cannot import name 'cron_checkin'`.

- [ ] **Step 3: Before writing the implementation, verify the exact `sentry_sdk.crons` API**

Look up the current Sentry Python SDK docs for manual cron check-ins (via the context7 MCP tool — query for "Sentry Python SDK crons capture_checkin" — or the SDK's own docstrings after `uv add`, e.g. `python -c "import sentry_sdk.crons; help(sentry_sdk.crons.capture_checkin)"`). Confirm: the function name and import path (`sentry_sdk.crons.capture_checkin`), the status values (expected: string literals `"in_progress"`, `"ok"`, `"error"`, possibly via a `MonitorStatus` enum instead — if it's an enum, update the test mocks in Step 1 to assert against the enum values instead of raw strings, and use the enum in the implementation below), and the `check_in_id` round-trip (does the first call return an ID that must be passed to the second?). Adjust Step 4's implementation and the tests above to match whatever you find — the shape below is expected to be correct based on stable, longstanding Sentry SDK API but must be confirmed against the actual installed version rather than assumed.

- [ ] **Step 4: Implement `cron_checkin` in `website/sentry.py`**

Add to `website/sentry.py`:

```python
import contextlib

import sentry_sdk.crons


@contextlib.contextmanager
def cron_checkin(monitor_slug: str):
    """Report a Sentry Cron Monitor check-in around the wrapped block.

    No-ops safely if Sentry isn't configured (init_sentry was never called
    with a DSN) — sentry_sdk's check-in calls are inert without an active
    client, matching this module's DSN-optional design.
    """
    check_in_id = sentry_sdk.crons.capture_checkin(monitor_slug=monitor_slug, status="in_progress")
    try:
        yield
    except Exception:
        sentry_sdk.crons.capture_checkin(monitor_slug=monitor_slug, check_in_id=check_in_id, status="error")
        raise
    else:
        sentry_sdk.crons.capture_checkin(monitor_slug=monitor_slug, check_in_id=check_in_id, status="ok")
```

(Adjust the literal `"in_progress"`/`"ok"`/`"error"` strings to match whatever Step 3 found — e.g. `MonitorStatus.IN_PROGRESS` if the SDK uses an enum. Update the import accordingly.)

- [ ] **Step 5: Wrap `sync_prices.py`'s `handle()`**

In `website/management/commands/sync_prices.py`, add the import and wrap the existing method body (do not change any existing logic inside — only add the `with` wrapper and re-indent):

```python
from website.sentry import cron_checkin
```

```python
def handle(self, *_args, **_options):
    with cron_checkin("sync-prices"):
        # ... existing body, unchanged, just re-indented one level ...
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `uv run pytest website/tests/test_sentry.py -v`
Expected: all passing (7 total: 5 from Task 2 + 2 new).

- [ ] **Step 7: Run the full backend suite**

Run: `uv run pytest -q`
Expected: all passing, same count as Task 2's end state plus the 2 new tests.

- [ ] **Step 8: Commit**

```bash
git add website/sentry.py website/tests/test_sentry.py website/management/commands/sync_prices.py
git commit -m "feat(backend): report sync_prices runs to Sentry cron monitor"
```

---

### Task 4: Frontend `@sentry/nextjs` integration

**Files:**
- Modify: `frontend/package.json` (add `@sentry/nextjs`)
- Create/modify: Next.js instrumentation files — exact filenames determined in Step 1 below
- Modify: `frontend/next.config.ts`

**Interfaces:**
- Produces: a working Sentry client/server/edge init wired into the Next.js 16 App Router build, gated on `NEXT_PUBLIC_SENTRY_DSN` (empty in local dev = no-op, matching Task 2's backend behavior).

- [ ] **Step 1: Look up the current `@sentry/nextjs` setup for Next.js 16 App Router**

This SDK's integration pattern (instrumentation file names/locations, whether `next.config.ts` needs wrapping with `withSentryConfig`, how PII/scrubbing options are set) has changed across major versions. Before writing any code, check current docs via the context7 MCP tool (query for "@sentry/nextjs Next.js App Router setup") or `https://docs.sentry.io/platforms/javascript/guides/nextjs/` via WebFetch. This repo is on Next.js 16.2 / React 19.2 (`frontend/package.json`) — confirm whatever you find is compatible with that version, not an older Next.js major's instructions.

- [ ] **Step 2: Install the SDK**

Run: `~/.local/share/pnpm/pnpm --dir frontend add @sentry/nextjs` (adjust the pnpm invocation to however this repo's other tasks/CLAUDE.md document running pnpm in this environment — `~/.local/share/pnpm/pnpm` is not on PATH here per this repo's dev-environment notes).

- [ ] **Step 3: Wire up the SDK per what Step 1 found**

Implement the client/server/edge init files and `next.config.ts` wrapping as documented. Requirements that must hold regardless of the exact file layout Step 1 finds:
- Reads the DSN from `NEXT_PUBLIC_SENTRY_DSN` (must be `NEXT_PUBLIC_`-prefixed — Next.js only inlines that prefix into the client bundle at build time).
- No-ops cleanly (no thrown error, no console spam) when `NEXT_PUBLIC_SENTRY_DSN` is unset — this must hold for local dev (`pnpm dev` with no env var set).
- PII/session-replay defaults are conservative: do not enable session replay or any feature that would capture request bodies/headers by default — this app's `/sudo` login page and OAuth flows must not leak tokens into Sentry.

- [ ] **Step 4: Verify the build succeeds with no DSN set (local-dev-equivalent)**

Run (from `frontend/`): `~/.local/share/pnpm/pnpm build`
Expected: build succeeds, no Sentry-related errors or warnings about a missing DSN causing a hard failure.

- [ ] **Step 5: Verify the build succeeds with a DSN set**

Run: `NEXT_PUBLIC_SENTRY_DSN="https://fake@o0.ingest.sentry.io/1" ~/.local/share/pnpm/pnpm build`
Expected: build succeeds. (A fake DSN is fine here — this only proves the build-time wiring works, not that events actually reach Sentry, which needs a real project and is verified manually post-deploy per the spec's Testing section.)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/next.config.ts
# plus whatever instrumentation files Step 3 created — add them explicitly by name
git commit -m "feat(frontend): wire up @sentry/nextjs error tracking, DSN-gated"
```

---

### Task 5: `deploy.yml` — bake the frontend DSN in at build time

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SENTRY_DSN`, the env var Task 4's SDK config reads.
- Produces: the `pnpm exec next build` step in the deploy script now runs with that var set from the GitHub Actions secret `SENTRY_DSN_FRONTEND`.

- [ ] **Step 1: Add the secret to the build step**

In `.github/workflows/deploy.yml`, find this existing block:

```yaml
            # Frontend
            cd frontend
            pnpm install --frozen-lockfile
            pnpm exec next build
            sudo systemctl restart nextjs
```

Replace the build line:

```yaml
            # Frontend
            cd frontend
            pnpm install --frozen-lockfile
            NEXT_PUBLIC_SENTRY_DSN="${{ secrets.SENTRY_DSN_FRONTEND }}" pnpm exec next build
            sudo systemctl restart nextjs
```

- [ ] **Step 2: Verify YAML validity**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
Expected: no output, exit code 0. (If `pyyaml` isn't installed, use `uv run python3 -c "..."` from repo root, or any available YAML linter — the point is confirming the file still parses.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): bake Sentry frontend DSN into the Next.js build"
```

Note for the human operator (not part of this task's automated steps): the `SENTRY_DSN_FRONTEND` GitHub Actions secret must be created manually in repo Settings → Secrets → Actions, using the `frontend_dsn` value from Task 1's `tofu output` once the operator runs the actual `tofu apply`. This can't happen until a real Sentry org/apply exists — document this dependency clearly in Task 6.

---

### Task 6: `docs/infrastructure.md` — "Monitoring" section

**Files:**
- Modify: `docs/infrastructure.md` — add a new `## Monitoring` section (place it after the existing `## Backups` section, before `## Secrets (Bitwarden Secrets Manager)` — both are operational runbook content in the doc's existing top-to-bottom structure)

**Interfaces:**
- Consumes: variable names, output names, and file paths from Tasks 1–5 (`infra/sentry/`, `sentry_org`/`sentry_team` variables, `backend_dsn`/`frontend_dsn` outputs, `SENTRY_DSN` Bitwarden secret, `SENTRY_DSN_FRONTEND` GitHub Actions secret).

- [ ] **Step 1: Add the Monitoring section**

Insert into `docs/infrastructure.md`:

```markdown
## Monitoring

Error tracking (Django + Next.js), uptime monitoring (API health +
homepage), and cron monitoring (`sync_prices`) via Sentry — all configured
as code in `infra/sentry/`, not clicked together in the dashboard.

**One-time setup:**

1. Create a Sentry account/org if you don't have one (sentry.io, free
   tier). Note the org slug and find its default team's slug under
   Settings > Teams.

2. Create a Sentry Auth Token: Settings > Auth Tokens, scoped to
   `org:read`, `project:write`, `alerts:write`.

3. From `infra/sentry/`, apply the config (from your own machine — this
   is operator-managed, not part of CI, same tier as the backup's
   `rclone`/`age` setup):
   ```bash
   cd infra/sentry
   export SENTRY_AUTH_TOKEN=<token from step 2>
   tofu init
   tofu apply -var="sentry_org=<your org slug>" -var="sentry_team=<team slug from step 1>"
   ```

4. Retrieve the two DSNs the apply just produced:
   ```bash
   tofu output backend_dsn
   tofu output frontend_dsn
   ```

5. Add the backend DSN to Bitwarden Secrets Manager's `nam-website-prod`
   project as `SENTRY_DSN` (same place every other backend secret lives —
   see "Secrets (Bitwarden Secrets Manager)" below).

6. Add the frontend DSN as a GitHub Actions repo secret named
   `SENTRY_DSN_FRONTEND` (repo Settings > Secrets and variables > Actions)
   — `deploy.yml` bakes it into the Next.js build.

7. In your Sentry account's own notification settings (not part of the
   Terraform config — this is per-user, not per-org), confirm the
   registered email is nam685@proton.me, or that your notification
   preferences route "Issue Owners"/"Active Members" alerts there. The
   alert rules route to org members via Sentry's own membership model, not
   a raw email address.

8. Redeploy (or manually restart `django`/`celery` and re-run the frontend
   build) so both apps pick up their DSNs.

9. Verify: trigger a real error (e.g. temporarily hit a broken endpoint)
   and confirm it shows up in the relevant Sentry project; check that the
   two uptime monitors and the `sync-prices` cron monitor show up in
   Sentry as "OK" after their next check.

**Changing the config later:** edit `infra/sentry/*.tf` and re-run
`tofu apply` with the same `-var` flags from step 3 — OpenTofu diffs
against local state and applies only what changed.
```

- [ ] **Step 2: Commit**

```bash
git add docs/infrastructure.md
git commit -m "docs(infra): document Sentry monitoring setup (OpenTofu apply + secret wiring)"
```

---

## Self-Review Notes

- **Spec coverage:** Sentry resources as code (Task 1), backend error tracking + PII scrubbing (Task 2), `sync_prices` cron check-in (Task 3), frontend error tracking (Task 4), frontend DSN build-time wiring (Task 5), operator runbook including the "verify slug/email" live-service checks (Task 6). Two uptime monitors (Django health + homepage) covered in Task 1. Alert routing (email, high-signal-only: new-issue only, not warnings) covered in Task 1's `sentry_issue_alert` resources. All spec sections have a task.
- **No placeholders:** all steps contain literal code or an explicit, concrete verification action (e.g. Task 3 Step 3, Task 4 Step 1 — both are "look this up via a named tool/source and adjust the following literal code accordingly," not "figure it out"). This is deliberate for the two SDK-API-surface points that depend on library versions not pinned/verifiable by the plan author.
- **Type/name consistency:** `SENTRY_DSN` (backend env var) matches across Task 2 (settings.py) and Task 6 (Bitwarden runbook). `sync-prices` (monitor slug) matches across Task 1 (Terraform `name`), Task 3 (Python `monitor_slug`), and the Global Constraints note. `NEXT_PUBLIC_SENTRY_DSN` matches across Task 4 and Task 5. `backend_dsn`/`frontend_dsn` (Terraform outputs) match across Task 1 and Task 6. `website/sentry.py` is the single file both Task 2 and Task 3 extend — no duplicate module created.
