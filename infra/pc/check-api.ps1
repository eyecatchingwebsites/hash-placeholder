<#
.SYNOPSIS
  Checks the Hashcoin API end to end: running on this PC, listening on localhost only, the
  Cloudflare Tunnel service running, and reachable at https://api.hashcoin.app.

.DESCRIPTION
  Run any time (no admin needed):
    powershell -ExecutionPolicy Bypass -File infra\pc\check-api.ps1
  Prints PASS/FAIL per line and exits 1 if anything failed.
#>
param(
  [string]$Hostname = "api.hashcoin.app",
  [int]$ApiPort = 8787
)
$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$failed = 0
function Pass($m) { Write-Host "PASS  $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "FAIL  $m" -ForegroundColor Red; $script:failed++ }
function Health($url) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 15
    return @{ code = [int]$r.StatusCode; body = $r.Content }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ code = $code; body = "$($_.Exception.Message)" }
  }
}

# 1. The API on this PC.
$local = Health "http://127.0.0.1:$ApiPort/v1/health"
if ($local.code -eq 200) { Pass "API answers on this PC (http://127.0.0.1:$ApiPort)" }
else { Bad "API not answering on this PC: start it (infra\pc\run-api.ps1, or the 'Hashcoin API' task). $($local.body)" }

# 2. Listening on localhost only, so nothing on the network can reach it except through the tunnel.
# (netstat rather than Get-NetTCPConnection, which needs WMI classes some PCs lack.)
$listen = @(netstat -an | Where-Object { $_ -match "LISTENING" } | ForEach-Object { ($_ -split "\s+")[2] } |
  Where-Object { $_ -match ":$ApiPort$" } | ForEach-Object { $_ -replace ":$ApiPort$", "" } | Sort-Object -Unique)
if ($listen.Count) {
  $open = @($listen | Where-Object { $_ -notin @("127.0.0.1", "[::1]") })
  if ($open.Count) { Bad "API listens on $($open -join ', '): other machines can reach it. Unset HOST so it binds to 127.0.0.1." }
  else { Pass "API listens on localhost only ($($listen -join ', '))" }
}

# 3. The tunnel service.
$svc = Get-Service -Name Cloudflared -ErrorAction SilentlyContinue
if (-not $svc) { Bad "no Cloudflared service: run infra\pc\setup-tunnel.ps1 as administrator" }
elseif ($svc.Status -ne "Running") { Bad "Cloudflared service is $($svc.Status): Start-Service Cloudflared (administrator)" }
else { Pass "Cloudflared service running" }

# 4. From the internet, through Cloudflare.
$public = Health "https://$Hostname/v1/health"
if ($public.code -eq 200) { Pass "https://$Hostname/v1/health answers" }
elseif ($public.code -eq 530) { Bad "https://$Hostname answers 530: Cloudflare can't reach this PC's tunnel (service stopped or not connected yet)" }
elseif ($public.code -eq 502) { Bad "https://$Hostname answers 502: the tunnel is up but the API isn't running" }
else { Bad "https://$Hostname/v1/health: $($public.code) $($public.body)" }

# 5. Only /v1/ goes through.
$other = Health "https://$Hostname/"
if ($other.code -eq 404) { Pass "https://$Hostname/ (outside /v1/) is a 404" }
elseif ($public.code -eq 200) { Bad "https://$Hostname/ answered $($other.code); expected 404 (check the tunnel config's ingress rules)" }

Write-Host ""
if ($failed) { Write-Host "$failed check(s) failed." -ForegroundColor Red; exit 1 }
Write-Host "All good: the app and the website can reach the API." -ForegroundColor Green
