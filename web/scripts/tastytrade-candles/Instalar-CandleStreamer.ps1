# Registra (via schtasks.exe) una tarea de Windows que arranca
# candle-streamer.mjs al iniciar sesion y lo mantiene vivo — a diferencia del
# keep-alive de MarketSnack (que "toca" cada 25 min y termina), este proceso
# se queda corriendo indefinidamente (streaming DXLink de tastytrade). El
# .cmd generado lo relanza solo si se cae (loop con reintento), asi la tarea
# programada solo necesita dispararlo UNA vez al iniciar sesion.
#
# Uso: doble clic (o clic derecho -> "Ejecutar con PowerShell"). Si Windows bloquea el
# doble clic por politica de ejecucion, corre esto una vez desde una PowerShell normal:
#   powershell -ExecutionPolicy Bypass -File "Instalar-CandleStreamer.ps1"

$TaskName = "VisionaryTrades-TastytradeCandleStreamer"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StreamerScript = Join-Path $ScriptDir "candle-streamer.mjs"
$NodeExe = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $NodeExe)) {
    Write-Host "No encuentro node.exe en $NodeExe. Ajusta la ruta en este script si Node esta instalado en otro lugar." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}
if (-not (Test-Path $StreamerScript)) {
    Write-Host "No encuentro candle-streamer.mjs junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Mismo motivo que _run-keepalive.cmd: schtasks.exe no acepta bien comillas
# anidadas en /TR, asi que se envuelve en un .cmd propio. Este ademas hace un
# loop de reintento (el proceso deberia vivir para siempre solo — si se cae
# por un error no manejado, lo relanza a los 10s en vez de dejarlo muerto
# hasta el proximo logon).
$RunnerCmd = Join-Path $ScriptDir "_run-candle-streamer.cmd"
@"
@echo off
:loop
"$NodeExe" "$StreamerScript"
timeout /t 10 /nobreak >nul
goto loop
"@ | Out-File -FilePath $RunnerCmd -Encoding ascii -Force

# Quita una version previa si existia, para que reinstalar sea idempotente.
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null

schtasks /Create /TN $TaskName /TR "`"$RunnerCmd`"" /SC ONLOGON /RL LIMITED /F

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada. Arranca al iniciar sesion de Windows y se mantiene corriendo (se relanza solo si se cae)." -ForegroundColor Green
    Write-Host "Velas en:           $ScriptDir\..\..\data\tastytrade-candles\{TICKER}.json"
    Write-Host "Para arrancarla ya (sin reiniciar sesion): schtasks /Run /TN `"$TaskName`""
    Write-Host "Para revisarla:     schtasks /Query /TN `"$TaskName`" /V /FO LIST"
    Write-Host "Para desinstalarla: Desinstalar-CandleStreamer.ps1"
} else {
    Write-Host "schtasks fallo (codigo $LASTEXITCODE). Revisa el mensaje de arriba." -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
