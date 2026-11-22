@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "apps\desktop\node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run npm.cmd install first.
  exit /b 1
)

echo Repairing Electron Windows sandbox permissions...
icacls.exe "%CD%\apps\desktop\node_modules\electron\dist" /grant "*S-1-15-2-1:(OI)(CI)(RX)" /T

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm.cmd was not found on PATH. Install Node.js, then run this file again.
  exit /b 1
)

if not exist "apps\desktop\dist\index.html" (
  echo Building the Skai renderer...
  call npm.cmd run desktop:build
  if errorlevel 1 exit /b %errorlevel%
)

echo Starting Skai Desktop...
call npm.cmd run open:desktop
exit /b %errorlevel%
