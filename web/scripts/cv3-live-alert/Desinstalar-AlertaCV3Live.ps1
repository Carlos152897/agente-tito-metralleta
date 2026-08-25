# Quita la tarea programada de la alerta en vivo de Contratos vecinos 3.0.

$TaskName = "VisionaryTrades-CV3LiveAlert"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if ($?) {
    Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Green
} else {
    Write-Host "No se pudo eliminar (¿ya estaba desinstalada?)." -ForegroundColor Yellow
}

Read-Host "Presiona Enter para cerrar"
