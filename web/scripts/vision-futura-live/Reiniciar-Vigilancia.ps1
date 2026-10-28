# Reinicia la vigilancia en vivo de VisionFutura con el código nuevo, SIN dejar procesos viejos.
# (Stop-ScheduledTask solo cierra el cmd: el proceso de node/tsx que vigila sigue vivo. 28-oct-2026
# quedaron 3 vigilancias a la vez y se borró el estado de NQ.)
# Uso: powershell -ExecutionPolicy Bypass -File Reiniciar-Vigilancia.ps1

$task = "VisionaryTrades-VisionFuturaLive"
Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
$old = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vision-futura-live[\\/]+poll\.ts' }
foreach ($p in $old) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; "cerrado proceso viejo $($p.ProcessId)" } catch {}
}
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $task
"vigilancia reiniciada"
