# Fetch the stores listed in windows\chains.txt and push the data to GitHub.
# Run by Task Scheduler; safe to run by hand any time.

$ErrorActionPreference = 'Continue'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
New-Item -ItemType Directory -Force -Path "$Repo\windows\logs" | Out-Null
$log = "$Repo\windows\logs\fetch-$(Get-Date -Format 'yyyy-MM-dd').log"

function Log($m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Tee-Object -FilePath $log -Append }

$chains = (Get-Content "$Repo\windows\chains.txt" | Where-Object { $_ -and -not $_.StartsWith('#') }) -join ' '
if (-not $chains) { $chains = 'sprouts' }

Log "Pulling latest from GitHub"
git pull --rebase --autostash 2>&1 | ForEach-Object { Log $_ }

Log "Fetching: $chains"
$env:FETCH_RUNNER = 'windows'
node src/run.js $chains.Split(' ') 2>&1 | ForEach-Object { Log $_ }

git add docs/data
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Log 'No price changes'; exit 0 }

git commit -m "Update prices from Windows PC ($chains) $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>&1 | ForEach-Object { Log $_ }
for ($i = 1; $i -le 3; $i++) {
  git pull --rebase 2>&1 | ForEach-Object { Log $_ }
  git push 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -eq 0) { Log 'Pushed'; exit 0 }
  Start-Sleep -Seconds 5
}
Log 'Push failed after 3 tries'
exit 1
