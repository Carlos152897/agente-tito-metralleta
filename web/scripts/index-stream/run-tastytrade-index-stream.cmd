@echo off
REM Lanzador del streamer de FLUJO de SPY/QQQ (Tastytrade) — fuente primaria
REM de Agente ODTE para esos dos tickers. Escribe data\0dte\{SPY,QQQ}-<fecha>.json
REM (mismo archivo que ya lee /api/0dte/flow y lib/zerodte.ts).

set "WEB=C:\Users\carlo\Projects\visionary-trades\web"
set "NODE=C:\Program Files\nodejs\node.exe"
cd /d "%WEB%"
if not exist "%WEB%\logs" mkdir "%WEB%\logs"

:waitnet
"%NODE%" -e "require('dns').lookup('api.tastytrade.com',function(e){process.exit(e?1:0)})" >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] esperando red/DNS... >> "%WEB%\logs\index-stream.log"
  timeout /t 10 /nobreak >nul
  goto waitnet
)

:run
echo [%date% %time%] arrancando streamer indice/ETF (SPY,QQQ) >> "%WEB%\logs\index-stream.log"
"%NODE%" streamer\tastytrade-index-stream.mjs >> "%WEB%\logs\index-stream.log" 2>&1
echo [%date% %time%] el streamer salio (code %errorlevel%); reintento en 15s >> "%WEB%\logs\index-stream.log"
timeout /t 15 /nobreak >nul
goto run
