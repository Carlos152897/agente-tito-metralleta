# Quita la tarea programada del streamer de velas de tastytrade. No mata un
# proceso ya corriendo (si lo arrancaste a mano con "npm run candles:stream",
# cerralo con Ctrl+C aparte) — solo evita que vuelva a arrancar solo.

$TaskName = "VisionaryTrades-TastytradeCandleStreamer"

schtasks /Delete /TN $TaskName /F

if ($LASTEXITCODE -eq 0) {
    Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Green
} else {
    Write-Host "No se pudo eliminar (¿ya estaba desinstalada?). Codigo $LASTEXITCODE." -ForegroundColor Yellow
}

Read-Host "Presiona Enter para cerrar"
