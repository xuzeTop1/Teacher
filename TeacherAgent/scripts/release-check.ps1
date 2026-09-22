# TeacherAgent Release Check Script
# 在构建安装包前后执行，验证发布产物安全性。
# 用法: .\scripts\release-check.ps1

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$failures = @()
$warnings = @()

Write-Host "=== TeacherAgent Release Check ===" -ForegroundColor Cyan
Write-Host ""

# 1. 确认 dist 中无 .map 文件
Write-Host "[1/8] Checking for .map files in dist..." -ForegroundColor Yellow
$mapFiles = Get-ChildItem -Path (Join-Path $projectRoot "dist") -Recurse -Filter "*.map" -ErrorAction SilentlyContinue
if ($mapFiles) {
    $failures += "FAIL: Found $($mapFiles.Count) .map file(s) in dist/"
    $mapFiles | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
} else {
    Write-Host "  PASS: No .map files in dist/" -ForegroundColor Green
}

# 2. 产物泄漏扫描：凭据形态 + 构建机绝对路径（由 scan_artifact_leakage.py 承担）
Write-Host "[2/8] Scanning shipped artifacts for secrets and build-machine paths..." -ForegroundColor Yellow
$scanner = Join-Path $projectRoot "scripts/scan_artifact_leakage.py"
$releaseExe = Join-Path $projectRoot "src-tauri/target/release/teacher-agent.exe"
if (-not (Test-Path $scanner)) {
    $failures += "FAIL: scripts/scan_artifact_leakage.py is missing"
} else {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $scanOut = & python $scanner
    $scanExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    $scanOut | ForEach-Object { Write-Host "  $_" }
    if ($scanExit -eq 0) {
        Write-Host "  PASS: artifacts clean" -ForegroundColor Green
    } elseif ($scanExit -eq 2 -and -not (Test-Path $releaseExe)) {
        # Pre-build run: nothing to scan yet. Not a failure, but say so out loud.
        $warnings += "WARN: release binaries not built yet - leakage scan skipped (run again after 'tauri build')"
        Write-Host "  SKIP: release binaries not built yet" -ForegroundColor Yellow
    } else {
        $failures += "FAIL: artifact leakage scan reported findings or could not run (exit $scanExit)"
    }
}

# 3. 确认 tauri.conf.json CSP 不为 null
Write-Host "[3/8] Checking Tauri CSP configuration..." -ForegroundColor Yellow
$tauriConf = Join-Path $projectRoot "src-tauri/tauri.conf.json"
if (Test-Path $tauriConf) {
    $conf = Get-Content $tauriConf -Raw | ConvertFrom-Json
    $csp = $conf.app.security.csp
    if ($null -eq $csp -or $csp -eq "null" -or $csp -eq "") {
        $failures += "FAIL: CSP is null/empty in tauri.conf.json"
    } elseif ($csp -match "default-src\s+\*" -or $csp -match "script-src\s+\*") {
        $failures += "FAIL: CSP contains wildcard (default-src * or script-src *)"
    } else {
        Write-Host "  PASS: CSP is set and not wildcard" -ForegroundColor Green
    }
} else {
    $failures += "FAIL: tauri.conf.json not found"
}

# 4. 确认 Cargo.toml 有 release profile
Write-Host "[4/8] Checking Rust release profile..." -ForegroundColor Yellow
$cargoToml = Join-Path $projectRoot "src-tauri/Cargo.toml"
if (Test-Path $cargoToml) {
    $cargoContent = Get-Content $cargoToml -Raw
    if ($cargoContent -match "\[profile\.release\]") {
        if ($cargoContent -match "lto\s*=\s*true" -and $cargoContent -match "strip") {
            Write-Host "  PASS: Release profile with LTO and strip configured" -ForegroundColor Green
        } else {
            $warnings += "WARN: Release profile exists but missing lto/strip"
        }
    } else {
        $failures += "FAIL: No [profile.release] in Cargo.toml"
    }
} else {
    $failures += "FAIL: Cargo.toml not found"
}

# 5. 确认 capabilities 最小授权
Write-Host "[5/8] Checking Tauri capabilities..." -ForegroundColor Yellow
$capFile = Join-Path $projectRoot "src-tauri/capabilities/default.json"
if (Test-Path $capFile) {
    $cap = Get-Content $capFile -Raw | ConvertFrom-Json
    $perms = $cap.permissions
    if ($perms -contains "core:default" -and $perms.Count -le 3) {
        Write-Host "  PASS: Capabilities minimal ($($perms.Count) permission(s))" -ForegroundColor Green
    } else {
        $warnings += "WARN: Capabilities may be over-permissioned ($($perms.Count) permissions)"
    }
} else {
    $failures += "FAIL: capabilities/default.json not found"
}

# 6. 确认 sidecar 实际文件存在
Write-Host "[6/8] Checking sidecar binaries exist..." -ForegroundColor Yellow
$releaseDir = Join-Path $projectRoot "src-tauri/target/release"
$sidecarNames = @("code-worker.exe", "document-worker.exe")
$sidecarsMissing = @()
foreach ($name in $sidecarNames) {
    $path = Join-Path $releaseDir $name
    if (-not (Test-Path $path)) {
        $sidecarsMissing += $name
    }
}
if ($sidecarsMissing.Count -gt 0) {
    $failures += "FAIL: Sidecar binaries missing: $($sidecarsMissing -join ', '). Run 'npm run tauri build' first."
} else {
    Write-Host "  PASS: Both sidecar binaries exist in target/release" -ForegroundColor Green
}

# 7. 确认 sidecar-hashes.json 存在、可解析、条目完整、哈希一致
Write-Host "[7/8] Checking sidecar integrity manifest..." -ForegroundColor Yellow
$manifestPath = Join-Path $releaseDir "sidecar-hashes.json"
if (-not (Test-Path $manifestPath)) {
    $failures += "FAIL: sidecar-hashes.json not found. Run scripts/generate-sidecar-hashes.ps1 after build."
} else {
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $manifestEntries = ($manifest.PSObject.Properties | Measure-Object).Count
        if ($manifestEntries -ne 2) {
            $failures += "FAIL: sidecar-hashes.json has $manifestEntries entries, expected 2"
        } else {
            # Verify hashes match actual files
            $hashMismatch = @()
            foreach ($prop in $manifest.PSObject.Properties) {
                $filePath = Join-Path $releaseDir $prop.Name
                if (Test-Path $filePath) {
                    $actualHash = (Get-FileHash -Path $filePath -Algorithm SHA256).Hash.ToLower()
                    if ($actualHash -ne $prop.Value) {
                        $hashMismatch += "$($prop.Name): expected $($prop.Value.Substring(0,12))... got $($actualHash.Substring(0,12))..."
                    }
                } else {
                    $hashMismatch += "$($prop.Name): file not found"
                }
            }
            if ($hashMismatch.Count -gt 0) {
                $failures += "FAIL: Sidecar hash mismatch"
                $hashMismatch | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
            } else {
                Write-Host "  PASS: Manifest valid, 2 entries, hashes match" -ForegroundColor Green
            }
            # Verify source manifest (committed, bundled) matches target/release copy
            $sourceManifestPath = Join-Path $projectRoot "src-tauri/sidecar-hashes.json"
            if (Test-Path $sourceManifestPath) {
                $sourceRaw = (Get-Content $sourceManifestPath -Raw).Trim()
                $targetRaw = (Get-Content $manifestPath -Raw).Trim()
                if ($sourceRaw -ne $targetRaw) {
                    $failures += "FAIL: Source manifest (src-tauri/) differs from target/release copy. Re-run generate-sidecar-hashes.ps1 and rebuild."
                } else {
                    Write-Host "  PASS: Source manifest matches target/release copy" -ForegroundColor Green
                }
            } else {
                $failures += "FAIL: Source manifest src-tauri/sidecar-hashes.json not found (must be committed)"
            }
        }
    } catch {
        $failures += "FAIL: sidecar-hashes.json is not valid JSON: $_"
    }
}

# 8. 确认 Cargo.lock 已提交（可复现构建）
Write-Host "[8/8] Checking Cargo.lock is committed..." -ForegroundColor Yellow
$cargoLock = Join-Path $projectRoot "src-tauri/Cargo.lock"
if (Test-Path $cargoLock) {
    $lockStatus = git -C $projectRoot status --porcelain -- src-tauri/Cargo.lock 2>$null
    if ($lockStatus) {
        $failures += "FAIL: Cargo.lock has uncommitted changes (not reproducible)"
    } else {
        Write-Host "  PASS: Cargo.lock is committed" -ForegroundColor Green
    }
} else {
    $failures += "FAIL: Cargo.lock not found"
}

# Summary
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
if ($warnings.Count -gt 0) {
    $warnings | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}
if ($failures.Count -eq 0) {
    Write-Host "All checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($failures.Count) failure(s):" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}
