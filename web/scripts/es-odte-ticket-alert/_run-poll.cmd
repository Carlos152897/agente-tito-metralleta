@echo off
cd /d "C:\Users\carlo\Projects\visionary-trades\web"
set TSX="C:\Users\carlo\Projects\visionary-trades\web\node_modules\.bin\tsx.cmd"
set SCRIPT="C:\Users\carlo\Projects\visionary-trades\web\scripts\odte-ticket-alert\poll.ts"
call %TSX% %SCRIPT% /ES
