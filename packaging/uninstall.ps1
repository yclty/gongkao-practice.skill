$ErrorActionPreference = "Stop"
$cli = Get-Command codex -ErrorAction SilentlyContinue
if (-not $cli) {
    $cli = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin") -Filter codex.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if ($cli) {
    $cliPath = if ($cli.Source) { $cli.Source } else { $cli.FullName }
    & $cliPath plugin remove gongkao-coach@gongkao-local --json
}
$nodePath = Join-Path $PSScriptRoot "plugins\gongkao-coach\runtime\node.exe"
if (Test-Path -LiteralPath $nodePath) { & $nodePath (Join-Path $PSScriptRoot "plugins\gongkao-coach\server\manage-service.js") --stop --backup }
Write-Host "Plugin disconnected. Public files and all personal records are retained."
