# Registra una tarea de Windows que corre el MISMO poll.ts de
# scripts\odte-ticket-alert (las 3 senales: GEX Ticket, GEX Trade, GEX Trade
# Alternate) pero para /ES, cada 1 minuto, TODOS los dias. Pedido explicito
# de Carlos (2026-09-03): "para 0dte en prueba de fuego, enviame telegrama
# cuando el ES me de una entrada" - la pestana "0DTE" visible en Prueba de
# Fuego es OdteStandaloneTab.tsx (lib/odteStandalone/*), el MISMO motor que
# ya usa la alerta de SPX; por eso esto reusa el mismo poll.ts en vez de
# duplicar logica, solo con un runner distinto que le pasa "/ES".
#
# /ES cotiza CME casi 24/5 (domingo 6pm ET a viernes 5pm ET, pausa diaria de
# mantenimiento 5-6pm ET) - a diferencia de la tarea de SPX (ventana fija
# 8:30am-3:05pm), esta corre TODO EL DIA, todos los dias; poll.ts ya es
# ticker-aware (isFuturesMarketOpen para /ES y /NQ, isMarketOpen para el
# resto) y descarta en silencio los tramos cerrados.
#
# NOTA: sin el streamer de futuros (streamer/tastytrade-futures-stream.mjs)
# corriendo y con datos frescos de hoy, el motor cae a analizar /ES via SPX
# + basis en vivo (mismo comportamiento que ya se ve en la pestana web) - no
# es un fallo, es el respaldo documentado del propio motor.
#
# Uso: clic derecho -> "Ejecutar con PowerShell". Si Windows bloquea el
# doble clic por politica de ejecucion:
#   powershell -ExecutionPolicy Bypass -File "Instalar-AlertaEsOdteTicket.ps1"

$TaskName = "VisionaryTrades-EsOdteTicketAlert"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "_run-poll.cmd"

if (-not (Test-Path $RunnerCmd)) {
    Write-Host "No encuentro _run-poll.cmd junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$trigger = New-ScheduledTaskTrigger -Daily -At 12:00AM
$RepetitionClass = Get-CimClass -ClassName MSFT_TaskRepetitionPattern -Namespace Root/Microsoft/Windows/TaskScheduler
$Repetition = New-CimInstance -CimClass $RepetitionClass -ClientOnly -Property @{
    Duration = "P1D"
    Interval = "PT1M"
    StopAtDurationEnd = $false
}
$trigger.Repetition = $Repetition

$action = New-ScheduledTaskAction -Execute $RunnerCmd
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -DontStopOnIdleEnd

try {
    Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings `
        -Description "Alerta en vivo GEX Ticket + GEX Trade + GEX Trade Alternate (0DTE, /ES) por Telegram, cada 1 min, todos los dias" -Force | Out-Null
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada. Corre TODOS los dias cada 1 min (24h) - poll.ts descarta solo los tramos con /ES cerrado." -ForegroundColor Green
    Write-Host "Necesita que la PC este encendida en ese horario - si estaba apagada, Windows NO la corre despues sola."
    Write-Host "Avisa por Telegram cuando CUALQUIERA de las 3 senales (Ticket / GEX Trade / GEX Trade Alternate) cambia de verdad para /ES."
    Write-Host "Log en: $ScriptDir\..\..\data\odte-standalone\ticket-alert.log"
    Write-Host "Para revisarla:     Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "Para correrla ya:   Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "Para desinstalarla: Desinstalar-AlertaEsOdteTicket.ps1"
} catch {
    Write-Host "Fallo instalando la tarea: $_" -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
