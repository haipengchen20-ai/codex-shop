@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 18 or later from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 7897 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  set "NODE_USE_ENV_PROXY=1"
  set "HTTPS_PROXY=http://127.0.0.1:7897"
  echo Using the local proxy at 127.0.0.1:7897 for Steam.
)

start "" http://localhost:3210
echo Steam Image Keeper is running.
echo Keep this window open while using the website.
echo.
node server.js
echo.
echo The server stopped. Press any key to close this window.
pause >nul
