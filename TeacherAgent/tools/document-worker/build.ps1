# build.ps1 - PyInstaller packaging for document-worker.exe
#
# Usage:
#   cd tools/document-worker
#   .\build.ps1
#
# Prerequisites:
#   - Python 3.10+ in PATH
#   - Dependencies installed: pip install -e ".[dev]"
#
# Output:
#   dist/document-worker.exe

$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    Write-Host "=== Document Worker PyInstaller Build ===" -ForegroundColor Cyan

    # 1. Check Python
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        Write-Error "Python not found. Please ensure Python 3.10+ is in PATH."
        exit 1
    }
    $pyVersion = python --version 2>&1
    Write-Host "Python: $pyVersion"

    # 2. Check/Install PyInstaller
    $hasPyInstaller = python -c "import PyInstaller" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing PyInstaller..." -ForegroundColor Yellow
        pip install pyinstaller
        if ($LASTEXITCODE -ne 0) {
            Write-Error "PyInstaller installation failed."
            exit 1
        }
    } else {
        Write-Host "PyInstaller is installed."
    }

    # 3. Check document_worker module is importable
    $canImport = python -c "import document_worker" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing document_worker dependencies..." -ForegroundColor Yellow
        pip install -e "."
        if ($LASTEXITCODE -ne 0) {
            Write-Error "document_worker dependency installation failed."
            exit 1
        }
    }

    # 4. Clean old artifacts
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
    }
    if (Test-Path "build") {
        Remove-Item -Recurse -Force "build"
    }
    $specFile = "document-worker.spec"
    if (Test-Path $specFile) {
        Remove-Item -Force $specFile
    }

    # 5. PyInstaller build
    Write-Host "Building with PyInstaller..." -ForegroundColor Yellow
    pyinstaller `
        --onefile `
        --name document-worker `
        --console `
        --noconfirm `
        --paths . `
        build_entry.py

    if ($LASTEXITCODE -ne 0) {
        Write-Error "PyInstaller build failed."
        exit 1
    }

    # 6. Verify artifact
    $exePath = "dist/document-worker.exe"
    if (-not (Test-Path $exePath)) {
        Write-Error "Build artifact not found: $exePath"
        exit 1
    }

    $size = (Get-Item $exePath).Length / 1MB
    $sizeStr = [math]::Round($size, 1)
    Write-Host "Build succeeded: $exePath ($sizeStr MB)" -ForegroundColor Green

    # 7. Basic executability test
    Write-Host "Testing exe executability..." -ForegroundColor Yellow
    $testResult = & $exePath math --expr "x**2" --op simplify 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Exe runs OK. Output: $testResult" -ForegroundColor Green
    } else {
        Write-Warning "Exe test returned non-zero exit code, artifact may be broken. Output: $testResult"
    }

    Write-Host ""
    Write-Host "=== Done ===" -ForegroundColor Cyan
    Write-Host "Artifact: tools/document-worker/dist/document-worker.exe"
    Write-Host "Next: run .\copy-sidecar.ps1 to copy exe to Tauri sidecar directory"
} finally {
    Pop-Location
}
