@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

if not exist "local-data\gongkao-question-bank.jsonl" (
  echo Local question bank not found.
  echo Running prepare-local-runtime first...
  call "local-test\prepare-local-runtime.cmd"
  if errorlevel 1 exit /b 1
)

set "OUT=dist\gongkao-coach-offline"
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"
mkdir "%OUT%\local-data"

xcopy /E /I /Y "plugins\gongkao-coach" "%OUT%\plugins\gongkao-coach" >nul
xcopy /E /I /Y "plugin-ui" "%OUT%\plugin-ui" >nul
xcopy /E /I /Y "local-test" "%OUT%\local-test" >nul
copy /Y "local-data\gongkao-question-bank.jsonl" "%OUT%\local-data\gongkao-question-bank.jsonl" >nul
copy /Y "local-data\gongkao-question-bank.meta.json" "%OUT%\local-data\gongkao-question-bank.meta.json" >nul
copy /Y "LOCAL_TEST_START_HERE.md" "%OUT%\START_HERE.md" >nul
copy /Y "LICENSE" "%OUT%\LICENSE" >nul

powershell -NoProfile -Command "$p='dist\gongkao-coach-offline.zip'; if(Test-Path $p){Remove-Item $p -Force}; Compress-Archive -Path 'dist\gongkao-coach-offline\*' -DestinationPath $p -Force"
if errorlevel 1 (
  echo Failed to create offline ZIP.
  exit /b 1
)

echo.
echo Offline package created:
echo   dist\gongkao-coach-offline.zip
echo.
echo This package includes the generated canonical question bank.
pause
