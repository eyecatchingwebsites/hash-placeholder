<#
.SYNOPSIS
  Starts the Hashcoin API when Windows starts, before anyone signs in (so it comes back by
  itself after a Windows Update restart or a power cut).

.DESCRIPTION
  Run once in PowerShell opened with "Run as administrator", from the repo folder:
    powershell -ExecutionPolicy Bypass -File infra\pc\api-autostart.ps1
  Creates the scheduled task "Hashcoin API", which runs infra\pc\run-api.ps1 as your Windows
  account (no password stored; it can use the internet and your files) and starts it now.
  Remove it with:  Unregister-ScheduledTask -TaskName "Hashcoin API" -Confirm:$false
#>
param([string]$TaskName = "Hashcoin API")
$ErrorActionPreference = "Stop"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "Open PowerShell with 'Run as administrator' and run this again." -ForegroundColor Red; exit 1 }

$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run-api.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT30S"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
# No time limit, keep running on battery, restart if the task itself fails.
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

# If the API is already running in a window, close that window first (two copies can't share the port).
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 15
Get-ScheduledTask -TaskName $TaskName | Format-Table -AutoSize TaskName, State
Write-Host "Started. Log: services\api\data\api.log. Check: powershell -ExecutionPolicy Bypass -File infra\pc\check-api.ps1"
