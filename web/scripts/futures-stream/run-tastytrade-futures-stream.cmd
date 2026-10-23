@echo off
REM Lanzador del streamer de futuros nativos ES/NQ (Tastytrade) — fuente
REM primaria de Agente ODTE para /ES y /NQ. Escribe
REM data\tastytrade-fut\{ES,NQ}-<fecha>.json.

set "WEB=C:\Users\carlo\Projects\visionary-trades\web"
set "NODE=C:\Program Files\nodejs\node.exe"
cd /d "%WEB%"
if not exist "%WEB%\logs" mkdir "%WEB%\logs"

:waitnet
"%NODE%" -e "require('dns').lookup('api.tastytrade.com',function(e){process.exit(e?1:0)})" >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] esperando red/DNS... >> "%WEB%\logs\futures-stream.log"
  timeout /t 10 /nobreak >nul
  goto waitnet
)

:run
echo [%date% %time%] arrancando streamer futuros nativos (ES,NQ) >> "%WEB%\logs\futures-stream.log"
"%NODE%" streamer\tastytrade-futures-stream.mjs >> "%WEB%\logs\futures-stream.log" 2>&1
echo [%date% %time%] el streamer salio (code %errorlevel%); reintento en 15s >> "%WEB%\logs\futures-stream.log"
timeout /t 15 /nobreak >nul
goto run
