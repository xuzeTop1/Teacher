#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""找出 androidTest 断言里已经不在生产源码中的字符串（定位过时文案）。"""

import pathlib
import re
import sys

ROOT = pathlib.Path(
    r"<ALERTTIME_ROOT>"
)
MAIN = ROOT / "app/src/main/java"
TESTS = [
    "app/src/androidTest/java/com/hxz/alerttime/app/ui/assessment/LearningAnalysisDialogTest.kt",
    "app/src/androidTest/java/com/hxz/alerttime/app/ui/FormFlowsScreenshotTest.kt",
]


def main() -> int:
    source = "\n".join(
        p.read_text(encoding="utf-8", errors="replace") for p in MAIN.rglob("*.kt")
    )
    for relative in TESTS:
        path = ROOT / relative
        text = path.read_text(encoding="utf-8")
        literals = set(re.findall(r'"([^"\n]{2,60})"', text))
        stale = [
            value
            for value in sorted(literals)
            if re.search(r"[\u4e00-\u9fff]", value) and value not in source
        ]
        print(f"=== {path.name} （{len(literals)} 个字面量，{len(stale)} 个已不在源码中）")
        for value in stale:
            print(f"    {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
