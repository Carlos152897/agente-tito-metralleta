@echo off
REM Lanzador del streamer de "0DTE Live" (contratos entrantes de SPX) de
REM Tastytrade. Escribe data\0dte-stream\SPX-<fecha>.json — NO toca
REM data\0dte\ (eso lo sigue escribiendo /api/0dte/flow con MarketSnack).
REM A prueba de reinicios: espera la red y relanza el streamer si se cae.

set "WEB=C:\Users\carlo\Projects\visionary-trades\web"
set "NODE=C:\Program Files\nodejs\node.exe"
cd /d "%WEB%"
if not exist "%WEB%\logs" mkdir "%WEB%\logs"

:waitnet
"%NODE%" -e "require('dns').lookup('api.tastytrade.com',function(e){process.exit(e?1:0)})" >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] esperando red/DNS... >> "%WEB%\logs\0dte-stream.log"
  timeout /t 10 /nobreak >nul
  goto waitnet
)

:run
echo [%date% %time%] arrancando streamer 0DTE Live (SPX) >> "%WEB%\logs\0dte-stream.log"
"%NODE%" streamer\tastytrade-stream.mjs >> "%WEB%\logs\0dte-stream.log" 2>&1
echo [%date% %time%] el streamer salio (code %errorlevel%); reintento en 15s >> "%WEB%\logs\0dte-stream.log"
timeout /t 15 /nobreak >nul
goto run
