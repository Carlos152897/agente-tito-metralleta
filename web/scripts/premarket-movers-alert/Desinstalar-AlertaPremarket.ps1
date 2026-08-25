# Quita las tareas programadas de la alerta de pre-market (8:15 y 8:30).

$TaskNames = "VisionaryTrades-PremarketMoversAlert", "VisionaryTrades-PremarketMoversAlert-0830"

foreach ($TaskName in $TaskNames) {
    schtasks /Delete /TN $TaskName /F
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Green
    } else {
        Write-Host "No se pudo eliminar '$TaskName' (¿ya estaba desinstalada?). Codigo $LASTEXITCODE." -ForegroundColor Yellow
    }
}

Read-Host "Presiona Enter para cerrar"
