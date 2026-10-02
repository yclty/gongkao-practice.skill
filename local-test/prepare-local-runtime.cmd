@echo off
setlocal
cd /d "%~dp0\.."

echo [1/3] Installing MCP runtime dependencies...
pushd plugin-ui
call npm install
if errorlevel 1 (
  echo npm install failed.
  popd
  exit /b 1
)
popd

if exist "..\gongkao\tools\saduck-scraper\saduck-tiku-json\papers" (
  echo [2/3] Found ..\gongkao. Importing canonical question bank...
  if not exist "local-data" mkdir "local-data"
  python scripts\import_gongkao_repository.py ^
    --source "..\gongkao\tools\saduck-scraper\saduck-tiku-json" ^
    --output "local-data\gongkao-question-bank.jsonl" ^
    --meta "local-data\gongkao-question-bank.meta.json"
  if errorlevel 1 (
    echo Question bank import failed.
    exit /b 1
  )
) else (
  echo [2/3] ..\gongkao question bank not found.
  echo       Skill testing still works. For bank-backed MCP testing, place yclty/gongkao next to this repository.
)

echo [3/3] Local runtime is ready.
echo.
echo Next:
echo   local-test\start-mcp.cmd
echo   local-test\open-mcp-inspector.cmd
pause
