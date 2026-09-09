# copy-sidecar.ps1 — 复制 code-worker.exe 到 Tauri sidecar 目录
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$src = "dist\code-worker.exe"
$destDir = "..\..\src-tauri\binaries"
$destTriple = "$destDir\code-worker-x86_64-pc-windows-msvc.exe"
$destShort = "$destDir\code-worker.exe"

if (!(Test-Path $src)) {
    Write-Error "Source not found: $src. Run build.ps1 first."
    exit 1
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item $src $destTriple -Force
Copy-Item $src $destShort -Force

Write-Host "Copied to:" -ForegroundColor Green
Write-Host "  $destTriple"
Write-Host "  $destShort"
