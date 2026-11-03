"""Release 代码执行 fail-closed 的产物级取证。

探针不手打，从源码提取字符串字面量后按编译期语义还原：
1. 折叠 `\\` + 换行 + 缩进（Rust 字符串续行）；
2. 解转义（`\\"` -> `"` 等）；
3. 按 `{...}` 占位符切段——`format!` 的字面量在二进制里被占位符切成多段，
   长串连续匹配必然失败，逐段匹配才是正确形态。

判定双向：
- release：release 专用分支与完整性校验的每一段必须在；Python 回退的每一段必须不在。
- debug（正对照）：Python 回退的每一段必须在。没有这个对照，release 里的
  "不在" 无法排除 "扫描方法本来就找不到"。

用法: python scripts/scan_release_code_runner.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = REPO / "src-tauri" / "src"
CODE_WORKER = SRC_DIR / "code_worker.rs"
SIDECAR_INTEGRITY = SRC_DIR / "sidecar_integrity.rs"

# 匹配一个完整的 Rust 字符串体。`\x` 转义整体吃掉，因此不会在 \" 处提前收尾；
# 禁止裸换行，否则引号配对会跨行错位、目标字面量落进匹配空隙（已实际踩到）。
# DOTALL 是必需的：续行是 `\` + 换行，而 `.` 默认不匹配换行，缺了它跨行字面量匹配不上。
STRING_LITERAL = re.compile(r'"((?:\\.|[^"\\\n])*)"', re.DOTALL)
PLACEHOLDER = re.compile(r"\{[^{}]*\}")
MIN_FRAGMENT_CHARS = 8

# 探针名 -> (源文件, 用于在候选字面量中定位的锚点文本)
PROBES = [
    ("release_sidecar_missing", CODE_WORKER, "sidecar 未找到"),
    ("gate_closed_msg", CODE_WORKER, "不能执行不受信代码"),
    ("integrity_mismatch", SIDECAR_INTEGRITY, "文件摘要与预期不符"),
    ("integrity_manifest_entry", SIDECAR_INTEGRITY, "manifest 中未找到"),
    ("integrity_manifest_unreadable", SIDECAR_INTEGRITY, "manifest 无法读取"),
    ("integrity_manifest_malformed", SIDECAR_INTEGRITY, "manifest 格式无效"),
    ("py_spawn_failed", CODE_WORKER, "无法启动 Python code-worker"),
    ("py_not_found_hint", CODE_WORKER, "请安装 Python 3.10+"),
]

RELEASE_MUST_PRESENT = [
    "gate_closed_msg",
    "integrity_mismatch",
    "integrity_manifest_entry",
    "integrity_manifest_unreadable",
    "integrity_manifest_malformed",
]
RELEASE_MUST_BE_ABSENT = ["py_spawn_failed", "py_not_found_hint"]
DEBUG_MUST_PRESENT = ["py_spawn_failed", "py_not_found_hint"]

# 期望缺失（成因已定案，不是缺陷）：release 专用分支的"sidecar 未找到"在 release 里
# 确实被编译进来，但闸门 `run_code_with_worker` 的 `trusted_code_execution_enabled()`
# 在 release 下是编译期常量 false，闸门之后的整条 sidecar 路径不可达，LTO 把它连同
# 这串字面量一起删掉。所以"它不在"恰恰是闸门恒闭的旁证；它若出现，说明闸门后的
# 路径重新可达，需要复核。
RELEASE_EXPECTED_ABSENT_BY_GATE = ["release_sidecar_missing"]

UNESCAPE = {"\\\"": '"', "\\\\": "\\", "\\n": "\n", "\\t": "\t", "\\{": "{", "\\}": "}"}


def restore_literal(raw: str) -> str:
    """把源码里的字符串体还原成编译进二进制的字节序列。"""
    s = re.sub(r"\\\n[ \t]*", "", raw)  # 续行折叠
    for src, dst in UNESCAPE.items():
        s = s.replace(src, dst)
    return s


def fragments(literal: str, probe: str) -> list[str]:
    parts = [p for p in PLACEHOLDER.split(literal) if len(p) >= MIN_FRAGMENT_CHARS]
    if not parts:
        raise SystemExit(f"探针 {probe} 切段后为空: {literal!r}")
    return parts


def extract_probes() -> dict[str, list[str]]:
    cache: dict[pathlib.Path, str] = {}
    out: dict[str, list[str]] = {}
    for name, path, anchor in PROBES:
        if path not in cache:
            # 归一化 CRLF：续行 `\` 后面跟的是 \r\n，不归一化会挡住跨行字面量
            cache[path] = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        hit = next(
            (m.group(1) for m in STRING_LITERAL.finditer(cache[path]) if anchor in m.group(1)),
            None,
        )
        if hit is None:
            raise SystemExit(f"探针 {name} 在 {path.name} 中未找到含 {anchor!r} 的字面量")
        out[name] = fragments(restore_literal(hit), name)
    return out


def scan(path: pathlib.Path, probes: dict[str, list[str]]) -> dict:
    blob = path.read_bytes()
    per_probe = {}
    for name, parts in probes.items():
        counts = [blob.count(p.encode("utf-8")) for p in parts]
        per_probe[name] = {"fragments": parts, "counts": counts, "min": min(counts)}
    return {"path": str(path.relative_to(REPO)), "bytes": len(blob), "probes": per_probe}


def check(result: dict, must_present: list, must_be_absent: list, expected_absent: list = ()) -> bool:
    ok = True
    for name in must_present:
        v = result["probes"][name]
        good = v["min"] >= 1
        ok &= good
        note = "" if good else "  missing=" + str([f for f, c in zip(v["fragments"], v["counts"]) if c == 0])
        print(f"    [{'OK ' if good else 'FAIL'}] present {name:<30} min={v['min']}{note}")
    for name in must_be_absent:
        v = result["probes"][name]
        good = v["min"] == 0
        ok &= good
        note = "" if good else f"  counts={v['counts']}"
        print(f"    [{'OK ' if good else 'FAIL'}] absent  {name:<30} max={max(v['counts'])}{note}")
    for name in expected_absent:
        v = result["probes"][name]
        good = v["min"] == 0
        ok &= good
        note = "" if good else "  出现即说明闸门后路径重新可达，需复核"
        print(f"    [{'OK ' if good else 'FAIL'}] absent* {name:<30} max={max(v['counts'])}{note}")
    return ok


def main() -> int:
    probes = extract_probes()
    print("Probe fragments extracted from source (restored to compiled form):")
    for name, parts in probes.items():
        print(f"  {name:<32} {len(parts)} fragment(s)")
        for p in parts:
            print(f"      [{len(p.encode('utf-8')):>3} B] {p}")

    targets = {
        "release": REPO / "src-tauri" / "target" / "release" / "teacher-agent.exe",
        "debug": REPO / "src-tauri" / "target" / "debug" / "teacher-agent.exe",
    }

    report: dict = {"probes": probes, "results": {}, "verdict": {}}
    overall = True

    for label, path in targets.items():
        if not path.exists():
            print(f"\n[{label}] SKIP: not built ({path})")
            continue
        r = scan(path, probes)
        report["results"][label] = r
        print(f"\n[{label}] {r['path']} ({r['bytes']:,} B)")
        if label == "release":
            ok = check(r, RELEASE_MUST_PRESENT, RELEASE_MUST_BE_ABSENT, RELEASE_EXPECTED_ABSENT_BY_GATE)
        else:
            ok = check(r, DEBUG_MUST_PRESENT, [])
        report["verdict"][label] = ok
        overall &= ok
        print(f"  => {'PASS' if ok else 'FAIL'}")

    if "debug" in report["results"] and "release" in report["results"]:
        ds, rs = report["results"]["debug"]["probes"], report["results"]["release"]["probes"]
        control = {
            n: {"found_in_debug": ds[n]["min"] >= 1, "absent_in_release": rs[n]["min"] == 0}
            for n in RELEASE_MUST_BE_ABSENT
        }
        for v in control.values():
            v["valid"] = v["found_in_debug"] and v["absent_in_release"]
        report["positive_control"] = control
        print("\n[positive control] false-negative guard for the absent probes:")
        for n, v in control.items():
            print(
                f"    [{'OK ' if v['valid'] else 'FAIL'}] {n}: "
                f"debug={v['found_in_debug']} release_absent={v['absent_in_release']}"
            )
        overall &= all(v["valid"] for v in control.values())

    report["failed"] = not overall
    out = REPO / "experiments" / "release_verification" / "code-runner-scan.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\narchive: {out}")
    print("VERDICT: " + ("FAIL" if not overall else "PASS"))
    return 1 if not overall else 0


if __name__ == "__main__":
    sys.exit(main())
