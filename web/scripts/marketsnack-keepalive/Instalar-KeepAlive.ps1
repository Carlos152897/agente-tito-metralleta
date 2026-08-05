# Registra (via schtasks.exe) una tarea de Windows que corre keepalive.mjs cada ~25
# minutos, para tocar la sesion de MarketSnack y que no caduque por inactividad.
#
# Uso: doble clic (o clic derecho -> "Ejecutar con PowerShell"). Si Windows bloquea el
# doble clic por politica de ejecucion, corre esto una vez desde una PowerShell normal:
#   powershell -ExecutionPolicy Bypass -File "Instalar-KeepAlive.ps1"

$TaskName = "VisionaryTrades-MarketSnackKeepAlive"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$KeepAliveScript = Join-Path $ScriptDir "keepalive.mjs"
$NodeExe = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $NodeExe)) {
    Write-Host "No encuentro node.exe en $NodeExe. Ajusta la ruta en este script si Node esta instalado en otro lugar." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}
if (-not (Test-Path $KeepAliveScript)) {
    Write-Host "No encuentro keepalive.mjs junto a este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# schtasks.exe no acepta bien comillas anidadas dentro de /TR en todas las builds de
# Windows, asi que se envuelve la llamada en un .cmd propio: mas confiable que escapar
# comillas a mano y mas facil de diagnosticar (se puede correr el .cmd suelto).
$RunnerCmd = Join-Path $ScriptDir "_run-keepalive.cmd"
@"
@echo off
"$NodeExe" "$KeepAliveScript"
"@ | Out-File -FilePath $RunnerCmd -Encoding ascii -Force

# Quita una version previa si existia, para que reinstalar sea idempotente.
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null

schtasks /Create /TN $TaskName /TR "`"$RunnerCmd`"" /SC MINUTE /MO 25 /RL LIMITED /F

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Tarea '$TaskName' instalada. Corre cada 25 minutos (mientras tu sesion de Windows este iniciada)." -ForegroundColor Green
    Write-Host "Log en: $ScriptDir\..\..\data\marketsnack-keepalive.log"
    Write-Host "Para revisarla:     schtasks /Query /TN `"$TaskName`" /V /FO LIST"
    Write-Host "Para correrla ya:   schtasks /Run /TN `"$TaskName`""
    Write-Host "Para desinstalarla: Desinstalar-KeepAlive.ps1"
} else {
    Write-Host "schtasks fallo (codigo $LASTEXITCODE). Revisa el mensaje de arriba." -ForegroundColor Red
}

Read-Host "Presiona Enter para cerrar"
