# One-time setup on your Windows PC.
# Installs dependencies, downloads the browser Playwright drives, and registers a
# Task Scheduler job that fetches Sprouts (and any store GitHub can't reach)
# twice a day, plus Wednesday 12:05am when Sprouts' new ad starts, and pushes the data to GitHub.
#
# Run from the repo folder in PowerShell:
#   powershell -ExecutionPolicy Bypass -File windows\setup.ps1

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo

function Need($cmd, $wingetId) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Missing $cmd. Install it with:  winget install $wingetId   then reopen PowerShell and run this again." -ForegroundColor Yellow
    exit 1
  }
}
Need git 'Git.Git'
Need node 'OpenJS.NodeJS.LTS'

$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) { Write-Host "Node $major found; need 20 or newer (winget upgrade OpenJS.NodeJS.LTS)." -ForegroundColor Yellow; exit 1 }

Write-Host 'Installing packages...'
npm ci
Write-Host 'Downloading the browser used for Sprouts (one time, ~150 MB)...'
npx playwright install chromium

New-Item -ItemType Directory -Force -Path "$Repo\windows\logs" | Out-Null

Write-Host 'Test run (this also confirms GitHub push access)...'
powershell -ExecutionPolicy Bypass -File "$Repo\windows\fetch.ps1"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Repo\windows\fetch.ps1`"" `
  -WorkingDirectory $Repo
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '6:40AM'),
  (New-ScheduledTaskTrigger -Daily -At '6:40PM'),
  # Sprouts' new weekly ad starts Wednesday 12:00am; grab it right after.
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday -At '12:05AM')
)
# StartWhenAvailable: if the PC was off at a run time, run as soon as it's back on and signed in.
# WakeToRun: if the PC is asleep at a run time, wake it to run (can't wake a PC that's shut down).
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName 'Grocery Prices Fetch' -Action $action -Trigger $triggers -Settings $settings `
  -Description 'Fetch Sprouts weekly/monthly ad and push to GitHub' -Force | Out-Null

Write-Host ''
Write-Host "Done. 'Grocery Prices Fetch' runs daily at 6:40am and 6:40pm, plus Wednesday 12:05am (new Sprouts ad)." -ForegroundColor Green
Write-Host 'Missed runs (PC off) happen as soon as the PC is on and you sign in to Windows.'
Write-Host 'Logs: windows\logs\   Stores fetched from this PC: windows\chains.txt'
