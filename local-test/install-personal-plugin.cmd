@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-personal-plugin.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed.
  pause
  exit /b 1
)
echo.
pause
