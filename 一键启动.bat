@echo off
setlocal

set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-launcher.ps1"

if errorlevel 1 (
  echo.
  echo 启动失败，请查看上面的错误信息。
  pause
)
