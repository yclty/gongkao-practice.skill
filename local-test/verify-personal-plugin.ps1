$ErrorActionPreference = "Stop"

$marketplaceFile = Join-Path $HOME ".agents\plugins\marketplace.json"
$pluginFile = Join-Path $HOME ".codex\plugins\gongkao-coach\plugin.json"

if (-not (Test-Path $marketplaceFile)) {
    throw "Personal marketplace not found. Run install-personal-plugin.cmd first."
}
if (-not (Test-Path $pluginFile)) {
    throw "gongkao-coach plugin files not found. Run install-personal-plugin.cmd first."
}

$catalog = Get-Content $marketplaceFile -Raw -Encoding UTF8 | ConvertFrom-Json
$plugin = Get-Content $pluginFile -Raw -Encoding UTF8 | ConvertFrom-Json

$entry = @($catalog.plugins | Where-Object { $_.name -eq "gongkao-coach" })
if ($entry.Count -ne 1) {
    throw "Expected exactly one gongkao-coach marketplace entry, found $($entry.Count)."
}
if ($plugin.name -ne "gongkao-coach") {
    throw "Unexpected plugin name: $($plugin.name)"
}

Write-Host "Local plugin installation looks valid."
Write-Host "Marketplace: $($catalog.name)"
Write-Host "Plugin: $($plugin.name) v$($plugin.version)"
Write-Host "Path: $pluginFile"
