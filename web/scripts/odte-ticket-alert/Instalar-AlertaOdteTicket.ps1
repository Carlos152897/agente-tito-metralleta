# Registra una tarea de Windows que corre poll.ts cada 1 minuto, lunes a
# viernes, de 8:30am a 3:05pm (hora local de esta PC) — alerta EN VIVO por
# Telegram de las 3 senales GEX de la pestana 0DTE (SPX): GEX Ticket, GEX
# Trade y GEX Trade Alternate. Pedido explicito de Carlos (2026-08-30):
# primero solo el ticket, despues ampliado a las 3 ("de esos 3 enviame el
# mensaje, cualquiera que se active de los 3 o los 3"), cada una con su
# propio aviso de "esperando una nueva entrada" cuando desaparece.
#
# Mismo patron que Instalar-AlertaCV3Live.ps1: "semanal + repeticion cada 1
# minuto dentro de una ventana diaria" necesita el modulo ScheduledTasks de
# PowerShell con un CimInstance de repeticion armado a mano (schtasks.exe
# puro no puede expresar esa combinacion).
#
# Uso: clic derecho -> "Ejecutar con PowerShell" (necesita permisos para
# crear tareas programadas, normal en una cuenta de usuario estandar). Si
# Windows bloquea el doble clic por politica de ejecucion:
#   powershell -ExecutionPolicy Bypass -File "Instalar-AlertaOdteTicket.ps1"

$TaskName = "VisionaryTrades-OdteTicketAlert"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "_run-poll.cmd"

if (-not (Test-Path $RunnerCmd)) {
    Write-Host "No encuentro _run-poll.cmd junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:30AM
$RepetitionClass = Get-CimClass -ClassName MSFT_TaskRepetitionPattern -Namespace Root/Microsoft/Windows/TaskScheduler
$Repetition = New-CimInstance -CimClass $RepetitionClass -ClientOnly -Property @{
    Duration = "PT6H35M"  # 8:30am a 3:05pm — 5 min de colchon despues del cierre real (3:00pm)
    Interval = "PT1M"
    StopAtDurationEnd = $true
}
$trigger.Repetition = $Repetition

$action = New-ScheduledTaskAction -Execute $RunnerCmd
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -DontStopOnIdleEnd

try {
    Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings `
        -Description "Alerta en vivo GEX Ticket + GEX Trade + GEX Trade Alternate (0DTE, SPX) por Telegram, cada 1 min en horario de mercado" -Force | Out-Null
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada. Corre lunes a viernes cada 1 min de 8:30am a 3:05pm (hora de esta PC)." -ForegroundColor Green
    Write-Host "Necesita que la PC este encendida en ese horario — si estaba apagada, Windows NO la corre despues sola."
    Write-Host "Avisa por Telegram cuando CUALQUIERA de las 3 senales (Ticket / GEX Trade / GEX Trade Alternate) cambia de verdad (no en cada minuto)."
    Write-Host "Log en: $ScriptDir\..\..\data\odte-standalone\ticket-alert.log"
    Write-Host "Para revisarla:     Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "Para correrla ya:   Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "Para desinstalarla: Desinstalar-AlertaOdteTicket.ps1"
} catch {
    Write-Host "Fallo instalando la tarea: $_" -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
