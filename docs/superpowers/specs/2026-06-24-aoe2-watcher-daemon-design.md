# AoE2 Watcher Daemon — Design

**Date:** 2026-06-24
**Status:** Approved (approach A)

## Goal

Make `scripts/aoe2_watcher.py` run unattended on the gaming PC so finished games
auto-upload with zero manual steps. The watcher *logic* already works (polls the
savegame folder, waits for each `.aoe2record` to stop growing, dedups by hash,
POSTs to `/api/aoe2/upload/`). The only gap is that today it must be launched by
hand in a terminal and dies when that terminal closes. This turns it into a
daemon.

## Environment (verified 2026-06-24)

- Gaming PC is Windows + WSL2. Recs live on the **Windows** side:
  `C:\Users\lehai\Games\Age of Empires 2 DE\76561198829134149\savegame` (339 recs).
- **Windows Python 3.9** is installed:
  `C:\Users\lehai\AppData\Local\Programs\Python\Python39\python.exe`.
- WSL systemd is **not** PID 1, so a WSL systemd unit would not reliably auto-start
  at boot.
- The upload endpoint dedups by file hash, so re-scanning the backlog after a
  restart re-uploads nothing — restarts are safe and idempotent.

## Approach (A): native Windows, hidden Task Scheduler task

Run the watcher as a hidden Windows Scheduled Task:

- **Runtime:** Windows Python 3.9 (`pythonw.exe`, no console window). Native to where
  the recs are — avoids the `/mnt/c` 9p layer entirely.
- **Trigger:** *At log on* of the current user.
- **Resilience:** task configured to restart on failure (every 1 min, several
  retries) AND the script gets its own top-level supervisor loop so transient
  errors never reach the OS.

Rejected: NSSM/pywin32 true service (pre-login robustness not needed on a personal
gaming PC); WSL-via-`wsl.exe` (adds a layer + 9p latency for no benefit).

## Changes

### 1. Harden `scripts/aoe2_watcher.py` for unattended running

- **Supervisor loop:** wrap the login + poll loop so any uncaught exception (DNS
  blip, server down, login failure) is logged, waited out (~30 s), and retried,
  rather than exiting. Task Scheduler's restart becomes the backstop, not the first
  line of defense.
- **Config file fallback:** if the three env vars (`AOE2_SERVER_URL`,
  `AOE2_ADMIN_SECRET`, `AOE2_REC_DIR`) aren't set, read them from a gitignored
  `scripts/aoe2_watcher.env` (simple `KEY=VALUE` lines). Keeps the admin secret out
  of git and out of the task definition.
- **Rotating log:** since it runs headless, route output to a size-rotated logfile
  (`aoe2_watcher.log` next to the `.env`, ~1 MB x 3) in addition to stdout. Use
  stdlib `logging` + `RotatingFileHandler` — no new dependency.

These are additive; running the script by hand still works exactly as before.

### 2. `scripts/install_aoe2_watcher.ps1` (one-time installer)

Idempotent PowerShell run once on the gaming PC:

- `pip install httpx` into the Windows Python (the watcher's one dependency).
- Register/replace the scheduled task: At-Log-On trigger, `pythonw.exe` running the
  watcher, run hidden, restart-on-failure. Self-locates the repo path.
- Print where to put `scripts/aoe2_watcher.env` and where the log lives.

### 3. Docs

- `scripts/AOE2_WATCHER.md` — what it does, the one-time install command, the
  `.env` keys, where the log is, how to stop/start/check status.
- One-line pointer added from `docs/infrastructure.md`.

## Testing

- Extend `scripts/test_aoe2_watcher.py`: cover the new `.env` loader (parsing,
  env-vars-win precedence) and that the supervisor loop catches an exception and
  retries instead of propagating. The existing pure-function tests stay green.
- Manual: run the installer on the gaming PC, finish a 1v1, confirm the rec appears
  on nam685.de/plays/aoe2 with no terminal open; confirm it survives a reboot.

## Out of scope

Changing upload/parse/coach behavior; the polling/stable-size detection logic
(unchanged); pre-login operation.
