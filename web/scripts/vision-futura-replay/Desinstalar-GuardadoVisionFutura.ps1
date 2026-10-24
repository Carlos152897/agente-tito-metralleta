# Quita la tarea "VisionaryTrades-VisionFuturaReplay" (guardado diario de VisionFutura).
# No borra nada de lo ya guardado en data/vision-futura.
param([switch]$NoPause)
$TaskName = "VisionaryTrades-VisionFuturaReplay"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Tarea '$TaskName' desinstalada (si existia)." -ForegroundColor Yellow
if (-not $NoPause) { Read-Host "Presiona Enter para cerrar" }
