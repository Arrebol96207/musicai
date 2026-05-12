@echo off
setlocal
cd /d "%~dp0"

title Claudio Music

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not detected.
  echo Please install Node.js LTS: https://nodejs.org/
  pause
  exit /b 1
)

if not exist package.json (
  echo This directory does not appear to be a Claudio Music project.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting Claudio Music...
echo The browser will open automatically once the server is ready.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-and-open.ps1"

if errorlevel 1 (
  echo Start failed.
  pause
  exit /b 1
)

endlocal