# copy-sidecar.ps1 - Copy PyInstaller artifact to Tauri sidecar directory
#
# Usage:
#   cd tools/document-worker
#   .\copy-sidecar.ps1
#
# Prerequisites:
#   - .\build.ps1 has been run and dist/document-worker.exe exists
#
# Output:
#   src-tauri/binaries/document-worker-x86_64-pc-windows-msvc.exe

$ErrorActionPreference = "Stop"

$targetTriple = "x86_64-pc-windows-msvc"
$sourcePath = Join-Path $PSScriptRoot "dist\document-worker.exe"
# $PSScriptRoot is tools/document-worker, so go up two levels to repo root
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$destDir = Join-Path $repoRoot "src-tauri\binaries"
$destPath = Join-Path $destDir "document-worker-$targetTriple.exe"

# Safety check: ensure destDir is under src-tauri\binaries
$normalizedDest = [System.IO.Path]::GetFullPath($destDir)
if (-not $normalizedDest.EndsWith("src-tauri\binaries")) {
    Write-Error "Unexpected destination path: $destDir - expected src-tauri\binaries under repo root."
    exit 1
}

Write-Host "=== Copy document-worker.exe to Tauri sidecar directory ===" -ForegroundColor Cyan

# Check source
if (-not (Test-Path $sourcePath)) {
    Write-Error "Source not found: $sourcePath - Please run .\build.ps1 first."
    exit 1
}

# Create dest directory
if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Write-Host "Created directory: $destDir"
}

# Delete existing file first (handles 0-byte placeholders from ensure-sidecar.ps1)
if (Test-Path $destPath) {
    Remove-Item -Force $destPath
}

# Copy
Copy-Item -Path $sourcePath -Destination $destPath -Force

# Verify size matches source
$sourceSize = (Get-Item $sourcePath).Length
$destSize = (Get-Item $destPath).Length
if ($destSize -ne $sourceSize) {
    Write-Error "Copy verification failed: source=$sourceSize bytes, dest=$destSize bytes"
    exit 1
}

$sizeMB = [math]::Round($destSize / 1MB, 1)
Write-Host "Copied: $destPath ($sizeMB MB)" -ForegroundColor Green

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host "Next: npm run tauri build"
