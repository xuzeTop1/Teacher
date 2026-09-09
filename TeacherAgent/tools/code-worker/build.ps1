# build.ps1 — PyInstaller 打包 code-worker
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Building code-worker with PyInstaller..." -ForegroundColor Cyan

python -m PyInstaller `
    --onefile `
    --name code-worker `
    --clean `
    --noconfirm `
    build_entry.py

Write-Host "Build complete: dist/code-worker.exe" -ForegroundColor Green
