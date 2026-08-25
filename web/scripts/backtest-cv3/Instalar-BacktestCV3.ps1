# Registra (via schtasks.exe) una tarea de Windows que corre run.ts todos los
# dias de semana a las 3:15pm (hora local de esta PC, ~15 min despues del
# cierre 8:30am-3:00pm CT) — backtest diario de "Contratos vecinos 3.0"
# (SPX + TSLA), pedido explicito de Carlos (2026-08-25): "guarda toda esa
# tabla para que me muestres mas tarde las entradas y salidas y asi ir
# viendo errores... y vayas mejorando tu sistema".
#
# Uso: doble clic (o clic derecho -> "Ejecutar con PowerShell"). Si Windows
# bloquea el doble clic por politica de ejecucion, corre esto una vez desde
# una PowerShell normal:
#   powershell -ExecutionPolicy Bypass -File "Instalar-BacktestCV3.ps1"

$TaskName = "VisionaryTrades-CV3Backtest"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerCmd = Join-Path $ScriptDir "_run-backtest.cmd"

if (-not (Test-Path $RunnerCmd)) {
    Write-Host "No encuentro _run-backtest.cmd junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Quita una version previa si existia, para que reinstalar sea idempotente.
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null

schtasks /Create /TN $TaskName /TR "`"$RunnerCmd`"" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 15:15 /RL LIMITED /F

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada. Corre lunes a viernes a las 3:15pm (hora de esta PC), ~15 min despues del cierre." -ForegroundColor Green
    Write-Host "Necesita que la PC este encendida a esa hora — si estaba apagada, Windows NO la corre despues sola."
    Write-Host "Resultado (JSON) en: $ScriptDir\..\..\data\backtest-cv3\{fecha}.json"
    Write-Host "Log en:              $ScriptDir\..\..\data\backtest-cv3.log"
    Write-Host "Avisa por Telegram con la tabla de entradas/salidas del dia (mismo bot que la alerta de pre-market)."
    Write-Host "Para revisarla:     schtasks /Query /TN `"$TaskName`" /V /FO LIST"
    Write-Host "Para correrla ya:   schtasks /Run /TN `"$TaskName`""
    Write-Host "Para desinstalarla: Desinstalar-BacktestCV3.ps1"
} else {
    Write-Host "schtasks fallo (codigo $LASTEXITCODE). Revisa el mensaje de arriba." -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
