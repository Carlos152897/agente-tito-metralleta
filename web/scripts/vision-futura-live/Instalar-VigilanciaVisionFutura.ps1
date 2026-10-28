# Registra la tarea de Windows "VisionaryTrades-VisionFuturaLive": lunes a viernes a las 8:25am,
# hora de esta PC (centro / Texas = 9:25am Nueva York), corre poll.ts, que vigila SPX, NQ y TSLA
# en vivo cada 30 s hasta las 3:00pm (cierre) sin necesitar la pagina abierta, y archiva las
# alertas del dia. Pedido de Carlos (2026-10-27): "guardar tambien las alertas en vivo con su
# resultado y dejar la pagina abierta todo el dia".
#
# Uso: clic derecho -> "Ejecutar con PowerShell". Si Windows bloquea el doble clic:
#   powershell -ExecutionPolicy Bypass -File "Instalar-VigilanciaVisionFutura.ps1"
param([switch]$NoPause)

$TaskName = "VisionaryTrades-VisionFuturaLive"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "_run.cmd"

if (-not (Test-Path $RunnerCmd)) {
    Write-Host "No encuentro _run.cmd junto a este script." -ForegroundColor Red
    if (-not $NoPause) { Read-Host "Presiona Enter para salir" }
    exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$days = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At 8:25AM
$action = New-ScheduledTaskAction -Execute $RunnerCmd
# StartWhenAvailable: si la PC estaba apagada o dormida a las 8:25, arranca en cuanto despierte.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 9) -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
    Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings `
        -Description "VisionFutura: vigila SPX, NQ y TSLA en vivo cada 30 s de la apertura al cierre y guarda las alertas del dia (lunes a viernes 8:25am)" -Force | Out-Null
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada: lunes a viernes 8:25am (hora de esta PC) hasta el cierre." -ForegroundColor Green
    Write-Host "Necesita la PC encendida (si estaba dormida, arranca al despertar). No necesita la app abierta."
    Write-Host "Log en: $ScriptDir\..\..\data\vision-futura\live-task.log"
    Write-Host "Para revisarla:     Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "Para correrla ya:   Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "Para desinstalarla: Desinstalar-VigilanciaVisionFutura.ps1"
} catch {
    Write-Host "Fallo instalando la tarea: $_" -ForegroundColor Red
}

if (-not $NoPause) { Read-Host "Presiona Enter para cerrar" }
