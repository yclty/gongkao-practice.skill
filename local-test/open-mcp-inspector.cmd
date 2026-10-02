@echo off
setlocal
cd /d "%~dp0\.."
echo Opening MCP Inspector...
echo Connect to: http://localhost:8787/mcp
npx @modelcontextprotocol/inspector@latest
