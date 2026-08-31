# Quita la tarea programada de la alerta en vivo del GEX Ticket (0DTE).

$TaskName = "VisionaryTrades-OdteTicketAlert"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if ($?) {
    Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Green
} else {
    Write-Host "No se pudo eliminar (¿ya estaba desinstalada?)." -ForegroundColor Yellow
}

Read-Host "Presiona Enter para cerrar"
