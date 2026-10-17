# The payout loop (or its ctl) with the settings from %USERPROFILE%\.hashcoin\payouts.env, which stays
# outside the repository (keys, RPC URL, webhook). docs/LAUNCH-RUNBOOK.md has the file's contents.
#
#   powershell -ExecutionPolicy Bypass -File services\payouts\scripts\payouts.ps1 --dry-run    one round, sends nothing
#   powershell -ExecutionPolicy Bypass -File services\payouts\scripts\payouts.ps1              run until stopped (Ctrl+C)
#   powershell -ExecutionPolicy Bypass -File services\payouts\scripts\payouts.ps1 ctl status   (or: ctl kill "why", ctl resume, ...)
#
# HASH_ENV_FILE points it at another file (e.g. a devnet rehearsal's).
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Rest)
$ErrorActionPreference = "Stop"
if ($null -eq $Rest) { $Rest = @() }
$envFile = if ($env:HASH_ENV_FILE) { $env:HASH_ENV_FILE } else { Join-Path $env:USERPROFILE ".hashcoin\payouts.env" }
if (-not (Test-Path $envFile)) { Write-Host "Missing $envFile (docs/LAUNCH-RUNBOOK.md, step 7)."; exit 1 }
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
}
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\..\.."))
if ($Rest.Count -gt 0 -and $Rest[0] -eq "ctl") {
  npx tsx services/payouts/src/ctl.ts @($Rest | Select-Object -Skip 1)
} else {
  npx tsx services/payouts/src/main.ts @Rest
}
exit $LASTEXITCODE
