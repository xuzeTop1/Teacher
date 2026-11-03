#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AlertTime 真机 UI 仪器测试一键跑器（供其他 agent / 后续会话直接调用）。

做四件事：按需重建并安装测试包 → 准备设备状态（唤醒/常亮/临时放宽息屏）→
用 `am instrument` 直跑指定测试类（**不用** Gradle，避免失败即卸载 App）→
解析结果并按用例打印失败原因，最后恢复息屏设置。

用法：
    python run_android_ui_tests.py                    # 跑默认的 5 个 UI 测试类
    python run_android_ui_tests.py --reinstall        # 先 gradle 重建并覆盖安装测试包
    python run_android_ui_tests.py --class <全限定类名> [--class ...]

前提（缺一不可，MIUI 特有）：
  * 开发者选项 → 通过 USB 安装应用（否则测试包 install 被 INSTALL_FAILED_USER_RESTRICTED 拒）
  * 「后台弹出界面」对 App 与测试包均设为“始终允许”（否则测试启动 Activity 被静默拒绝，
    表现为 No compose hierarchies found in the app / Failed: assertExists）
  * 跑之前手机别在被使用（前台被别的应用占据会污染结果）
"""

import argparse
import pathlib
import re
import subprocess
import sys
import time

REPO = pathlib.Path(r"<ALERTTIME_ROOT>")
PKG = "com.hxz.alerttime.app"
TEST_PKG = "com.hxz.alerttime.app.test"
RUNNER = f"{TEST_PKG}/androidx.test.runner.AndroidJUnitRunner"
APK = REPO / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"

DEFAULT_CLASSES = [
    "com.hxz.alerttime.app.ui.HomeTimerFlowTest",
    "com.hxz.alerttime.app.ui.backup.DataBackupDialogTest",
    "com.hxz.alerttime.app.ui.assessment.LearningAnalysisDialogTest",
    "com.hxz.alerttime.app.ui.FormFlowsScreenshotTest",
    "com.hxz.alerttime.app.ui.StatsShareFlowTest",
]


def run(command, **kwargs):
    """Windows 下 adb 的 shell 参数里含 /data/... 时需禁用路径转换。"""
    return subprocess.run(command, **kwargs)


def adb(*args, capture=True):
    environment = dict(**__import__("os").environ)
    environment["MSYS_NO_PATHCONV"] = "1"
    return run(["adb", *args], capture_output=capture, text=True, env=environment)


def foreground() -> str:
    result = adb("shell", "dumpsys", "window")
    if result.returncode != 0:
        return "unknown"
    match = re.search(r"mCurrentFocus=Window\{[^}]*\}", result.stdout or "")
    return match.group(0) if match else "unknown"


def prepare_device() -> str:
    adb("shell", "svc", "power", "stayon", "true")
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    old = (adb("shell", "settings", "get", "system", "screen_off_timeout").stdout or "120000").strip()
    adb("shell", "settings", "put", "system", "screen_off_timeout", "1800000")
    adb("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    return old


def parse(output: str):
    test = stack = None
    rows = []
    for line in output.splitlines():
        if line.startswith("INSTRUMENTATION_STATUS: test="):
            test = line.split("=", 1)[1].strip()
        elif line.startswith("INSTRUMENTATION_STATUS: stack="):
            stack = line
        elif line.startswith("INSTRUMENTATION_STATUS_CODE: -2") and test:
            reason = "—"
            location = "—"
            if stack:
                match = re.search(r"Reason: ([^\n]{0,110})", stack) or re.search(
                    r"(java\.lang\.\w+(?:Error|Exception)[^\n]{0,90})", stack
                )
                if match:
                    reason = match.group(1).strip()
                match = re.search(r"(\w+Test)\.kt:(\d+)", stack)
                if match:
                    location = f"{match.group(1)}:{match.group(2)}"
            rows.append((test, location, reason))
            test = stack = None
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="AlertTime 真机 UI 仪器测试一键跑器")
    parser.add_argument("--class", dest="classes", action="append", default=None)
    parser.add_argument("--reinstall", action="store_true", help="先 gradle 重建并覆盖安装测试包")
    args = parser.parse_args()
    classes = args.classes or DEFAULT_CLASSES

    if args.reinstall:
        print("重建测试包 …")
        run([str(REPO / "gradlew"), ":app:assembleDebugAndroidTest", "--console=plain"], cwd=REPO)
        installed = adb("install", "-r", str(APK))
        print("安装:", (installed.stdout or "").strip())

    print("跑测试前的前台窗口:", foreground())
    print("提示：应看到 launcher 或本应用；若显示其它应用，先停下让手机空闲。")
    old_timeout = prepare_device()

    command = ["shell", "am", "instrument", "-w", "-r"]
    for name in classes:
        command += ["-e", "class", name]
    command.append(RUNNER)
    print("执行:", " ".join(command[2:]))
    result = adb(*command)
    output = (result.stdout or "") + (result.stderr or "")

    summary = re.search(r"Tests run: (\d+),\s+Failures: (\d+)", output)
    if summary:
        print(f"\n结果：{summary.group(1)} 项，失败 {summary.group(2)} 项")
    else:
        print("\n未解析到汇总行，下面是原始输出尾部：")
        print("\n".join(output.splitlines()[-15:]))

    failures = parse(output)
    if failures:
        print(f"\n失败明细（{len(failures)} 项）：")
        for name, location, reason in failures:
            print(f"  [{location}] {name}\n      {reason}")

    adb("shell", "settings", "put", "system", "screen_off_timeout", old_timeout or "120000")
    print("\n已恢复息屏超时。原始输出可用 -w -r 的参数自行保存；失败解析逻辑见本文件 parse()。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
