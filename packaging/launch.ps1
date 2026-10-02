$ErrorActionPreference = "Stop"
$currentPath = Join-Path $PSScriptRoot "current.json"
if (-not (Test-Path -LiteralPath $currentPath)) { throw "Run install.cmd first, or use open-learning.cmd inside the extracted package." }
$current = [IO.File]::ReadAllText($currentPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$nodePath = Join-Path $current.package "plugins\gongkao-coach\runtime\node.exe"
$entryPath = Join-Path $current.package "plugins\gongkao-coach\server\ensure-service.js"
& $nodePath $entryPath --open
if ($LASTEXITCODE -ne 0) { throw "Could not open the local learning service." }
