# Devnet rehearsal: opens two minimized windows, the API and the payout loop, each restarted if it
# stops. Logs (UTF-8): services/api/data/api.log, services/payouts/data/loop.log.
#   powershell -ExecutionPolicy Bypass -File scripts\rehearsal.ps1
# Started at login by "Hashcoin rehearsal.cmd" in the Windows Startup folder (delete it to stop that).
# Skips anything already running, so running it twice is harmless.
$root = Split-Path -Parent $PSScriptRoot

function Start-Service-Window($title, $entry, $log) {
  $running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$entry*" }
  if ($running) { Write-Host "$title already running"; return }
  $cmd = @"
`$host.UI.RawUI.WindowTitle = '$title'
Set-Location '$root'
while (`$true) {
  npx tsx $entry 2>&1 | ForEach-Object { `$l = "`$_"; Write-Host `$l; Add-Content -Path '$log' -Value `$l -Encoding UTF8 }
  Add-Content -Path '$log' -Value "`$(Get-Date -Format s)  stopped; restarting in 30 s" -Encoding UTF8
  Start-Sleep -Seconds 30
}
"@
  Start-Process powershell -WorkingDirectory $root -WindowStyle Minimized -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd
  Write-Host "$title started"
}

Start-Service-Window 'Hashcoin API' 'services/api/src/main.ts' "$root\services\api\data\api.log"
Start-Service-Window 'Hashcoin payout loop' 'services/payouts/src/main.ts' "$root\services\payouts\data\loop.log"
