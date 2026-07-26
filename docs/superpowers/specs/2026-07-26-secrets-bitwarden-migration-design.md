# Secrets → Bitwarden Secrets Manager migration

Tracked in [issue #296](https://github.com/nam685/nam-website/issues/296). Prod-only; local/dev keeps plain `.env`.

## Why

Secrets today live in one place, unencrypted, on the VPS disk (`/home/nam/nam-website-deploy/.env`, `chmod 600`), with no rotation trail, no audit log, and no recovery path independent of the server (relevant since the server was already rebuilt once after ransomware). Issue #291 recommended against a secrets manager at this scale; #296 deliberately overrides that call for the reasons above. Bitwarden Secrets Manager was chosen over 1Password because a personal Bitwarden account already exists (no new subscription), and Secrets Manager is a distinct product/API from the personal vault.

Rotation of the actual secret *values* (`ADMIN_SECRET`, `SECRET_KEY`, OAuth secrets) is explicitly **out of scope** for this pass — this migration only changes *where* current values are stored. Rotation is a deliberate follow-up once the plumbing is proven.

## Scope discovered during investigation

The issue assumed a `klaude-worker.service` needing the same treatment as `django`/`celery`. Investigation of the live server (via SSH) found the actual shape differs from that assumption:

- `klaude-worker.service` **does** exist (created manually per `docs/server-setup-klaude.md`, not tracked in `infra/` or the deploy pipeline) — it's a second Celery worker (`-Q slops`, `User=nam`) that `website/tasks.py::_execute_klaude` shells out to via `sudo -u klaude /home/klaude/.local/bin/klaude ...`.
- It currently has **no `EnvironmentFile=` at all**. Checked the running process's actual env on the VPS — zero DB/secret vars. It works today only because the postgres:16 image's default `pg_hba.conf` trusts any local TCP connection regardless of password (filed separately as [issue #298](https://github.com/nam685/nam-website/issues/298) — out of scope here).
- Gemini's API key (added in #297, replacing OpenRouter) isn't wired through systemd/env at all: `/home/klaude/.klaude.toml` has `api_key = "<literal value>"` hardcoded, plus a vestigial unused `export GEMINI_API_KEY=...` in `/home/klaude/.bashrc`. This is because `sudo -u klaude <bin>` (no `-i`, no `env_keep`) strips the environment entirely — hardcoding was the only thing that worked under the current sudoers rule.
- `nextjs.service` has `EnvironmentFile=.env` today but nothing in the frontend reads a non-`NEXT_PUBLIC_*` var (grepped `frontend/src` for `process.env.*`) — dead weight, dropping it.
- Live secret-bearing var inventory (grepped from the real prod `.env`, names only) differs slightly from the issue's assumed list: `DEBUG`, `SECRET_KEY`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `ADMIN_SECRET`, `REDIS_URL`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALPHA_VANTAGE_API_KEY`, `YTMUSIC_CLIENT_ID`, `YTMUSIC_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LASTFM_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` — plus `GEMINI_API_KEY` (new, folded in from the klaude finding above). `NAM_ADMIN_TOKEN` (used by standalone `scripts/audiobook_*.py`, not systemd-managed) is out of scope — those scripts keep reading local `.env` when run manually.
- Server architecture is actually `x86_64`, not the `aarch64` `docs/infrastructure.md` currently claims (stale doc, likely from before a server rebuild) — corrected as part of the doc update in this pass.

## Architecture

**Bitwarden Secrets Manager project:** `nam-website-prod` (already created by the user), holding all 20 vars above as secrets — including non-sensitive config like `ALLOWED_HOSTS`/`DEBUG`. One source of truth is simpler than splitting config vs. secrets across two systems, and `.env` fully stops being the prod source of truth, not just the "real" secrets.

**Wrapper pattern:** every unit's `ExecStart` becomes:
```
ExecStart=/usr/local/bin/bws run --project-id <PROJECT_ID> -- <original command>
```
`PROJECT_ID` is not secret — committed plain in the unit file. Secrets are injected as env vars into that one process only, never touch disk.

**Bootstrap secret:** `EnvironmentFile=/home/nam/nam-website-deploy/.env` → `EnvironmentFile=/etc/nam-website/bws-token`, a new one-line file (`BWS_ACCESS_TOKEN=...`), `chmod 600`, owned `nam`, never in git. This is the one remaining flat-file secret, scoped to a read-only machine account limited to this single project — functionally equivalent to a 1Password Service Account token (a single bearer credential handed to a CLI that fetches real secrets at runtime).

**klaude's Gemini key**, specifically:
- `celery.service` and `klaude-worker.service` (both `User=nam`) get the same `bws run` wrapper and thus both have `GEMINI_API_KEY` in their process env once wired.
- `/home/klaude/.klaude.toml` switches from `api_key = "<literal>"` back to `api_key_env = "GEMINI_API_KEY"`; the hardcoded value is deleted, as is the vestigial `.bashrc` export.
- `/etc/sudoers.d/klaude` gains one scoped line: `Defaults:nam env_keep += "GEMINI_API_KEY"` — only that one var crosses the `sudo -u klaude` boundary, keeping klaude's blast radius as tight as the existing iptables sandboxing (klaude is a lower-trust, agentic account; it should not inherit `ADMIN_SECRET`/`DATABASE_URL`/etc. just because `django.tasks` has them).
- `klaude-worker.service` is edited live via SSH, not added to `infra/`/the deploy pipeline — this preserves the existing deliberate separation (per #297: "klaude config lives on the VPS, applied manually outside this repo/deploy pipeline"). `docs/server-setup-klaude.md` is updated so a from-scratch setup produces the same result.

**Services in scope:** `django.service`, `celery.service`, `sync-prices.service` (tracked in `infra/`, deploy-synced) + `klaude-worker.service` (live-only, manually synced). `nextjs.service` loses its unused `EnvironmentFile=` but is not wired to `bws` (nothing to inject).

**Deploy pipeline:** `.github/workflows/deploy.yml`'s systemd-sync loop currently only covers `django nextjs celery` — adding `sync-prices` since this pass touches that unit and it would otherwise silently drift on future edits.

## Rollout order

1. Install `bws` CLI on the VPS, write `/etc/nam-website/bws-token`, verify `bws secret list --project-id <id>` returns all 20 expected names.
2. Update `infra/django.service`, `infra/celery.service`, `infra/sync-prices.service` (git-tracked) + `deploy.yml`.
3. Update the live `klaude-worker.service`, `/home/klaude/.klaude.toml`, `/home/klaude/.bashrc`, `/etc/sudoers.d/klaude` via SSH.
4. Restart all four services, verify each comes up healthy and (spot-check via `/proc/<pid>/environ`, redacted) actually has the expected vars — confirm `/slops` still works end to end.
5. Update `docs/infrastructure.md` and `docs/server-setup-klaude.md` to reflect the new flow as the documented path for any future server rebuild.

## Explicitly out of scope

- Secret **rotation** (separate follow-up pass after this plumbing is verified).
- Postgres trust-auth hardening (issue #298).
- 1Password, migrating the personal Bitwarden vault, local/dev secret handling — all per #296's original scope.
- Bringing `klaude-worker.service` under `infra/`/deploy-pipeline management (preserves existing deliberate manual-ops boundary for the klaude sandbox).
