<#
.SYNOPSIS
  Build an unsigned TEST installer of Hashcoin Miner that mines against the local dev API.

.DESCRIPTION
  A release build normally trusts only the production key, which isn't set yet. This script bakes in
  the local API's dev key and address instead (the window then says "test build"), and signs the
  update with a throwaway update key kept outside the repo in %LOCALAPPDATA%\hashcoin-dev.
  Never hand these installers to anyone: the release workflow builds the real ones.

  Prints the installer path and SHA-256, and writes latest.json (the update feed) next to it.

.EXAMPLE
  # API running first: npx tsx services/api/src/main.ts
  powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-local-test.ps1
  powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-local-test.ps1 -Version 0.1.1
#>
param(
  [string]$Api = "http://127.0.0.1:8787",
  [string]$Version = "",
  # Where the update test serves installers from (any folder server, e.g. `python -m http.server 8790`).
  [string]$DownloadBase = "http://127.0.0.1:8790"
)
$ErrorActionPreference = "Stop"
$desktop = Split-Path $PSScriptRoot -Parent
$tauriDir = Join-Path $desktop "src-tauri"
$devDir = Join-Path $env:LOCALAPPDATA "hashcoin-dev"
$key = Join-Path $devDir "updater-test.key"
# Throwaway key for local tests only, so its password can live here.
$keyPassword = "hashcoin-local-test-only"
New-Item -ItemType Directory -Force $devDir | Out-Null

# 1. A throwaway update key (never the production one, never in the repo).
if (-not (Test-Path $key)) {
  npx --yes @tauri-apps/cli@2 signer generate --ci -p $keyPassword -w $key
  if ($LASTEXITCODE -ne 0) { throw "could not make the test update key" }
}
$updatePub = (Get-Content "$key.pub" -Raw).Trim()

# 2. The local API's signing key: the test build trusts it, like the production key later.
$keys = Invoke-RestMethod "$Api/v1/keys"
$kid = @($keys.PSObject.Properties.Name)[0]
$apiKey = $keys.$kid
Write-Host "Trusting the local API's key '$kid' and server $Api"

# 3. Build: release config (update artifacts) + this test's update key and plain-http feed.
$overlay = @{ plugins = @{ updater = @{ pubkey = $updatePub; dangerousInsecureTransportProtocol = $true } } }
if ($Version) { $overlay.version = $Version }
$overlayPath = Join-Path $devDir "local-test.conf.json"
$overlay | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii $overlayPath

$env:HASHCOIN_TEST_TRUSTED_KEY = "${kid}:$apiKey"
$env:HASHCOIN_API_BASE = $Api
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $keyPassword
Push-Location $tauriDir
try {
  npx --yes @tauri-apps/cli@2 build --config tauri.release.conf.json --config $overlayPath
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
  Pop-Location
  Remove-Item Env:HASHCOIN_TEST_TRUSTED_KEY, Env:HASHCOIN_API_BASE, Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

# 4. Report the installer, its SHA-256, and the update feed for it.
$nsis = Join-Path $desktop "target\release\bundle\nsis"
$installer = Get-ChildItem $nsis -Filter "*-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$ver = ($installer.Name -split "_")[1]
$sha = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower()
$feed = Join-Path $nsis "latest.json"
$json = node (Join-Path $PSScriptRoot "update-feed.mjs") $installer.FullName $ver "$DownloadBase/$([uri]::EscapeDataString($installer.Name))" "Local test build"
# Plain UTF-8: Windows PowerShell's "utf8" adds a byte-order mark, which JSON.parse rejects.
[IO.File]::WriteAllText($feed, (($json -join "`n") + "`n"))
Write-Host ""
Write-Host "Test installer: $($installer.FullName)"
Write-Host "SHA-256:        $sha"
Write-Host "Update feed:    $feed"
