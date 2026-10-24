# Registra la tarea de Windows "VisionaryTrades-VisionFuturaReplay": lunes a viernes a las 3:20pm
# y (respaldo) a las 8:00pm, hora de esta PC (centro / Texas: el mercado cierra 3:00pm), arma las
# repeticiones de VisionFutura de SPX, NQ y TSLA y guarda su backtest del dia (run.ts).
# Pedido explicito de Carlos (2026-10-23): "instala la tarea programada que arme las repeticiones
# de SPX, NQ y TSLA cada dia habil despues del cierre". No manda Telegram ni nada: solo guarda.
#
# Uso: clic derecho -> "Ejecutar con PowerShell". Si Windows bloquea el doble clic:
#   powershell -ExecutionPolicy Bypass -File "Instalar-GuardadoVisionFutura.ps1"
param([switch]$NoPause)

$TaskName = "VisionaryTrades-VisionFuturaReplay"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "_run.cmd"

if (-not (Test-Path $RunnerCmd)) {
    Write-Host "No encuentro _run.cmd junto a este script." -ForegroundColor Red
    if (-not $NoPause) { Read-Host "Presiona Enter para salir" }
    exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$days = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
$triggers = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At 3:20PM),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At 8:00PM)
)
$action = New-ScheduledTaskAction -Execute $RunnerCmd
# StartWhenAvailable: si la PC estaba dormida a esa hora, corre en cuanto despierte.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -StartWhenAvailable -DontStopOnIdleEnd

try {
    Register-ScheduledTask -TaskName $TaskName -Trigger $triggers -Action $action -Settings $settings `
        -Description "VisionFutura: arma las repeticiones de SPX, NQ y TSLA y guarda el backtest del dia (lunes a viernes 3:20pm y 8:00pm)" -Force | Out-Null
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada: lunes a viernes 3:20pm y 8:00pm (hora de esta PC)." -ForegroundColor Green
    Write-Host "Necesita la PC encendida (si estaba dormida, corre al despertar). No necesita la app abierta."
    Write-Host "Log en: $ScriptDir\..\..\data\vision-futura\replay-task.log"
    Write-Host "Para revisarla:     Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "Para correrla ya:   Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "Para desinstalarla: Desinstalar-GuardadoVisionFutura.ps1"
} catch {
    Write-Host "Fallo instalando la tarea: $_" -ForegroundColor Red
}

if (-not $NoPause) { Read-Host "Presiona Enter para cerrar" }
