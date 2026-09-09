[CmdletBinding()]
param(
    [string]$AdbPath = "",
    [string]$Serial = "",
    [switch]$ConfirmReplaceInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PackageName = "com.hxz.alerttime.app"
$TestPackageName = "com.hxz.alerttime.app.test"
$Runner = "$TestPackageName/androidx.test.runner.AndroidJUnitRunner"
$TestClasses = @(
    "com.hxz.alerttime.app.data.assessment.LocalLearningAnalysisStoreInstrumentedTest",
    "com.hxz.alerttime.app.data.llm.LlmProviderSettingsStoreInstrumentedTest",
    "com.hxz.alerttime.app.ui.assessment.LearningAnalysisDialogTest"
)

function Resolve-AdbPath {
    if (-not [string]::IsNullOrWhiteSpace($AdbPath)) {
        return (Resolve-Path -LiteralPath $AdbPath).Path
    }

    $candidates = @()
    foreach ($sdkRoot in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
        if (-not [string]::IsNullOrWhiteSpace($sdkRoot)) {
            $candidates += Join-Path $sdkRoot "platform-tools/adb.exe"
        }
    }
    $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
    if ($null -ne $adbCommand) {
        $candidates += $adbCommand.Source
    }
    $resolved = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($null -eq $resolved) {
        throw "找不到 adb。请通过 -AdbPath 指定 Android SDK platform-tools/adb.exe。"
    }
    return (Resolve-Path -LiteralPath $resolved).Path
}

$ResolvedAdbPath = Resolve-AdbPath

function Invoke-Adb {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = & $ResolvedAdbPath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "adb 命令失败（exit=$LASTEXITCODE）：$($output -join [Environment]::NewLine)"
    }
    return @($output)
}

function Get-PackageIdentity {
    param([Parameter(Mandatory = $true)][string]$DeviceSerial)

    $dump = Invoke-Adb -Arguments @("-s", $DeviceSerial, "shell", "dumpsys", "package", $PackageName)
    $userIdMatch = $dump | Select-String -Pattern "^\s*userId=(\d+)\s*$" | Select-Object -First 1
    $firstInstallMatch = $dump | Select-String -Pattern "^\s*firstInstallTime=(.+)\s*$" | Select-Object -First 1
    if ($null -eq $userIdMatch -or $null -eq $firstInstallMatch) {
        throw "无法读取现有应用的 userId/firstInstallTime；为保护数据，拒绝继续。"
    }
    return [pscustomobject]@{
        UserId = $userIdMatch.Matches[0].Groups[1].Value
        FirstInstallTime = $firstInstallMatch.Matches[0].Groups[1].Value.Trim()
    }
}

$deviceOutput = Invoke-Adb -Arguments @("devices", "-l")
$onlineDevices = @(
    foreach ($line in $deviceOutput) {
        if ($line -match "^([^\s]+)\s+device(?:\s|$)") {
            $Matches[1]
        }
    }
)

if ([string]::IsNullOrWhiteSpace($Serial)) {
    if ($onlineDevices.Count -ne 1) {
        throw "需要且只能有 1 台已授权设备在线；当前数量：$($onlineDevices.Count)。"
    }
    $Serial = $onlineDevices[0]
} elseif ($Serial -notin $onlineDevices) {
    throw "指定设备未处于已授权 online 状态：$Serial"
}

$packagePath = Invoke-Adb -Arguments @("-s", $Serial, "shell", "pm", "path", $PackageName)
if (-not ($packagePath | Where-Object { $_ -like "package:*" })) {
    throw "设备上没有现有 AlertTime。脚本拒绝新装，只允许覆盖安装以保护既有验收边界。"
}

$identityBefore = Get-PackageIdentity -DeviceSerial $Serial
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$appApk = Join-Path $repositoryRoot "app/build/outputs/apk/debug/app-debug.apk"
$testApk = Join-Path $repositoryRoot "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
foreach ($apk in @($appApk, $testApk)) {
    if (-not (Test-Path -LiteralPath $apk)) {
        throw "缺少 APK：$apk。请先运行 assembleDebug assembleDebugAndroidTest。"
    }
}

Write-Output "设备：$Serial"
Write-Output "现有包：$($packagePath -join ', ')"
Write-Output "userId：$($identityBefore.UserId)"
Write-Output "firstInstallTime：$($identityBefore.FirstInstallTime)"
Write-Output "将运行的测试：$($TestClasses -join ', ')"

if (-not $ConfirmReplaceInstall) {
    Write-Output "预检完成，未安装、未启动测试。确认后请追加 -ConfirmReplaceInstall。"
    return
}

foreach ($apk in @($appApk, $testApk)) {
    $installOutput = Invoke-Adb -Arguments @("-s", $Serial, "install", "-r", "-t", $apk)
    if (-not ($installOutput | Where-Object { $_ -eq "Success" })) {
        throw "覆盖安装未返回 Success：$($installOutput -join [Environment]::NewLine)"
    }
}

$classFilter = $TestClasses -join ","
$instrumentationOutput = Invoke-Adb -Arguments @(
    "-s", $Serial, "shell", "am", "instrument", "-w",
    "-e", "class", $classFilter,
    $Runner
)
$instrumentationOutput | ForEach-Object { Write-Output $_ }
$instrumentationText = $instrumentationOutput -join [Environment]::NewLine
if ($instrumentationText -match "FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed|shortMsg=" -or
    $instrumentationText -notmatch "OK \(\d+ tests?\)" -or
    $instrumentationText -notmatch "INSTRUMENTATION_CODE:\s*-1") {
    throw "定向 instrumentation 未满足成功条件。"
}

$identityAfter = Get-PackageIdentity -DeviceSerial $Serial
if ($identityAfter.UserId -ne $identityBefore.UserId -or
    $identityAfter.FirstInstallTime -ne $identityBefore.FirstInstallTime) {
    throw "覆盖安装后 package identity 发生变化，不能宣称数据保留边界通过。"
}

$packagePathAfter = Invoke-Adb -Arguments @("-s", $Serial, "shell", "pm", "path", $PackageName)
if (-not ($packagePathAfter | Where-Object { $_ -like "package:*" })) {
    throw "验收后 AlertTime 包不可见。"
}

Write-Output "定向设备验收通过：3 个隔离测试成功，package userId 与 firstInstallTime 保持不变。"
Write-Output "脚本未包含卸载、清除应用数据或全量 connectedAndroidTest 操作。"
