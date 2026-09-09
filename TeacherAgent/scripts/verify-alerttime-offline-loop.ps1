[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AlertTimeRoot,

    [string]$AndroidSdkRoot,

    [string]$RustToolchainBin,

    [switch]$SkipAndroid
)

$ErrorActionPreference = "Stop"
$TeacherRoot = Split-Path -Parent $PSScriptRoot

function Write-Phase {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

function Assert-Path {
    param(
        [string]$Path,
        [string]$Description,
        [ValidateSet("Any", "Leaf", "Container")]
        [string]$Type = "Any"
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing ${Description}: $Path"
    }
    if ($Type -ne "Any" -and -not (Test-Path -LiteralPath $Path -PathType $Type)) {
        throw "${Description} is not a ${Type}: $Path"
    }
}

function Get-CommandPath {
    param([string]$Name)

    $names = @($Name)
    if ($Name -eq "npm") {
        $names = @("npm.cmd", "npm")
    }
    foreach ($candidateName in $names) {
        $command = Get-Command $candidateName -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            if ($command.Path) {
                return $command.Path
            }
            if ($command.Source) {
                return $command.Source
            }
        }
    }
    return $null
}

function Invoke-External {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Write-Host "  $Label" -ForegroundColor Yellow
    Write-Host "    $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray

    $oldLocation = Get-Location
    try {
        Set-Location -LiteralPath $WorkingDirectory
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
    } catch {
        throw "$Label could not start: $($_.Exception.Message)"
    } finally {
        Set-Location -LiteralPath $oldLocation
    }

    if ($null -eq $exitCode) {
        $exitCode = 0
    }
    if ($exitCode -ne 0) {
        throw "$Label failed with exit code $exitCode"
    }
}

function Get-RustToolchainPair {
    param([string]$ExplicitBin)

    if ($ExplicitBin) {
        $bin = [System.IO.Path]::GetFullPath($ExplicitBin)
        Assert-Path $bin "Rust toolchain bin directory"
        $cargo = Join-Path $bin "cargo.exe"
        $rustc = Join-Path $bin "rustc.exe"
        $rustdoc = Join-Path $bin "rustdoc.exe"
        Assert-Path $cargo "cargo.exe in RustToolchainBin" "Leaf"
        Assert-Path $rustc "rustc.exe in RustToolchainBin" "Leaf"
        Assert-Path $rustdoc "rustdoc.exe in RustToolchainBin" "Leaf"
        return @{ Cargo = $cargo; Rustc = $rustc; Rustdoc = $rustdoc; Source = "RustToolchainBin" }
    }

    $cargo = Get-CommandPath "cargo"
    $rustc = Get-CommandPath "rustc"
    $rustdoc = Get-CommandPath "rustdoc"
    if ($cargo -and $rustc -and $rustdoc) {
        $cargoParent = Split-Path -Parent $cargo
        $rustcParent = Split-Path -Parent $rustc
        $rustdocParent = Split-Path -Parent $rustdoc
        if (($cargoParent -eq $rustcParent) -and ($cargoParent -eq $rustdocParent) -and ($cargoParent -match "toolchains")) {
            Assert-Path $cargo "cargo.exe resolved from PATH" "Leaf"
            Assert-Path $rustc "rustc.exe resolved from PATH" "Leaf"
            Assert-Path $rustdoc "rustdoc.exe resolved from PATH" "Leaf"
            return @{ Cargo = $cargo; Rustc = $rustc; Rustdoc = $rustdoc; Source = "PATH toolchain" }
        }
    }

    $rustupRoots = @()
    if ($env:RUSTUP_HOME) {
        $rustupRoots += $env:RUSTUP_HOME
    }
    if ($env:USERPROFILE) {
        $rustupRoots += (Join-Path $env:USERPROFILE ".rustup")
    }
    if ($env:LOCALAPPDATA) {
        $rustupRoots += (Join-Path $env:LOCALAPPDATA "Rustup")
    }

    foreach ($root in ($rustupRoots | Select-Object -Unique)) {
        $toolchains = Join-Path $root "toolchains"
        if (-not (Test-Path -LiteralPath $toolchains)) {
            continue
        }
        foreach ($toolchain in (Get-ChildItem -LiteralPath $toolchains -Directory -ErrorAction SilentlyContinue)) {
            $candidateBin = Join-Path $toolchain.FullName "bin"
            $candidateCargo = Join-Path $candidateBin "cargo.exe"
            $candidateRustc = Join-Path $candidateBin "rustc.exe"
            $candidateRustdoc = Join-Path $candidateBin "rustdoc.exe"
            if ((Test-Path -LiteralPath $candidateCargo) -and (Test-Path -LiteralPath $candidateRustc) -and (Test-Path -LiteralPath $candidateRustdoc)) {
                Write-Host "  PATH cargo/rustc/rustdoc did not resolve to a usable toolchain; using discovered toolchain: $candidateBin" -ForegroundColor Yellow
                return @{ Cargo = $candidateCargo; Rustc = $candidateRustc; Rustdoc = $candidateRustdoc; Source = "discovered rustup toolchain" }
            }
        }
    }

    throw "No usable cargo/rustc/rustdoc toolchain found. Pass -RustToolchainBin <toolchain\bin>; rustup configuration was not changed."
}

function Get-OptionalFileState {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ Exists = $false; Sha256 = $null }
    }
    return [pscustomobject]@{
        Exists = $true
        Sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Assert-OptionalFileStateUnchanged {
    param(
        [string]$Path,
        [pscustomobject]$Before,
        [pscustomobject]$After
    )

    if ($Before.Exists -ne $After.Exists -or $Before.Sha256 -ne $After.Sha256) {
        throw "Android changed local.properties, which is forbidden: $Path"
    }
}

function Invoke-RustSnapshotTests {
    param(
        [hashtable]$Rust,
        [string]$WorkingDirectory,
        [string[]]$Arguments
    )

    $environmentNames = @("RUSTC", "RUSTDOC")
    $previousEnvironment = @{}
    foreach ($name in $environmentNames) {
        $previousEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, "Process")
    }

    try {
        [System.Environment]::SetEnvironmentVariable("RUSTC", $Rust.Rustc, "Process")
        [System.Environment]::SetEnvironmentVariable("RUSTDOC", $Rust.Rustdoc, "Process")
        Invoke-External -Label "Rust snapshot route tests" -FilePath $Rust.Cargo -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    } finally {
        foreach ($name in $environmentNames) {
            [System.Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
        }
    }
}

function Invoke-AndroidJvmReplay {
    param(
        [string]$GradlePath,
        [string]$AndroidRoot
    )

    $environmentNames = @("ANDROID_HOME", "ANDROID_SDK_ROOT")
    $previousEnvironment = @{}
    foreach ($name in $environmentNames) {
        $previousEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, "Process")
    }

    try {
        if ($AndroidRoot) {
            [System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $AndroidRoot, "Process")
            [System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $AndroidRoot, "Process")
        }

        $localProperties = Join-Path (Split-Path -Parent $GradlePath) "local.properties"
        $beforeLocalProperties = Get-OptionalFileState -Path $localProperties
        $arguments = @(
            "testDebugUnitTest",
            "--tests",
            "com.hxz.alerttime.app.data.assessment.LearningAnalysisOfflineReplayTest",
            "--tests",
            "com.hxz.alerttime.app.data.sync.SyncCodecTest",
            "--console=plain",
            "--no-daemon"
        )
        try {
            Invoke-External -Label "Android JVM replay" -FilePath $GradlePath -Arguments $arguments -WorkingDirectory (Split-Path -Parent $GradlePath)
        } finally {
            $afterLocalProperties = Get-OptionalFileState -Path $localProperties
            Assert-OptionalFileStateUnchanged -Path $localProperties -Before $beforeLocalProperties -After $afterLocalProperties
        }
    } finally {
        foreach ($name in $environmentNames) {
            [System.Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
        }
    }
}

try {
    Write-Host "=== AlertTime offline cross-repository verification ===" -ForegroundColor Cyan
    Write-Host "TeacherRoot: $TeacherRoot"
    Write-Host "AlertTimeRoot: $AlertTimeRoot"
    Write-Host "Device operations: disabled by design" -ForegroundColor DarkGray

    $teacherRootResolved = [System.IO.Path]::GetFullPath($TeacherRoot)
    $alertRoot = [System.IO.Path]::GetFullPath($AlertTimeRoot)
    Assert-Path $teacherRootResolved "TeacherRoot" "Container"
    Assert-Path $alertRoot "AlertTimeRoot" "Container"
    if ([System.StringComparer]::OrdinalIgnoreCase.Equals($teacherRootResolved.TrimEnd('\', '/'), $alertRoot.TrimEnd('\', '/'))) {
        throw "TeacherRoot and AlertTimeRoot must be different directories."
    }

    Write-Phase "[0/5] Preflight"
    $teacherRequired = @(
        @{ Path = (Join-Path $TeacherRoot "package.json"); Description = "Teacher package.json" },
        @{ Path = (Join-Path $TeacherRoot "src-tauri/Cargo.toml"); Description = "Teacher Cargo.toml" },
        @{ Path = (Join-Path $TeacherRoot "src/engine/sync/learningAnalysisFixture.contract.test.ts"); Description = "Teacher fixture contract test" },
        @{ Path = (Join-Path $TeacherRoot "src-tauri/src/sync/server.rs"); Description = "Teacher sync server" },
        @{ Path = (Join-Path $TeacherRoot "sync/protocol"); Description = "Teacher protocol directory" },
        @{ Path = (Join-Path $TeacherRoot "scripts/verify-protocol-mirror.mjs"); Description = "protocol mirror verifier" }
    )
    foreach ($item in $teacherRequired) {
        if ($item.Description -match "directory") {
            Assert-Path $item.Path $item.Description "Container"
        } else {
            Assert-Path $item.Path $item.Description "Leaf"
        }
    }

    Assert-Path (Join-Path $alertRoot "sync/protocol") "AlertTime protocol directory" "Container"
    Assert-Path (Join-Path $alertRoot "sync/protocol/fixtures") "AlertTime canonical protocol fixtures directory" "Container"
    Assert-Path (Join-Path $alertRoot "app/src/test/resources/sync/fixtures") "AlertTime Android JVM fixture directory" "Container"
    if (-not $SkipAndroid) {
        $androidRequired = @(
            @{ Path = (Join-Path $alertRoot "gradlew.bat"); Description = "AlertTime Gradle wrapper" },
            @{ Path = (Join-Path $alertRoot "app/src/test/java/com/hxz/alerttime/app/data/assessment/LearningAnalysisOfflineReplayTest.kt"); Description = "AlertTime offline replay test" }
        )
        foreach ($item in $androidRequired) {
            Assert-Path $item.Path $item.Description "Leaf"
        }
    }

    $node = Get-CommandPath "node"
    $npm = Get-CommandPath "npm"
    Assert-Path $node "node executable" "Leaf"
    Assert-Path $npm "npm executable" "Leaf"
    $rust = Get-RustToolchainPair -ExplicitBin $RustToolchainBin
    Write-Host "  Rust source: $($rust.Source)"

    if (-not $SkipAndroid) {
        $effectiveAndroidRoot = $AndroidSdkRoot
        if (-not $effectiveAndroidRoot) {
            if ($env:ANDROID_SDK_ROOT) {
                $effectiveAndroidRoot = $env:ANDROID_SDK_ROOT
            } elseif ($env:ANDROID_HOME) {
                $effectiveAndroidRoot = $env:ANDROID_HOME
            } else {
                throw "Android SDK not configured. Pass -AndroidSdkRoot <path>, or use -SkipAndroid explicitly."
            }
        }
        $effectiveAndroidRoot = [System.IO.Path]::GetFullPath($effectiveAndroidRoot)
        Assert-Path $effectiveAndroidRoot "Android SDK root"
    } else {
        $effectiveAndroidRoot = $null
        Write-Host "  Android phase explicitly skipped." -ForegroundColor Yellow
    }

    Write-Phase "[1/5] Teacher targeted Vitest"
    Invoke-External -Label "Teacher fixture contract test" -FilePath $npm -Arguments @("run", "test", "--", "--run", "src/engine/sync/learningAnalysisFixture.contract.test.ts") -WorkingDirectory $TeacherRoot

    Write-Phase "[2/5] Rust targeted snapshot-route tests"
    $cargoArguments = @("test", "snapshot_route_", "--manifest-path", (Join-Path $TeacherRoot "src-tauri/Cargo.toml"), "--", "--nocapture")
    Invoke-RustSnapshotTests -Rust $rust -Arguments $cargoArguments -WorkingDirectory (Join-Path $TeacherRoot "src-tauri")

    if (-not $SkipAndroid) {
        Write-Phase "[3/5] Android targeted JVM replay (LearningAnalysisOfflineReplayTest + SyncCodecTest)"
        Invoke-AndroidJvmReplay -GradlePath (Join-Path $alertRoot "gradlew.bat") -AndroidRoot $effectiveAndroidRoot
    } else {
        Write-Phase "[3/5] Android targeted JVM replay (skipped by -SkipAndroid)"
    }

    Write-Phase "[4/5] Cross-repository protocol mirror"
    $protocolVerifier = Join-Path $TeacherRoot "scripts/verify-protocol-mirror.mjs"
    $crossRepositoryProtocolArguments = @(
        $protocolVerifier,
        (Join-Path $TeacherRoot "sync/protocol"),
        (Join-Path $alertRoot "sync/protocol")
    )
    Invoke-External -Label "Cross-repository protocol mirror (Teacher sync/protocol versus AlertTime sync/protocol)" -FilePath $node -Arguments $crossRepositoryProtocolArguments -WorkingDirectory $TeacherRoot

    Write-Phase "[5/5] Android JVM fixture mirror"
    $androidJvmFixtureArguments = @(
        $protocolVerifier,
        (Join-Path $alertRoot "sync/protocol/fixtures"),
        (Join-Path $alertRoot "app/src/test/resources/sync/fixtures")
    )
    Invoke-External -Label "Android JVM fixture mirror (canonical fixtures versus test resources)" -FilePath $node -Arguments $androidJvmFixtureArguments -WorkingDirectory $TeacherRoot

    Write-Host ""
    Write-Host "Offline cross-repository verification passed." -ForegroundColor Green
    Write-Host "Cross-repository protocol mirror: passed" -ForegroundColor Green
    Write-Host "Android JVM fixture mirror: passed" -ForegroundColor Green
    if ($SkipAndroid) {
        Write-Host "Android was skipped by explicit request; no device verification was performed." -ForegroundColor Yellow
    }
    exit 0
} catch {
    Write-Host ""
    Write-Host "Offline cross-repository verification failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
