# Fetch the stores listed in windows\chains.txt and push the data to GitHub.
# Run by Task Scheduler; safe to run by hand any time.

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
New-Item -ItemType Directory -Force -Path "$Repo\windows\logs" | Out-Null
$log = "$Repo\windows\logs\fetch-$(Get-Date -Format 'yyyy-MM-dd').log"

function Log($m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Tee-Object -FilePath $log -Append }

# Commit identity for this project folder only (your global Git settings are untouched).
git config user.name 'price-bot (windows)'
git config user.email 'price-bot@users.noreply.github.com'
git config core.autocrlf false

$chains = (Get-Content "$Repo\windows\chains.txt" | Where-Object { $_ -and -not $_.StartsWith('#') }) -join ' '
if (-not $chains) { $chains = 'sprouts' }

# Start from GitHub's latest data; local data changes are only ever produced by this script.
Log 'Pulling latest from GitHub'
git reset -q -- docs/data
git checkout -q -- docs/data 2>$null
git pull --rebase 2>&1 | ForEach-Object { Log $_ }

Log "Fetching: $chains"
$env:FETCH_RUNNER = 'windows'
node src/run.js $chains.Split(' ') 2>&1 | ForEach-Object { Log $_ }

git add docs/data
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Log 'No price changes to push'; exit 0 }

git commit -q -m "Update prices from Windows PC ($chains) $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log 'Commit failed - nothing pushed'; exit 1 }

for ($i = 1; $i -le 3; $i++) {
  git pull --rebase 2>&1 | ForEach-Object { Log $_ }
  git push 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -eq 0) { Log 'Pushed to GitHub'; exit 0 }
  Start-Sleep -Seconds 5
}
Log 'Push failed after 3 tries'
exit 1
