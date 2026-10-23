# Quita la tarea programada de la alerta de /ES (0DTE, GEX Ticket/Trade/Alterna).

$TaskName = "VisionaryTrades-EsOdteTicketAlert"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if ($?) {
    Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Green
} else {
    Write-Host "No se pudo eliminar (ya estaba desinstalada?)." -ForegroundColor Yellow
}

Read-Host "Presiona Enter para cerrar"
