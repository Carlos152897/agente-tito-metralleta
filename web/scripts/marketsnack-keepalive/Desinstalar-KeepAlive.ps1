# Quita la tarea programada del keep-alive de MarketSnack.

$TaskName = "VisionaryTrades-MarketSnackKeepAlive"

schtasks /Delete /TN $TaskName /F

if ($LASTEXITCODE -eq 0) {
    Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Green
} else {
    Write-Host "No se pudo eliminar (¿ya estaba desinstalada?). Codigo $LASTEXITCODE." -ForegroundColor Yellow
}

Read-Host "Presiona Enter para cerrar"
