$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourcePlugin = Join-Path $repoRoot "plugins\gongkao-coach"

if (-not (Test-Path $sourcePlugin)) {
    throw "Local plugin source not found: $sourcePlugin"
}

$pluginHome = Join-Path $HOME ".codex\plugins"
$targetPlugin = Join-Path $pluginHome "gongkao-coach"
$marketplaceDir = Join-Path $HOME ".agents\plugins"
$marketplaceFile = Join-Path $marketplaceDir "marketplace.json"

New-Item -ItemType Directory -Force -Path $pluginHome | Out-Null
New-Item -ItemType Directory -Force -Path $marketplaceDir | Out-Null

if (Test-Path $targetPlugin) {
    Remove-Item -Recurse -Force $targetPlugin
}
Copy-Item -Recurse -Force $sourcePlugin $targetPlugin

if (Test-Path $marketplaceFile) {
    try {
        $catalog = Get-Content $marketplaceFile -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Existing marketplace.json is not valid JSON: $marketplaceFile"
    }
} else {
    $catalog = [PSCustomObject]@{
        name = "personal-local"
        interface = [PSCustomObject]@{
            displayName = "Personal Local Plugins"
        }
        plugins = @()
    }
}

if (-not $catalog.name) {
    $catalog | Add-Member -NotePropertyName name -NotePropertyValue "personal-local" -Force
}
if (-not $catalog.interface) {
    $catalog | Add-Member -NotePropertyName interface -NotePropertyValue ([PSCustomObject]@{
        displayName = "Personal Local Plugins"
    }) -Force
}
if ($null -eq $catalog.plugins) {
    $catalog | Add-Member -NotePropertyName plugins -NotePropertyValue @() -Force
}

$existing = @($catalog.plugins | Where-Object { $_.name -ne "gongkao-coach" })
$entry = [PSCustomObject]@{
    name = "gongkao-coach"
    source = [PSCustomObject]@{
        source = "local"
        path = "./.codex/plugins/gongkao-coach"
    }
    policy = [PSCustomObject]@{
        installation = "AVAILABLE"
        authentication = "ON_INSTALL"
    }
    category = "Education & Research"
}

$catalog.plugins = @($existing + $entry)
$catalog | ConvertTo-Json -Depth 12 | Set-Content -Path $marketplaceFile -Encoding UTF8

Write-Host ""
Write-Host "Installed local plugin files:"
Write-Host "  $targetPlugin"
Write-Host ""
Write-Host "Updated personal marketplace:"
Write-Host "  $marketplaceFile"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Fully quit ChatGPT Desktop."
Write-Host "  2. Reopen ChatGPT Desktop."
Write-Host "  3. Open Plugins Directory and find 'gongkao-coach'."
Write-Host "  4. Install/enable it."
Write-Host "  5. Create a separate exam-prep Project and say: 初始化我的考公系统"
