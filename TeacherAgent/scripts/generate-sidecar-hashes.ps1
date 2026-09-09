# Generate sidecar SHA-256 hash manifest for release builds.
#
# Pipeline position: AFTER sidecar binaries are built/signed, BEFORE tauri build.
#
#   1. Build/sign sidecars → src-tauri/binaries/
#   2. Run this script → writes src-tauri/sidecar-hashes.json (authoritative source)
#   3. npm run tauri build → bundles the manifest into the installer
#   4. Post-build: verify target/release copy matches source (release-check.ps1)
#
# The authoritative manifest lives at src-tauri/sidecar-hashes.json and is
# committed to the repo. It is declared in tauri.conf.json bundle.resources
# so it gets installed alongside the exe and sidecars.
#
# Usage: .\scripts\generate-sidecar-hashes.ps1

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$binariesDir = Join-Path $projectRoot "src-tauri/binaries"
$outputPath = Join-Path $projectRoot "src-tauri/sidecar-hashes.json"
$developmentManifestPath = Join-Path $binariesDir "sidecar-hashes.json"

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha256.ComputeHash($stream)
        return [System.BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

Write-Host "=== Sidecar Hash Manifest Generator ===" -ForegroundColor Cyan
Write-Host "Source: $binariesDir"
Write-Host "Output: $outputPath"
Write-Host ""

# Source binaries use triple-suffix names; manifest keys use runtime short names.
$sidecarMapping = @{
    "code-worker-x86_64-pc-windows-msvc.exe"     = "code-worker.exe"
    "document-worker-x86_64-pc-windows-msvc.exe" = "document-worker.exe"
}

$manifest = @{}
$missing = @()

foreach ($entry in $sidecarMapping.GetEnumerator()) {
    $srcName = $entry.Key
    $runtimeName = $entry.Value
    $path = Join-Path $binariesDir $srcName
    if (Test-Path $path) {
        $hash = Get-Sha256Hex -Path $path
        $manifest[$runtimeName] = $hash
        Write-Host "  [OK] $srcName -> $runtimeName" -ForegroundColor Green
        Write-Host "       SHA-256: $hash"
    } else {
        $missing += $srcName
        Write-Host "  [MISSING] $srcName" -ForegroundColor Red
    }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "ERROR: $($missing.Count) sidecar(s) not found in $binariesDir" -ForegroundColor Red
    Write-Host "Build sidecars first, then re-run this script." -ForegroundColor Red
    exit 1
}

# Write the authoritative bundled manifest and its colocated development copy.
# Runtime verification always finds a manifest beside the resolved executable.
$manifestJson = $manifest | ConvertTo-Json
$manifestJson | Set-Content -Path $outputPath -Encoding UTF8
$manifestJson | Set-Content -Path $developmentManifestPath -Encoding UTF8
Write-Host ""
Write-Host "Manifest written to: $outputPath" -ForegroundColor Green
Write-Host "Development manifest written to: $developmentManifestPath" -ForegroundColor Green
Write-Host "Entries: $($manifest.Count)"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. git add src-tauri/sidecar-hashes.json && git commit"
Write-Host "  2. npm run tauri build"
Write-Host "  3. .\scripts\release-check.ps1  (verifies target matches source)"
