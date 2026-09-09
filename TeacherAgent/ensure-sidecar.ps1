# ensure-sidecar.ps1 - verify Tauri sidecar exists (fail-fast, no placeholders)
#
# Checks that src-tauri/binaries/document-worker-{triple}.exe exists and is non-empty.
# If missing, prints instructions and exits with error.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File ensure-sidecar.ps1

$ErrorActionPreference = "Stop"

$targetTriple = "x86_64-pc-windows-msvc"
$destDir = Join-Path $PSScriptRoot "src-tauri\binaries"
$destPath = Join-Path $destDir "document-worker-$targetTriple.exe"

if (Test-Path $destPath) {
    $size = (Get-Item $destPath).Length
    if ($size -gt 0) {
        $sizeMB = [math]::Round($size / 1MB, 1)
        Write-Host "Sidecar OK: $destPath ($sizeMB MB)"
        exit 0
    }
    Write-Error "Sidecar file exists but is 0 bytes (broken placeholder): $destPath"
    Write-Host "Run the following to generate a real sidecar:"
    Write-Host "  cd tools/document-worker"
    Write-Host "  .\build.ps1"
    Write-Host "  .\copy-sidecar.ps1"
    exit 1
}

Write-Error "Sidecar not found: $destPath"
Write-Host "Run the following to generate a real sidecar:"
Write-Host "  cd tools/document-worker"
Write-Host "  .\build.ps1"
Write-Host "  .\copy-sidecar.ps1"
exit 1
