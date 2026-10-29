@echo off
setlocal
cd /d "%~dp0"

if not exist "data\logs" mkdir "data\logs"

start "" /b cmd /c call "%~dp0StartSteamImageKeeper.cmd"
call npm run sync:daily >> "data\logs\daily-sync-console.log" 2>&1

endlocal
