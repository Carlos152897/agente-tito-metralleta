# Registra el streamer de "0DTE Live" (Tastytrade, contratos entrantes de SPX)
# como tarea programada, lunes a viernes a las 8:00am (antes de que abra el
# mercado). El propio streamer se queda corriendo TODO el dia (loop infinito
# con reconexion sola dentro de run-tastytrade-stream.cmd) — el disparador
# diario es solo para asegurarse de que arranque si la PC estaba apagada o el
# proceso se cayo durante la noche.
#
# Nota: se probo un disparador "AtLogOn" (arrancar solo al iniciar sesion,
# como corre esta misma PC), pero Windows lo bloquea para tareas de usuario
# estandar en esta maquina ("Access is denied") — por eso el disparador es
# horario, igual que las demas tareas de este proyecto.
#
# Uso: clic derecho -> "Ejecutar con PowerShell". Si Windows bloquea el doble
# clic por politica de ejecucion:
#   powershell -ExecutionPolicy Bypass -File "Instalar-Stream0DTE.ps1"
#
# Para quitarla: Unregister-ScheduledTask -TaskName VisionaryTrades-0DTEStream

$TaskName = "VisionaryTrades-0DTEStream"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "run-tastytrade-stream.cmd"

if (-not (Test-Path $RunnerCmd)) {
    Write-Host "No encuentro run-tastytrade-stream.cmd junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$RunnerCmd`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:00AM
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -DontStopOnIdleEnd

try {
    Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings `
        -Description "Streamer de Tastytrade para 0DTE Live (contratos entrantes de SPX) — lun-vie 8:00am" -Force | Out-Null
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada. Arranca lunes a viernes a las 8:00am (hora de esta PC) y se queda corriendo todo el dia." -ForegroundColor Green
    Write-Host "Necesita la PC encendida en ese horario — si estaba apagada, Windows no la corre despues sola."
    Write-Host "Escribe: data\0dte-stream\SPX-<fecha>.json (no toca data\0dte\, que usa MarketSnack)."
    Write-Host "Log en: $ScriptDir\..\..\logs\0dte-stream.log"
    Write-Host "Para revisarla:     Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "Para correrla ya:   Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "Para desinstalarla: Unregister-ScheduledTask -TaskName '$TaskName'"

    $go = Read-Host "Arrancarla ahora? (S/N)"
    if ($go -eq "S" -or $go -eq "s") {
        Start-ScheduledTask -TaskName $TaskName
        Start-Sleep -Seconds 3
        Write-Host ("Estado: " + (Get-ScheduledTask -TaskName $TaskName).State) -ForegroundColor Green
    }
} catch {
    Write-Host "Fallo instalando la tarea: $_" -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
