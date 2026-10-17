<#
.SYNOPSIS
  Puts the Hashcoin API (services/api on this PC) online at https://api.hashcoin.app through a
  Cloudflare Tunnel, running as a Windows service. No router ports are opened.

.DESCRIPTION
  Run in PowerShell opened with "Run as administrator", from the repo folder:
    powershell -ExecutionPolicy Bypass -File infra\pc\setup-tunnel.ps1

  Safe to run again (it reuses the tunnel and updates the service). Steps:
    1. Finds cloudflared, or offers to install it with winget (Cloudflare.cloudflared).
    2. Signs this PC in to your Cloudflare account (a browser opens: pick the domain).
    3. Creates the tunnel "hashcoin-api" (once) and points api.hashcoin.app at it (a DNS record).
    4. Writes C:\ProgramData\Hashcoin\cloudflared\config.yml from infra\pc\config.template.yml,
       next to the tunnel's credentials file, readable only by Administrators and SYSTEM.
    5. Installs or updates the "Cloudflared" Windows service (starts with Windows, restarts if it
       crashes) and starts it.
    6. Runs infra\pc\check-api.ps1.

  -DryRun only prints the config it would write (no admin needed, nothing changed).
#>
param(
  [string]$Hostname = "api.hashcoin.app",
  [string]$TunnelName = "hashcoin-api",
  [int]$ApiPort = 8787,
  [switch]$DryRun
)
# Native commands (cloudflared, sc.exe) are checked by exit code; cmdlets that must work use -ErrorAction Stop.
$ErrorActionPreference = "Continue"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dir = Join-Path $env:ProgramData "Hashcoin\cloudflared"
$ConfigPath = Join-Path $Dir "config.yml"
$ServiceName = "Cloudflared"

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host ""; Write-Host "STOPPED: $msg" -ForegroundColor Red; exit 1 }

function Render-Config($tunnelId, $credFile) {
  $t = Get-Content -Raw -Path (Join-Path $Here "config.template.yml")
  $t = $t.Replace("{{TUNNEL_ID}}", $tunnelId).Replace("{{CREDENTIALS_FILE}}", $credFile)
  $t = $t.Replace("{{LOG_FILE}}", (Join-Path $Dir "cloudflared.log")).Replace("{{API_PORT}}", "$ApiPort")
  return $t.Replace("hostname: api.hashcoin.app", "hostname: $Hostname")
}

if ($DryRun) {
  Write-Host (Render-Config "<tunnel id>" (Join-Path $Dir "<tunnel id>.json"))
  exit 0
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "open PowerShell with 'Run as administrator' and run this again." }

# ---------- 1. cloudflared ----------
Step "Looking for cloudflared"
function Find-Cloudflared {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}
$Exe = Find-Cloudflared
if (-not $Exe) {
  $yes = Read-Host "cloudflared isn't installed. Install it now with winget (Cloudflare's official package)? [y/N]"
  if ($yes -notmatch '^[yY]') { Fail "install cloudflared (winget install --id Cloudflare.cloudflared -e), then run this again." }
  winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
  $Exe = Find-Cloudflared
  if (-not $Exe) { Fail "cloudflared installed but wasn't found. Close this window, open a new administrator PowerShell and run this again." }
}
Write-Host "cloudflared: $Exe"
& $Exe --version

# ---------- 2. Sign in ----------
$UserDir = Join-Path $env:USERPROFILE ".cloudflared"
$Cert = Join-Path $UserDir "cert.pem"
if (-not (Test-Path $Cert)) {
  Step "Signing in to Cloudflare: a browser opens. Log in, click the domain (hashcoin.app), then Authorize."
  & $Exe tunnel login
  if (-not (Test-Path $Cert)) { Fail "no sign-in certificate at $Cert. Run this again and finish the browser step." }
}

# ---------- 3. Tunnel and DNS ----------
Step "Tunnel '$TunnelName'"
$list = & $Exe tunnel list --output json | Out-String | ConvertFrom-Json
$tunnel = $list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
if (-not $tunnel) {
  & $Exe tunnel create $TunnelName
  if ($LASTEXITCODE -ne 0) { Fail "couldn't create the tunnel." }
  $list = & $Exe tunnel list --output json | Out-String | ConvertFrom-Json
  $tunnel = $list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
$TunnelId = $tunnel.id
Write-Host "tunnel id: $TunnelId"
$UserCred = Join-Path $UserDir "$TunnelId.json"
$Cred = Join-Path $Dir "$TunnelId.json"
if (-not (Test-Path $UserCred) -and -not (Test-Path $Cred)) {
  Fail "the tunnel exists but its credentials file ($TunnelId.json) isn't on this PC. Delete the tunnel (cloudflared tunnel delete $TunnelName) and run this again."
}

Step "Pointing $Hostname at the tunnel (DNS)"
& $Exe tunnel route dns --overwrite-dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) { Fail "couldn't create the DNS record for $Hostname. Is the domain added to this Cloudflare account?" }

# ---------- 4. Config ----------
Step "Writing $ConfigPath"
New-Item -ItemType Directory -Force -Path $Dir -ErrorAction Stop | Out-Null
if (Test-Path $UserCred) { Copy-Item -Force $UserCred $Cred -ErrorAction Stop }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($ConfigPath, (Render-Config $TunnelId $Cred), $utf8)
# Only SYSTEM (the service) and Administrators can read the tunnel credentials.
icacls $Dir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
& $Exe tunnel --config $ConfigPath ingress validate
if ($LASTEXITCODE -ne 0) { Fail "cloudflared says the config is invalid (see above)." }
& $Exe tunnel --config $ConfigPath ingress rule "https://$Hostname/v1/health"

# ---------- 5. Service ----------
Step "Windows service '$ServiceName'"
$bin = "`"$Exe`" --config `"$ConfigPath`" tunnel run"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  if ($svc.Status -ne "Stopped") { Stop-Service -Name $ServiceName -Force -ErrorAction Stop }
  # The registry, not sc.exe: Windows PowerShell mangles the quotes inside binPath= arguments.
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name ImagePath -Value $bin -ErrorAction Stop
} else {
  New-Service -Name $ServiceName -DisplayName "Cloudflare Tunnel (Hashcoin API)" -BinaryPathName $bin -StartupType Automatic -ErrorAction Stop | Out-Null
}
sc.exe config $ServiceName start= delayed-auto | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
Start-Service -Name $ServiceName -ErrorAction Stop
Start-Sleep -Seconds 8
Get-Service -Name $ServiceName | Format-Table -AutoSize Name, Status, StartType

# ---------- 6. Check ----------
Step "Health check"
& (Join-Path $Here "check-api.ps1") -Hostname $Hostname -ApiPort $ApiPort
