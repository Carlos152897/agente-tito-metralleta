# Registra el streamer de futuros nativos ES/NQ (Tastytrade) — fuente
# primaria de Agente ODTE para /ES y /NQ. CME cotiza ~24/5 (domingo 6pm ET a
# viernes 5pm ET); el disparador es lun-vie 8:00am (AtLogOn bloqueado en esta
# PC) — si la PC se apaga el fin de semana, el streamer no arranca solo hasta
# el lunes 8am, perdiendose domingo 6pm-lunes 8am. El propio streamer se
# queda corriendo el resto del dia/noche una vez arrancado.
#
# Uso: clic derecho -> "Ejecutar con PowerShell".
# Para quitarla: Unregister-ScheduledTask -TaskName VisionaryTrades-FuturesStream

$TaskName = "VisionaryTrades-FuturesStream"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "run-tastytrade-futures-stream.cmd"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$RunnerCmd`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:00AM
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings `
    -Description "Streamer de Tastytrade para futuros nativos ES/NQ (Agente ODTE) — lun-vie 8:00am" -Force | Out-Null
Write-Host "Tarea '$TaskName' instalada." -ForegroundColor Green
$go = Read-Host "Arrancarla ahora? (S/N)"
if ($go -eq "S" -or $go -eq "s") { Start-ScheduledTask -TaskName $TaskName; Start-Sleep -Seconds 3; Write-Host (Get-ScheduledTask -TaskName $TaskName).State }
Read-Host "Presiona Enter para cerrar"
