<#
.SYNOPSIS
  Runs the Hashcoin API (services/api) on this PC and restarts it if it stops.

.DESCRIPTION
  Settings come from an env file outside the repo (default: %USERPROFILE%\.hashcoin\api.env),
  one NAME=value per line, # for comments. For launch:
    HASH_NETWORK=mainnet
    HASH_SIGNING_KEY_FILE=C:\Users\<you>\.hashcoin\assignment-signing-key.pem
    HASH_PAYOUT_ADDRESS_PRL=<the platform's PRL address on Kryptex>
  Optional: PORT (default 8787), HASH_PUBLIC_RECORD, HASH_APP_UPDATE, HASH_SITE_ORIGINS.
  Never put HOST=0.0.0.0 here: the API stays on 127.0.0.1 and the public reaches it via the tunnel.

  Started at boot by the "Hashcoin API" scheduled task (api-autostart.ps1), or by hand:
    powershell -ExecutionPolicy Bypass -File infra\pc\run-api.ps1
  Output goes to services\api\data\api.log.
#>
param([string]$EnvFile = (Join-Path $env:USERPROFILE ".hashcoin\api.env"))
$ErrorActionPreference = "Continue"
$Repo = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..")
$Data = Join-Path $Repo "services\api\data"
New-Item -ItemType Directory -Force -Path $Data | Out-Null
$Log = Join-Path $Data "api.log"
# UTF-8 without a BOM, like the API's own output (Add-Content and >> would mix encodings).
function Note($msg) { [IO.File]::AppendAllText($Log, "$(Get-Date -Format s) $msg`r`n") }

if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#") -or -not $t.Contains("=")) { continue }
    $i = $t.IndexOf("=")
    [Environment]::SetEnvironmentVariable($t.Substring(0, $i).Trim(), $t.Substring($i + 1).Trim(), "Process")
  }
} else {
  Note "no ${EnvFile}: running with dev settings"
}

$npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $npx) { $npx = Join-Path $env:ProgramFiles "nodejs\npx.cmd" }

Set-Location (Join-Path $Repo "services\api")
while ($true) {
  Note "starting the API"
  & $npx --yes tsx src/main.ts 2>&1 | ForEach-Object { [IO.File]::AppendAllText($Log, "$_`r`n") }
  Note "the API stopped (exit $LASTEXITCODE); restarting in 10 s"
  Start-Sleep -Seconds 10
}
