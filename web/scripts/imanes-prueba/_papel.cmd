@echo off
rem Tarea "VisionaryTrades-ImanesPruebaPapel" (L-V 8:30 pm): pruebas en papel, aparte de VisionFutura.
cd /d "C:\Users\carlo\Projects\visionary-trades\web"
call "C:\Users\carlo\Projects\visionary-trades\web\node_modules\.bin\tsx.cmd" "C:\Users\carlo\Projects\visionary-trades\web\scripts\imanes-prueba\papel.ts"
call "C:\Users\carlo\Projects\visionary-trades\web\node_modules\.bin\tsx.cmd" "C:\Users\carlo\Projects\visionary-trades\web\scripts\gamma-squeeze-prueba\papel.ts"
