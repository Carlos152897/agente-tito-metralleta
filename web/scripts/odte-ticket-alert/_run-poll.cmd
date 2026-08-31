@echo off
cd /d "C:\Users\carlo\OneDrive\Desktop\visionary-trades\web"
set TSX="C:\Users\carlo\OneDrive\Desktop\visionary-trades\web\node_modules\.bin\tsx.cmd"
set SCRIPT="C:\Users\carlo\OneDrive\Desktop\visionary-trades\web\scripts\odte-ticket-alert\poll.ts"
call %TSX% %SCRIPT% SPX
