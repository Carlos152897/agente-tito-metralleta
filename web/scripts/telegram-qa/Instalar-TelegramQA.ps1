# Registra una tarea de Windows que corre poll.ts cada 1 minuto, TODO el
# tiempo (no solo horario de mercado — Carlos puede preguntar a cualquier
# hora) — puente Telegram -> señal en vivo de "Contratos vecinos 3.0" ->
# Telegram. Pedido explicito de Carlos (2026-08-27): "yo te envio el ticket
# y tu me mandas call o put o no hacer nada".
#
# Version 2 (2026-08-27) — YA NO depende de `claude -p` ni de `claude /login`.
# La version anterior (2026-08-25) invocaba el CLI de Claude para responder,
# pero quedo bloqueada sin login y ademas solo podia LEER archivos viejos
# (no calcular una senal en vivo). Ahora poll.ts calcula todo el solo,
# reusando las mismas funciones puras/IO que ya usan las rutas en produccion
# (lib/liveTickerActivity.ts + lib/contratosVecinos3.ts) — sin bloqueos.
#
# Uso: clic derecho -> "Ejecutar con PowerShell", o:
#   powershell -ExecutionPolicy Bypass -File "Instalar-TelegramQA.ps1"

$TaskName = "VisionaryTrades-TelegramQA"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebDir = Resolve-Path (Join-Path $ScriptDir "..\..")
$PollScript = Join-Path $ScriptDir "poll.ts"
$TsxCmd = Join-Path $WebDir "node_modules\.bin\tsx.cmd"

if (-not (Test-Path $TsxCmd)) {
    Write-Host "No encuentro tsx en $TsxCmd (¿corriste 'npm install' en web/?)." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}
if (-not (Test-Path $PollScript)) {
    Write-Host "No encuentro poll.ts junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

$RunnerCmd = Join-Path $ScriptDir "_run-poll.cmd"
@"
@echo off
cd /d "$WebDir"
"$TsxCmd" "$PollScript"
"@ | Out-File -FilePath $RunnerCmd -Encoding ascii -Force

schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
schtasks /Create /TN $TaskName /TR "`"$RunnerCmd`"" /SC MINUTE /MO 1 /RL LIMITED /F

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada. Revisa mensajes nuevos cada 1 minuto, todo el dia." -ForegroundColor Green
    Write-Host "Necesita que la PC este encendida — si estaba apagada, Windows NO la corre despues sola."
    Write-Host ""
    Write-Host "Mandale por Telegram SOLO el ticker (ej: PLTR, SPX, TSLA) y te contesta CALL/PUT/NO OPERAR" -ForegroundColor Cyan
    Write-Host "con la señal real de ese momento (Contratos vecinos 3.0 / Grandes empresas)."
    Write-Host ""
    Write-Host "Log en: $ScriptDir\..\..\data\telegram-qa.log"
    Write-Host "Para correrla ya:   schtasks /Run /TN `"$TaskName`""
    Write-Host "Para desinstalarla: Desinstalar-TelegramQA.ps1"
} else {
    Write-Host "schtasks fallo (codigo $LASTEXITCODE)." -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
