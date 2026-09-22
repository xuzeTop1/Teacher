<#
  TeacherAgent 发布构建（带编译期路径重映射）

  为什么需要这个脚本：
    直接 `npm run tauri:build` 会把构建机的绝对源路径写进发布二进制
    （registry 与 toolchain 的 file!()/panic 位置）。这些字符串随安装包分发出去，
    暴露开发机的目录布局。--remap-path-prefix 在编译期把它们改写成中性前缀。

  前缀从环境变量推导，不写死任何机器特有的路径，因此提交进仓库是安全的。

  用法:
    .\scripts\build-release.ps1                # 完整构建 + 扫描 + 发布检查
    .\scripts\build-release.ps1 -SkipBundle    # 只出 release 二进制，不打包安装器
    .\scripts\build-release.ps1 -NoRemap       # 对照组：按原方式构建
#>

param(
    [switch]$SkipBundle,
    [switch]$NoRemap,
    [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---- 1. 工具链前置检查 -------------------------------------------------------
Step "Pre-flight: toolchain"

function Find-Linker {
    Get-Command link.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -notlike "*usr\bin*" } |
        Select-Object -First 1
}

function Import-VcDevEnv {
    # link.exe 装完也不在普通终端的 PATH 里，必须先加载 vcvars。
    # vswhere 自己就在 Installer 目录下，用它定位实例比猜路径可靠。
    $vswhere = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\Installer\vswhere.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $vswhere) { return $null }

    # 先按组件 ID 问；问不到就退回"逐个实例找 vcvars64.bat"。
    # 退这一层是因为组件 ID 随版本会变（2026 上实测 -requires 会返回空），
    # 而 bat 文件在不在是能直接验证的事实。
    $candidates = @()
    $byComponent = & $vswhere -latest -prerelease -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null
    if ($byComponent) { $candidates += $byComponent }
    $all = & $vswhere -all -prerelease -products * -property installationPath 2>$null
    if ($all) { $candidates += $all }
    $candidates = $candidates | Where-Object { $_ } | Select-Object -Unique

    # 入口脚本的位置随版本和产品形态会变：Build Tools 2026 里没有
    # VC\Auxiliary\Build\vcvars64.bat，只有 Common7\Tools\VsDevCmd.bat。
    # 两个都探，取第一个真实存在的。
    $probes = foreach ($c in $candidates) {
        [pscustomobject]@{ Root = $c; Bat = (Join-Path $c "VC\Auxiliary\Build\vcvars64.bat"); Args = "" }
        [pscustomobject]@{ Root = $c; Bat = (Join-Path $c "Common7\Tools\VsDevCmd.bat"); Args = " -arch=amd64 -host_arch=amd64 -no_logo" }
    }
    $chosen = $probes | Where-Object { Test-Path $_.Bat } | Select-Object -First 1
    if (-not $chosen) { return $null }

    Write-Host "  加载开发环境: $($chosen.Bat)$($chosen.Args)"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $dump = & cmd.exe /c "`"$($chosen.Bat)`"$($chosen.Args) >nul 2>&1 && set"
    $ErrorActionPreference = $prev
    if ($LASTEXITCODE -ne 0 -or -not $dump) { return $null }

    foreach ($line in $dump) {
        if ($line -match '^([^=]+)=(.*)$') {
            Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
        }
    }
    return $chosen.Root
}

$shadowed = Get-Command link.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -like "*usr\bin*" }
$link = Find-Linker

if (-not $link) {
    $vsPath = Import-VcDevEnv
    $link = Find-Linker
}

if ($link) {
    Write-Host "  linker      : $($link.Source)"
    if ($vsPath) { Write-Host "  VS 实例     : $vsPath" }
} else {
    # 三类原因各有各的修法，分开报，别让人去猜。
    Write-Host "FAIL: 无法确定可用的 MSVC 链接器。" -ForegroundColor Red
    if ($shadowed) {
        Write-Host "  检测到 $((Get-Command link.exe).Source) —— 这是 Git 自带的 Unix link(1)，" -ForegroundColor Yellow
        Write-Host "  会遮蔽真链接器（症状是 'link: extra operand'）。" -ForegroundColor Yellow
    }
    if (-not $vsPath) {
        Write-Host "  vswhere 找不到带 C++ 生成工具的 VS 实例，说明 MSVC 那半边还没装：" -ForegroundColor Yellow
        Write-Host "  link.exe、cl.exe 与 VC 导入库（msvcrt.lib / oldnames.lib）都不存在。" -ForegroundColor Yellow
        Write-Host "  光有 Windows SDK 不够——rusqlite 的 bundled 要编译 SQLite C 源码，" -ForegroundColor Yellow
        Write-Host "  aws-lc-sys 要编译并汇编 C，所以需要 MSVC 生成工具 + Windows 11 SDK。" -ForegroundColor Yellow
    } else {
        Write-Host "  找到 VS 实例 $vsPath，但加载 vcvars64.bat 后仍拿不到 link.exe。" -ForegroundColor Yellow
        Write-Host "  多半是该实例没装「MSVC 生成工具」组件，去 VS Installer 的单个组件页勾上。" -ForegroundColor Yellow
    }
    exit 2
}

$cargoHome  = if ($env:CARGO_HOME)  { $env:CARGO_HOME }  else { Join-Path $HOME ".cargo" }
$rustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { Join-Path $HOME ".rustup" }
Write-Host "  CARGO_HOME  : $cargoHome"
Write-Host "  RUSTUP_HOME : $rustupHome"

if ($env:RUSTFLAGS) {
    Write-Host "WARN: 环境里已有 RUSTFLAGS；CARGO_ENCODED_RUSTFLAGS 会覆盖它，" -ForegroundColor Yellow
    Write-Host "      原有 flag（如 target-cpu）不会生效。当前值: $($env:RUSTFLAGS)" -ForegroundColor Yellow
}

# ---- 2. 组装 remap 前缀 ------------------------------------------------------
$prefixes = @(
    , @($cargoHome,  "/cargo")
    , @($rustupHome, "/rustup")
    , @($root,       "/src")
)

if ($NoRemap) {
    Step "Build WITHOUT remap (control)"
    [Environment]::SetEnvironmentVariable("CARGO_ENCODED_RUSTFLAGS", $null, "Process")
} else {
    Step "Build WITH compile-time path remap"
    $flags = @()
    foreach ($p in $prefixes) {
        $flags += "--remap-path-prefix"
        $flags += ($p[0] + "=" + $p[1])
    }
    [Environment]::SetEnvironmentVariable(
        "CARGO_ENCODED_RUSTFLAGS",
        ($flags -join [char]0x1f),
        "Process"
    )
    foreach ($p in $prefixes) { Write-Host "  $($p[0])  ->  $($p[1])" }
}

# ---- 3. 前端 + sidecar 清单 + tauri 构建 ------------------------------------
Step "Frontend + sidecar manifest"
& npm run build:tauri-pre
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: build:tauri-pre" -ForegroundColor Red; exit 1 }

Step "tauri build"
$tauriArgs = @("build")
if ($SkipBundle) { $tauriArgs += "--no-bundle" }
& npx tauri @tauriArgs
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: tauri build" -ForegroundColor Red; exit 1 }

if ($SkipChecks) { Write-Host "`nchecks skipped by request." -ForegroundColor Yellow; exit 0 }

# ---- 4. 产物扫描：必须为零 ---------------------------------------------------
Step "Artifact leakage scan"
$release = Join-Path $root "src-tauri\target\release"
$artifacts = @(
    (Join-Path $release "teacher-agent.exe"),
    (Join-Path $release "code-worker.exe"),
    (Join-Path $release "document-worker.exe"),
    (Join-Path $root "dist")
) | Where-Object { Test-Path $_ }

& python (Join-Path $root "scripts\scan_artifact_leakage.py") @artifacts
$scanExit = $LASTEXITCODE
if ($scanExit -ne 0) {
    Write-Host "`nFAIL: 发布产物仍含构建机路径或凭据形态字符串。" -ForegroundColor Red
    if (-not $NoRemap) {
        Write-Host "  若这是新引入的依赖，检查是否有构建脚本把绝对路径写进生成代码。" -ForegroundColor Yellow
    }
    exit 1
}

# ---- 5. 既有发布闸门 ---------------------------------------------------------
Step "Release check"
& (Join-Path $root "scripts\release-check.ps1")
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: release-check.ps1" -ForegroundColor Red; exit 1 }

Step "Done"
Write-Host "产物已构建并通过泄漏扫描与发布检查。" -ForegroundColor Green
