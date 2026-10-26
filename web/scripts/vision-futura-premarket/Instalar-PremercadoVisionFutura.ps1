# Registra la tarea de Windows "VisionaryTrades-VisionFuturaPremercado": lunes a viernes a las
# 7:00am, 8:00am y 8:20am, hora de esta PC (centro: 8:00, 9:00 y 9:20am de Nueva York), lee el
# pre-mercado de VisionFutura de SPX, NQ y TSLA y guarda el pronostico del dia (run.ts). La
# lectura de las 8:20 (9:20 NY) es la que queda congelada y se califica al cierre.
# Pedido explicito de Carlos (2026-10-25). No manda Telegram ni nada: solo guarda.
#
# Uso: clic derecho -> "Ejecutar con PowerShell". Si Windows bloquea el doble clic:
#   powershell -ExecutionPolicy Bypass -File "Instalar-PremercadoVisionFutura.ps1"
param([switch]$NoPause)

$TaskName = "VisionaryTrades-VisionFuturaPremercado"
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
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At 7:00AM),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At 8:00AM),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At 8:20AM)
)
$action = New-ScheduledTaskAction -Execute $RunnerCmd
# StartWhenAvailable: si la PC estaba dormida a esa hora, corre en cuanto despierte.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -DontStopOnIdleEnd

try {
    Register-ScheduledTask -TaskName $TaskName -Trigger $triggers -Action $action -Settings $settings `
        -Description "VisionFutura: lee el pre-mercado de SPX, NQ y TSLA y guarda el rango probable del dia (lunes a viernes 7:00, 8:00 y 8:20am)" -Force | Out-Null
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada: lunes a viernes 7:00, 8:00 y 8:20am (hora de esta PC)." -ForegroundColor Green
    Write-Host "Necesita la PC encendida (si estaba dormida, corre al despertar). No necesita la app abierta."
    Write-Host "Log en: $ScriptDir\..\..\data\vision-futura\premarket-task.log"
    Write-Host "Para revisarla:     Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "Para correrla ya:   Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "Para desinstalarla: Desinstalar-PremercadoVisionFutura.ps1"
} catch {
    Write-Host "Fallo instalando la tarea: $_" -ForegroundColor Red
}

if (-not $NoPause) { Read-Host "Presiona Enter para cerrar" }
