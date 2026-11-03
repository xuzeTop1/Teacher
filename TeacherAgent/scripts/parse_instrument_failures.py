#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 am instrument 输出里精确取出每个失败用例的原因与断言行号。

做法：以 `INSTRUMENTATION_STATUS_CODE: -2` 为锚点向前回溯，最近的
`INSTRUMENTATION_STATUS: test=` 即该失败用例，最近的 `stack=` 行含原因与断言位置。
"""

import re
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else r"<APPDATA>\Local\Temp\ui_all19.txt"


def main() -> int:
    lines = open(PATH, encoding="utf-8", errors="replace").read().splitlines()
    test = stack = None
    rows = []
    for line in lines:
        if line.startswith("INSTRUMENTATION_STATUS: test="):
            test = line.split("=", 1)[1].strip()
        elif line.startswith("INSTRUMENTATION_STATUS: stack="):
            stack = line
        elif line.startswith("INSTRUMENTATION_STATUS_CODE: -2") and test:
            reason = "—"
            location = "—"
            if stack:
                match = re.search(r"Reason: ([^\n]{0,110})", stack)
                if match:
                    reason = match.group(1).strip()
                else:
                    match = re.search(r"(java\.lang\.\w+(?:Error|Exception)[^\n]{0,80})", stack)
                    if match:
                        reason = match.group(1).strip()
                match = re.search(r"(\w+Test)\.kt:(\d+)", stack)
                if match:
                    location = f"{match.group(1)}:{match.group(2)}"
            rows.append((test, location, reason))
            test = stack = None
    print(f"{len(rows)} 项失败：\n")
    for name, location, reason in rows:
        print(f"  [{location}] {name}")
        print(f"      {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
