# Registra el streamer de SPY/QQQ (Tastytrade) — fuente primaria de Agente
# ODTE para esos dos tickers. Mismo patron horario que las demas tareas de
# este proyecto (AtLogOn esta bloqueado en esta PC, ver nota en
# scripts/0dte-stream/Instalar-Stream0DTE.ps1).
#
# Uso: clic derecho -> "Ejecutar con PowerShell".
# Para quitarla: Unregister-ScheduledTask -TaskName VisionaryTrades-IndexStream

$TaskName = "VisionaryTrades-IndexStream"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "run-tastytrade-index-stream.cmd"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$RunnerCmd`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:00AM
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings `
    -Description "Streamer de Tastytrade para SPY/QQQ (Agente ODTE) — lun-vie 8:00am" -Force | Out-Null
Write-Host "Tarea '$TaskName' instalada." -ForegroundColor Green
$go = Read-Host "Arrancarla ahora? (S/N)"
if ($go -eq "S" -or $go -eq "s") { Start-ScheduledTask -TaskName $TaskName; Start-Sleep -Seconds 3; Write-Host (Get-ScheduledTask -TaskName $TaskName).State }
Read-Host "Presiona Enter para cerrar"
