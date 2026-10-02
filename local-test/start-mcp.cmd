@echo off
setlocal
cd /d "%~dp0\..\plugin-ui"

set "BANK=%~dp0\..\local-data\gongkao-question-bank.jsonl"
if exist "%BANK%" (
  set "QUESTION_BANK_PATH=%BANK%"
  echo Using question bank: %BANK%
) else (
  echo No generated question bank found.
  echo Run local-test\prepare-local-runtime.cmd first if you want bank-backed questions.
)

echo Starting Gongkao MCP at http://localhost:8787/mcp
echo Press Ctrl+C to stop.
node server.js
