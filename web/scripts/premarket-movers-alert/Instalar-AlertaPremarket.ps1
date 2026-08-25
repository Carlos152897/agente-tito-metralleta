# Registra (via schtasks.exe) una tarea de Windows que corre scan.mjs todos los dias
# de semana a las 8:15am (hora local de esta PC) — alerta de pre-market por Telegram
# de "Grandes empresas" (ago 2026, pedido explicito de Carlos).
#
# Uso: doble clic (o clic derecho -> "Ejecutar con PowerShell"). Si Windows bloquea el
# doble clic por politica de ejecucion, corre esto una vez desde una PowerShell normal:
#   powershell -ExecutionPolicy Bypass -File "Instalar-AlertaPremarket.ps1"

$TaskName = "VisionaryTrades-PremarketMoversAlert"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScanScript = Join-Path $ScriptDir "scan.mjs"
$NodeExe = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $NodeExe)) {
    Write-Host "No encuentro node.exe en $NodeExe. Ajusta la ruta en este script si Node esta instalado en otro lugar." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}
if (-not (Test-Path $ScanScript)) {
    Write-Host "No encuentro scan.mjs junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# schtasks.exe no acepta bien comillas anidadas dentro de /TR en todas las builds de
# Windows, asi que se envuelve la llamada en un .cmd propio — mismo patron que
# marketsnack-keepalive. Se REGENERA acá con la ruta actual de $ScriptDir (no queda
# apuntando a una carpeta vieja si el proyecto se vuelve a mover/renombrar).
$RunnerCmd = Join-Path $ScriptDir "_run-scan.cmd"
@"
@echo off
"$NodeExe" "$ScanScript"
"@ | Out-File -FilePath $RunnerCmd -Encoding ascii -Force

# Quita una version previa si existia, para que reinstalar sea idempotente.
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null

schtasks /Create /TN $TaskName /TR "`"$RunnerCmd`"" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:15 /RL LIMITED /F
$ok1 = $LASTEXITCODE -eq 0

# Segunda corrida a las 8:30 (pedido explicito de Carlos, 2026-08-25): repite el mismo
# escaneo de todo el mercado 15 min despues, para avisar de tickers que recien cruzaron
# el +-5% entre las dos corridas.
$TaskName2 = "VisionaryTrades-PremarketMoversAlert-0830"
schtasks /Delete /TN $TaskName2 /F 2>$null | Out-Null
schtasks /Create /TN $TaskName2 /TR "`"$RunnerCmd`"" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:30 /RL LIMITED /F
$ok2 = $LASTEXITCODE -eq 0

if ($ok1 -and $ok2) {
    Write-Host ""
    Write-Host "Tareas '$TaskName' y '$TaskName2' instaladas. Corren lunes a viernes a las 8:15am y 8:30am (hora de esta PC)." -ForegroundColor Green
    Write-Host "Necesita que la PC este encendida a esas horas — si estaba apagada, Windows NO las corre despues solas."
    Write-Host "Log en: $ScriptDir\..\..\data\premarket-movers.log"
    Write-Host "Para revisarlas:     schtasks /Query /TN `"$TaskName`" /V /FO LIST"
    Write-Host "Para correrlas ya:   schtasks /Run /TN `"$TaskName`""
    Write-Host "Para desinstalarlas: Desinstalar-AlertaPremarket.ps1"
} else {
    Write-Host "schtasks fallo instalando una de las dos tareas. Revisa el mensaje de arriba." -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
