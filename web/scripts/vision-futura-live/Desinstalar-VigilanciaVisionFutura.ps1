# Quita la tarea "VisionaryTrades-VisionFuturaLive" (vigilancia en vivo de VisionFutura).
param([switch]$NoPause)
$TaskName = "VisionaryTrades-VisionFuturaLive"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Tarea '$TaskName' quitada." -ForegroundColor Green
if (-not $NoPause) { Read-Host "Presiona Enter para cerrar" }
