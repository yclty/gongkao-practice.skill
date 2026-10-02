@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

echo [1/4] Installing MCP runtime dependencies...
pushd plugin-ui
call npm install
if errorlevel 1 (
  echo npm install failed.
  popd
  exit /b 1
)
popd

set "SOURCE="

if not "%GONGKAO_SOURCE%"=="" (
  if exist "%GONGKAO_SOURCE%\papers" (
    set "SOURCE=%GONGKAO_SOURCE%"
  )
)

if "%SOURCE%"=="" (
  if exist "..\gongkao\tools\saduck-scraper\saduck-tiku-json\papers" (
    set "SOURCE=..\gongkao\tools\saduck-scraper\saduck-tiku-json"
  )
)

if "%SOURCE%"=="" (
  if exist ".runtime\gongkao-source\tools\saduck-scraper\saduck-tiku-json\papers" (
    set "SOURCE=.runtime\gongkao-source\tools\saduck-scraper\saduck-tiku-json"
  )
)

if "%SOURCE%"=="" (
  echo [2/4] Local question-bank source not found. Fetching yclty/gongkao...
  where git >nul 2>nul
  if errorlevel 1 (
    echo Git is not installed or not on PATH.
    echo You can set GONGKAO_SOURCE to an existing saduck-tiku-json folder and rerun.
    exit /b 1
  )

  if not exist ".runtime" mkdir ".runtime"

  git clone --depth 1 --filter=blob:none --sparse https://github.com/yclty/gongkao.git ".runtime\gongkao-source"
  if errorlevel 1 (
    echo Failed to clone yclty/gongkao.
    exit /b 1
  )

  pushd ".runtime\gongkao-source"
  git sparse-checkout set tools/saduck-scraper/saduck-tiku-json
  if errorlevel 1 (
    echo Failed to sparse-checkout the question-bank snapshot.
    popd
    exit /b 1
  )
  popd

  set "SOURCE=.runtime\gongkao-source\tools\saduck-scraper\saduck-tiku-json"
) else (
  echo [2/4] Found question-bank source: %SOURCE%
)

echo [3/4] Importing canonical question bank...
if not exist "local-data" mkdir "local-data"
python scripts\import_gongkao_repository.py ^
  --source "%SOURCE%" ^
  --output "local-data\gongkao-question-bank.jsonl" ^
  --meta "local-data\gongkao-question-bank.meta.json"
if errorlevel 1 (
  echo Question bank import failed.
  exit /b 1
)

echo [4/4] Checking generated bank...
python -c "import json; p='local-data/gongkao-question-bank.meta.json'; d=json.load(open(p,encoding='utf-8')); print('Canonical questions:',d.get('canonical_unique_questions')); print('Interactive questions:',d.get('interactive_supported')); print('Import errors:',d.get('error_count'))"
if errorlevel 1 (
  echo Failed to read generated bank metadata.
  exit /b 1
)

echo.
echo Local runtime is ready.
echo The question bank is now generated at:
echo   local-data\gongkao-question-bank.jsonl
echo.
echo Next:
echo   local-test\start-mcp.cmd
echo   local-test\open-mcp-inspector.cmd
pause
