@echo off
"%~dp0plugins\gongkao-coach\runtime\node.exe" "%~dp0plugins\gongkao-coach\server\ensure-service.js" --open
if errorlevel 1 pause
