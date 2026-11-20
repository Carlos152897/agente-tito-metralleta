# Instala la tarea "VisionaryTrades-ImanesPruebaPapel" (Imanes Prueba en papel, aparte de VisionFutura).
# Corre L–V 8:30 pm (hora de la PC), después de la repetición de las 8 pm. Solo lee las repeticiones
# guardadas y escribe su propio Excel en Desktop\VisionFutura Backtest. No toca la app ni las otras tareas.
# Para quitarla: Unregister-ScheduledTask -TaskName "VisionaryTrades-ImanesPruebaPapel" -Confirm:$false

$cmd = "C:\Users\carlo\Projects\visionary-trades\web\scripts\imanes-prueba\_papel.cmd"
$a = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory "C:\Users\carlo\Projects\visionary-trades\web"
$t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "8:30pm"
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName "VisionaryTrades-ImanesPruebaPapel" -Action $a -Trigger $t -Settings $s -Force `
  -Description "Imanes Prueba en papel (aparte de VisionFutura). Solo lee." | Out-Null
$i = Get-ScheduledTaskInfo -TaskName "VisionaryTrades-ImanesPruebaPapel"
Write-Host "Listo. Proxima corrida: $($i.NextRunTime)"
