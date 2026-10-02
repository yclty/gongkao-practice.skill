$ErrorActionPreference = "Stop"

$health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/" -Method Get

if ($health.name -ne "gongkao-quiz") {
    throw "Unexpected MCP health response."
}

Write-Host "MCP health OK"
Write-Host ("Version: " + $health.version)
Write-Host ("Endpoint: http://127.0.0.1:8787" + $health.mcp)
