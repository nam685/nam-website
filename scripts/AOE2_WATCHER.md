# AoE2 recorded-game watcher

Auto-uploads your Age of Empires 2 DE recorded games to nam685.de. After every ranked
1v1, the finished `.aoe2record` is detected, uploaded to `/api/aoe2/upload/`, analyzed,
and shown on [nam685.de/plays/aoe2](https://nam685.de/plays/aoe2). Team games,
single-player, and vs-AI games are skipped server-side.

It runs as a hidden background **daemon** on the gaming PC — start it once and forget it.

## How it works

`aoe2_watcher.py` polls the savegame folder every few seconds. When a `.aoe2record` stops
growing (the game finished writing it), it hashes the file and POSTs it once. A local hash
set plus server-side dedup means nothing is ever uploaded twice, so restarts are safe.

A top-level supervisor restarts the watch loop after any error (network blip, expired
login, server down), so the daemon survives anything. Output is written to
`scripts/aoe2_watcher.log` (size-rotated) and stdout.

## One-time setup (Windows gaming PC)

1. **Create the config file** `scripts/aoe2_watcher.env` (gitignored — holds the admin secret):

   ```ini
   AOE2_SERVER_URL=https://nam685.de
   AOE2_ADMIN_SECRET=<the site ADMIN_SECRET>
   AOE2_REC_DIR=C:\Users\lehai\Games\Age of Empires 2 DE\76561198829134149\savegame
   ```

   (Config can also come from environment variables, which take precedence over the file.)

2. **Install the daemon** — run once in PowerShell (no admin needed):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install_aoe2_watcher.ps1
   ```

   This installs the one dependency (`httpx`) into your Windows Python and registers a
   Scheduled Task that starts the watcher **at log on**, runs it **hidden** (no console
   window via `pythonw.exe`), and **restarts it on failure**.

3. **Start it now** without logging out:

   ```powershell
   Start-ScheduledTask -TaskName AoE2RecWatcher
   ```

From then on it starts automatically whenever you log into Windows.

## Operating it

```powershell
Start-ScheduledTask  -TaskName AoE2RecWatcher                       # start
Stop-ScheduledTask   -TaskName AoE2RecWatcher                       # stop
Get-ScheduledTask    -TaskName AoE2RecWatcher | Get-ScheduledTaskInfo   # status / last result
Unregister-ScheduledTask -TaskName AoE2RecWatcher -Confirm:$false   # uninstall
```

Logs: `scripts/aoe2_watcher.log`. On startup it scans the existing folder (backlog
catch-up), so a first run after a break uploads anything missed.

## Running by hand (debugging)

With the env vars set (or `aoe2_watcher.env` present):

```bash
uv run python scripts/aoe2_watcher.py    # from repo root
```
