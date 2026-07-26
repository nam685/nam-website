<#
.SYNOPSIS
  One-time installer that turns scripts/aoe2_watcher.py into a hidden Windows daemon.

  Run once in PowerShell on the gaming PC (no admin needed):
      powershell -ExecutionPolicy Bypass -File scripts\install_aoe2_watcher.ps1

  It:
    1. Installs the watcher's only dependency (httpx) into the Windows Python it finds.
    2. Registers a Scheduled Task that starts the watcher At Log On, runs it hidden via
       pythonw.exe (no console window), and restarts it on failure.

  Re-running is safe: it replaces the existing task.

  Config: put your settings in scripts\aoe2_watcher.env next to the watcher, e.g.
      AOE2_SERVER_URL=https://nam685.de
      AOE2_ADMIN_SECRET=<the site ADMIN_SECRET>
      AOE2_REC_DIR=C:\Users\lehai\Games\Age of Empires 2 DE\<steamid>\savegame
  Log: scripts\aoe2_watcher.log
#>

$ErrorActionPreference = "Stop"
$TaskName = "AoE2RecWatcher"

# Resolve repo paths relative to this script.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Watcher   = Join-Path $ScriptDir "aoe2_watcher.py"
$EnvFile   = Join-Path $ScriptDir "aoe2_watcher.env"

if (-not (Test-Path $Watcher)) { throw "watcher not found at $Watcher" }

# Find Windows Python (prefer the py launcher; fall back to python on PATH).
$python  = $null
$pythonw = $null
$pyCmd = Get-Command py.exe -ErrorAction SilentlyContinue
if ($pyCmd) {
    $python = (& py.exe -3 -c "import sys; print(sys.executable)").Trim()
} else {
    $pyOnPath = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pyOnPath) { $python = $pyOnPath.Source }
}
if (-not $python) { throw "No Windows Python found. Install Python 3 (python.org) and re-run." }

# pythonw.exe sits next to python.exe and runs without a console window.
$pythonw = Join-Path (Split-Path -Parent $python) "pythonw.exe"
if (-not (Test-Path $pythonw)) { $pythonw = $python }  # fall back to python.exe if no pythonw

Write-Host "Using Python: $python"

# 1. Install the one dependency.
Write-Host "Installing httpx into that Python..."
& $python -m pip install --user --quiet httpx

# 2. (Re)register the scheduled task.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task $TaskName..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action   = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$Watcher`"" -WorkingDirectory $ScriptDir
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -Hidden -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description "Auto-uploads AoE2 DE recorded games to nam685.de" | Out-Null

Write-Host ""
Write-Host "Installed scheduled task '$TaskName' (starts at log on, hidden, auto-restart)."
if (-not (Test-Path $EnvFile)) {
    Write-Warning "No config file yet. Create $EnvFile with AOE2_SERVER_URL / AOE2_ADMIN_SECRET / AOE2_REC_DIR."
}
Write-Host "Start it now without logging out:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Check it:                          Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "Log:                               $($ScriptDir)\aoe2_watcher.log"
