param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "GongkaoCoach"),
    [switch]$SkipCodex,
    [switch]$NoOpen,
    [switch]$NoShortcut,
    [string]$CodexPath
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$packageRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$manifestPath = Join-Path $packageRoot "release-manifest.json"
$manifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ($manifest.platform -ne "windows-x64" -or -not [Environment]::Is64BitOperatingSystem) { throw "This package requires Windows x64." }
function Get-PackageHash([string]$Path) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace("-", "").ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
}
function Test-PackageFiles([string]$Root) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    foreach ($item in $manifest.files.PSObject.Properties) {
        $file = [IO.Path]::GetFullPath((Join-Path $Root $item.Name))
        if (-not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Invalid package path." }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing package file: $($item.Name)" }
        if ((Get-PackageHash $file) -ne $item.Value) { throw "Package checksum mismatch: $($item.Name)" }
    }
}
Test-PackageFiles $packageRoot
$installBase = [IO.Path]::GetFullPath($InstallRoot)
if ($installBase -eq $packageRoot -or $installBase.StartsWith($packageRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Install outside the extracted package directory." }
$releaseHash = Get-PackageHash $manifestPath
$target = Join-Path $installBase ("packages\" + $manifest.version + "-" + $releaseHash.Substring(0,12))
$runtimeSource = Join-Path $packageRoot "plugins\gongkao-coach\runtime\node.exe"
$managerSource = Join-Path $packageRoot "plugins\gongkao-coach\server\manage-service.js"
& $runtimeSource $managerSource --stop --backup
if ($LASTEXITCODE -ne 0) { throw "Could not prepare upgrade; existing data retained." }
if (Test-Path -LiteralPath (Join-Path $target "release-manifest.json")) {
    try { Test-PackageFiles $target; $reuse = $true }
    catch { $target = $target + "-repair-" + [guid]::NewGuid().ToString("N"); $reuse = $false }
} else { $reuse = $false }
if (-not $reuse) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($entry in (Get-ChildItem -LiteralPath $packageRoot -Force)) { Copy-Item -LiteralPath $entry.FullName -Destination $target -Recurse -Force }
}
Test-PackageFiles $target
$currentFile = Join-Path $installBase "current.json"
$currentTemp = Join-Path $installBase ("current-" + [guid]::NewGuid().ToString("N") + ".tmp")
[IO.File]::WriteAllText($currentTemp, (@{ version=$manifest.version; package=$target; release=$releaseHash } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $currentTemp -Destination $currentFile -Force
Copy-Item -LiteralPath (Join-Path $packageRoot "launch.ps1") -Destination (Join-Path $installBase "launch.ps1") -Force
$catalog = [IO.File]::ReadAllText((Join-Path $packageRoot ".agents\plugins\marketplace.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$relativePlugin = "packages/" + (Split-Path -Leaf $target) + "/plugins/gongkao-coach"
$catalog.plugins[0].source.path = "./" + $relativePlugin
$catalogDir = Join-Path $installBase ".agents\plugins"
New-Item -ItemType Directory -Path $catalogDir -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $catalogDir "marketplace.json"), ($catalog | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
if (-not $SkipCodex) {
    if (-not $CodexPath) {
        $found = Get-Command codex -ErrorAction SilentlyContinue
        if ($found) { $CodexPath = $found.Source }
        else {
            $cliFolder = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
            $candidate = Get-ChildItem -LiteralPath $cliFolder -Filter codex.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($candidate) { $CodexPath = $candidate.FullName }
        }
    }
    if ($CodexPath) {
        & $CodexPath plugin marketplace add $installBase --json
        if ($LASTEXITCODE -ne 0) { throw "Codex marketplace registration failed. Local web is installed." }
        & $CodexPath plugin add gongkao-coach@gongkao-local --json
        if ($LASTEXITCODE -ne 0) { throw "Codex plugin installation failed. Local web is installed." }
        Write-Host "AI plugin installed. Open a new Codex chat and select gongkao-coach."
    } else { Write-Host "Codex was not found. Local web is ready; install Codex Desktop and rerun install.cmd for AI." }
}
if (-not $NoShortcut) {
    $desktop = [Environment]::GetFolderPath("DesktopDirectory")
    if (Test-Path -LiteralPath $desktop) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path $desktop "Gongkao Coach.lnk"))
        $shortcut.TargetPath = "powershell.exe"
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installBase "launch.ps1") + '"'
        $shortcut.WorkingDirectory = $installBase
        $shortcut.WindowStyle = 7
        $shortcut.Description = "Open local exam practice"
        $shortcut.Save()
    }
}
Write-Host "Installed: $target"
Write-Host "Personal data is separate and is retained during upgrades/uninstall."
if (-not $NoOpen) { & (Join-Path $installBase "launch.ps1") }
