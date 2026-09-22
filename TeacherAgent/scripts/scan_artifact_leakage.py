"""Scan release artifacts for leaked build-machine paths and credential-shaped secrets.

Layers:
  identity -- byte strings that only exist on this build machine (user name, home,
              computer name, temp, CARGO_HOME, RUSTUP_HOME, repo root, plus their
              8.3 short forms). Derived from the environment and never hardcoded,
              so the same gate works on any build host.
  paths    -- drive-absolute runs ending in a source or symbol extension.
  secrets  -- credential shapes.

Exit code: 0 clean, 1 findings, 2 usage or missing target.
"""

from __future__ import annotations

import argparse
import ctypes
import getpass
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

SOURCE_EXT = (
    rb"(?:rs|py|pyc|pyd|c|cc|cpp|h|hpp|go|java|kt|kts|ts|tsx|js|jsx|vue|sql|json|"
    rb"toml|map|pdb|lib|obj|dll|exe|log|db|sqlite|sqlite3)"
)

# The lookbehind keeps "https://host" from being read as a drive letter "s:" or "p:";
# the lookahead keeps ".com" from being read as the extension ".c".
ABS_PATH = re.compile(
    rb"(?<![A-Za-z0-9_:/\\.-])[A-Za-z]:[\\/][^\x00-\x1f\x7f]{3,160}?\."
    + SOURCE_EXT
    + rb"(?![A-Za-z0-9])"
)

SECRET_PATTERNS: list[tuple[str, re.Pattern[bytes]]] = [
    ("openai-style key", re.compile(rb"sk-(?:proj-)?[A-Za-z0-9]{20,}")),
    ("anthropic key", re.compile(rb"sk-ant-api03-[A-Za-z0-9_\-]{20,}")),
    ("bearer token", re.compile(rb"[Bb]earer\s+[A-Za-z0-9._~+/=-]{24,}")),
    ("aws access key id", re.compile(rb"\bAKIA[0-9A-Z]{16}\b")),
    (
        "github token",
        re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9]{10,}_[A-Za-z0-9]{10,})"),
    ),
    ("pem private key", re.compile(rb"-----BEGIN [A-Z ]{3,40}PRIVATE KEY-----")),
    ("jwt", re.compile(rb"eyJ[A-Za-z0-9_\-]{16,}\.eyJ[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{8,}")),
    ("slack token", re.compile(rb"xox[baprse]-(?:[A-Za-z0-9]{18,}|[0-9]+-[0-9]+-[A-Za-z0-9]{18,})")),
    ("google oauth token", re.compile(rb"\bya29\.[A-Za-z0-9_\-]{24,}\b")),
    (
        "inline credential assignment",
        re.compile(
            rb"(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|password)"
            rb"\s*[:=]\s*\x22([^\x22\x00-\x1f]{16,})\x22",
            re.IGNORECASE,
        ),
    ),
]

# The app embeds the very prefix vocabulary it uses to redact credential-shaped
# text, so a window dense with these markers is the shipped scrub list, not a leak.
SCRUB_MARKERS = (
    b"sk-", b"sk_rk", b"pk_live", b"rk_live", b"gsk", b"github_pat", b"ghp_", b"gho_",
    b"ghu_", b"ghs_", b"ghr_", b"xoxb", b"xoxp", b"xoxa", b"xoxr", b"xoxs", b"ya29",
    b"AKIA", b"Bearer", b"secret", b"token", b"password",
)
SCRUB_WINDOW = 96

DEFAULT_TARGETS = [
    "dist",
    "src-tauri/target/release/teacher-agent.exe",
    "src-tauri/target/release/code-worker.exe",
    "src-tauri/target/release/document-worker.exe",
    "src-tauri/sidecar-hashes.json",
]

SKIP_SUFFIXES = {".msi"}


def in_scrub_list(blob: bytes, start: int, end: int) -> bool:
    lo = max(0, start - SCRUB_WINDOW)
    hi = min(len(blob), end + SCRUB_WINDOW)
    window = blob[lo:hi]
    return sum(1 for m in SCRUB_MARKERS if m in window) >= 6


def short_path(value: str) -> str | None:
    if os.name != "nt" or not value:
        return None
    try:
        buf = ctypes.create_unicode_buffer(260)
        n = ctypes.windll.kernel32.GetShortPathNameW(value, buf, 260)
    except Exception:
        return None
    out = buf.value if 0 < n < 260 else ""
    return out if "~" in out.upper() else None


def identity_tokens(root: Path) -> dict[str, bytes]:
    raw: dict[str, str] = {}

    def add(key: str, value: str | None) -> None:
        if not value:
            return
        v = value.rstrip("\\/").strip()
        if len(v) >= 3 and v.lower() not in {"c:", "d:", "\\", "/"}:
            raw[key] = v

    add("USERNAME", os.environ.get("USERNAME") or getpass.getuser())
    add("USERDOMAIN", os.environ.get("USERDOMAIN"))
    add("COMPUTERNAME", os.environ.get("COMPUTERNAME"))
    add("HOME", str(Path.home()))
    add("USERPROFILE", os.environ.get("USERPROFILE"))
    add("TEMP", os.environ.get("TEMP"))
    add("CARGO_HOME", os.environ.get("CARGO_HOME"))
    add("RUSTUP_HOME", os.environ.get("RUSTUP_HOME"))
    add("VCS-ROOT", str(root))

    out: dict[str, bytes] = {}
    for key, value in raw.items():
        out[key] = value.encode("utf-8", "surrogateescape")
        if "\\" in value or "/" in value:
            s = short_path(value)
            if s:
                out[key + "-83"] = s.encode("utf-8", "surrogateescape")
    return out


def root_of(path_str: str) -> str:
    parts = re.split(r"[\\/]", path_str)
    return "\\".join(parts[:4])


def load_baseline(root: Path) -> dict | None:
    p = root / "scripts" / "artifact-leakage-baseline.json"
    if not p.is_file():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def match_rule(path_str: str, ids: dict[str, bytes], rules: list[dict]) -> dict | None:
    """True only for <CARGO_HOME>\\registry\\src\\<index>\\<crate_dir>\\... .

    The crate directory is matched exactly, so an aws-lc-sys version bump stops
    matching and the gate fails -- which is the re-audit trigger, on purpose.
    """
    for r in rules:
        tok = ids.get(r["identity_token"])
        if tok is None:
            continue
        prefix = tok.decode("utf-8", "surrogateescape")
        if not path_str.lower().startswith(prefix.lower()):
            continue
        parts = re.split(r"[\\/]", path_str[len(prefix):])
        if (len(parts) > 4
                and parts[1].lower() == "registry"
                and parts[2].lower() == "src"
                and parts[4].lower() == r["crate_dir"].lower()):
            return r
    return None


def scan(path: Path, ids: dict[str, bytes],
         baseline: dict | None) -> tuple[list[str], list[str]]:
    """Return (failures, notes). Only failures drive the exit code."""
    blob = path.read_bytes()
    findings: list[str] = []
    notes: list[str] = []
    rules: list[dict] = (baseline or {}).get("allowed", [])
    rules_by_token = {r["identity_token"]: r for r in rules}
    total_cap = (baseline or {}).get("total_max_per_file", 0)

    for key, tok in sorted(ids.items()):
        n = blob.count(tok)
        if not n:
            continue
        rule = rules_by_token.get(key)
        if rule and n <= rule["max_per_file"]:
            notes.append(f"baseline/{rule['id']}: {n} 处（上限 {rule['max_per_file']}）")
            continue
        findings.append(
            f"identity/{key}: {n} occurrence(s) of "
            f"{tok.decode('utf-8', 'replace')} "
            + ("(超出基线上限)" if rule else "(无基线条目，一律视为泄露)")
        )

    allowed: Counter[str] = Counter()
    unexplained: dict[str, int] = {}
    examples: dict[str, str] = {}
    for m in ABS_PATH.finditer(blob):
        s = m.group(0).decode("latin-1")
        rule = match_rule(s, ids, rules)
        if rule:
            allowed[rule["id"]] += 1
            continue
        k = root_of(s)
        unexplained[k] = unexplained.get(k, 0) + 1
        examples.setdefault(k, s)

    for r in rules:
        n = allowed[r["id"]]
        if n > r["max_per_file"]:
            findings.append(
                f"baseline/{r['id']}: {n} 条路径，超过基线上限 {r['max_per_file']}"
            )
    if total_cap and sum(allowed.values()) > total_cap:
        findings.append(
            f"baseline: 受控残留合计 {sum(allowed.values())} 条，超过总上限 {total_cap}"
        )

    if unexplained:
        findings.append(f"paths: {sum(unexplained.values())} build-machine absolute path(s)")
        for k, v in sorted(unexplained.items(), key=lambda x: -x[1])[:5]:
            findings.append(f"       {v:>6}  under {k}   e.g. {examples[k][:120]}")

    if allowed:
        notes.append("baseline: 受控残留合计 "
                     + " + ".join(f"{r['id']}={allowed[r['id']]}" for r in rules if allowed[r['id']]))

    for label, rx in SECRET_PATTERNS:
        hits = 0
        scrubbed = 0
        for m in rx.finditer(blob):
            if in_scrub_list(blob, m.start(), m.end()):
                scrubbed += 1
                continue
            hits += 1
            if hits <= 2:
                findings.append(
                    f"secrets/{label}: {m.group(0)[:48]!r} at offset {m.start():,}"
                )
        if hits > 2:
            findings.append(f"secrets/{label}: {hits - 2} more")
        elif hits and scrubbed:
            notes.append(f"{label}: 另有 {scrubbed} 处命中落在自带的脱敏前缀表内，已忽略")

    return findings, notes


def expand(target: str, root: Path) -> list[Path]:
    p = Path(target)
    if not p.is_absolute():
        p = root / p
    if p.is_file():
        return [p]
    if p.is_dir():
        return sorted(
            f for f in p.rglob("*")
            if f.is_file() and f.suffix.lower() not in SKIP_SUFFIXES
        )
    return []


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Scan release artifacts for leaked build-machine paths and secrets."
    )
    ap.add_argument("targets", nargs="*", help="files or directories; defaults to the shipped set")
    ap.add_argument("--list-defaults", action="store_true")
    ap.add_argument("--no-baseline", action="store_true",
                    help="忽略受控残留基线，恢复零容忍")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if args.list_defaults:
        print("\n".join(DEFAULT_TARGETS))
        return 0

    files: list[Path] = []
    missing: list[str] = []
    for t in args.targets or DEFAULT_TARGETS:
        got = expand(t, root)
        if not got:
            missing.append(t)
        files.extend(got)
    if missing:
        print(f"ERROR: target(s) not found: {', '.join(missing)}", file=sys.stderr)
        return 2

    baseline = None if args.no_baseline else load_baseline(root)
    if baseline:
        print(f"baseline: {len(baseline.get('allowed', []))} 条例外，"
              f"单文件合计上限 {baseline.get('total_max_per_file')}"
              f"（记录于 {baseline.get('recorded', {}).get('date')}，"
              f"{baseline.get('recorded', {}).get('artifact')}）")
    else:
        print("baseline: 未启用，零容忍")

    ids = identity_tokens(root)
    print(f"scanning {len(files)} file(s); {len(ids)} identity token(s)")

    bad = 0
    for f in files:
        findings, notes = scan(f, ids, baseline)
        try:
            rel = f.relative_to(root)
        except ValueError:
            rel = f
        if findings:
            bad += 1
            print(f"FAIL {rel} ({f.stat().st_size:,} bytes)")
            for line in findings:
                print(f"     {line}")
        for line in notes:
            print(f"     note {rel}: {line}")

    if bad:
        print(f"\n{bad} of {len(files)} artifact(s) carry findings.")
        return 1
    print("clean: 除基线登记的受控残留外，无构建机路径、身份串或凭据形态。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
