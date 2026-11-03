# -*- coding: utf-8 -*-
"""Build a commit on top of public/main that syncs the catalog + hardening work
and drops the one-off artifacts -- WITHOUT touching the current working tree.

Everything happens in a throwaway index via git plumbing. Pass --push to actually
create the remote branch; otherwise it only builds the commit and reports.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE = "public/main"
PREFIX = "TeacherAgent/"
BRANCH = "catalog-2026-09-22"

SYNC = [
    "data/exam-taxonomy/catalog.json",
    "src/services/knowledge/packManifest.ts",
    "src/services/knowledge/katexRenderGate.test.ts",
    "src/services/knowledge/manifestCountVerification.test.ts",
    "src/services/knowledge/packStatus.test.ts",
    "src/services/knowledge/packValidator.test.ts",
    "src/stores/packSelection.test.ts",
    "src/tests/civilService.subject.test.ts",
    "src/services/questions/localQuestionBankSearch.test.ts",
    "src/services/questions/scopedKnowledgeNodeIds.test.ts",
    "src/engine/examTaxonomy/planScope.test.ts",
    "src/engine/examTaxonomy/questionScope.test.ts",
    "docs/knowledge-base-governance.md",
    "docs/knowledge-review/2026-09-11-approved-pack-promotion.md",
    "docs/knowledge-review/2026-09-11-civil-common-sense-scope-promotion.md",
    "docs/knowledge-review/2026-09-19-probability-basics-promotion-and-catalog-reproducibility.md",
    "docs/release-hardening.md",
    "scripts/scan_artifact_leakage.py",
    "scripts/build-release.ps1",
    "scripts/artifact-leakage-baseline.json",
    "scripts/release-check.ps1",
]
SYNC += [f"data/knowledge/{p.name}" for p in sorted((REPO / "data/knowledge").glob("*.seed.json"))]
SYNC += [f"data/questions/{p.name}" for p in sorted((REPO / "data/questions").glob("*.seed.json"))]

DROP = [
    "TeacherAgent/fix_json.cjs",
    "TeacherAgent/fix_json_la.cjs",
    "TeacherAgent/fix_latex.cjs",
    "TeacherAgent/修复状态文档.html",
    "TeacherAgent/项目全面审查报告.html",
]

MSG = (
    "chore(catalog): 同步 51/773/764 catalog、审核授权契约与发布闸门\n\n"
    "把私有开发仓的三组内容作为一次普通内容更新搬入本仓，不携带其历史：\n"
    "  1. 知识库 catalog：52 对 seed、exam-taxonomy、packManifest 及随之扩量的门禁测试；\n"
    "     晋升依据（2026-09-11 两份 + 2026-09-19 补录）首次随包入库。\n"
    "  2. governance 新增 §11.3 审核授权契约：包级 approved 与条目级事实复核拆成两个独立轴，\n"
    "     并列明负责人授权的代理审核可认证/不可认证的范围。\n"
    "  3. 发布闸门：产物泄漏扫描器、带 --remap-path-prefix 的构建脚本、受控残留基线。\n"
    "同时移除根目录的一次性脚本与报告（fix_*.cjs、两份 HTML 审查报告）。\n"
)


def git(*args, env=None, **kw):
    return subprocess.run(("git",) + args, cwd=REPO, capture_output=True,
                          text=True, encoding="utf-8", env=env, **kw)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    idx = REPO / ".git" / "tmp_catalog.index"
    if idx.exists():
        idx.unlink()
    env = dict(os.environ, GIT_INDEX_FILE=str(idx))

    base_sha = git("rev-parse", BASE).stdout.strip()
    if git("read-tree", base_sha, env=env).returncode != 0:
        print("read-tree failed"); return 1

    added, missing = 0, []
    for rel in SYNC:
        r = git("rev-parse", f"HEAD:{rel}")
        if r.returncode != 0:
            missing.append(rel); continue
        blob = r.stdout.strip()
        u = git("update-index", "--add", "--cacheinfo", f"100644,{blob},{PREFIX}{rel}", env=env)
        if u.returncode != 0:
            missing.append(rel + " (update-index)"); continue
        added += 1

    dropped = 0
    for p in DROP:
        if git("rev-parse", "--quiet", "--verify", f"{base_sha}:{p}").returncode == 0:
            git("update-index", "--force-remove", p, env=env)
            dropped += 1

    tree = git("write-tree", env=env).stdout.strip()
    commit = git("commit-tree", tree, "-p", base_sha, "-m", MSG).stdout.strip()

    print(f"base      = {base_sha[:12]}")
    print(f"new tree  = {tree[:12]}")
    print(f"new commit= {commit[:12]}")
    print(f"synced    = {added} files")
    print(f"dropped   = {dropped} files")
    if missing:
        print(f"MISSING   = {missing}")
        return 1

    stat = git("diff", "--stat", base_sha, commit).stdout.strip().splitlines()
    print(f"\ndiff summary ({len(stat)} lines):")
    print("\n".join(stat[-3:]))

    if idx.exists():
        idx.unlink()

    if not args.push:
        print("\nDRY RUN — 未推送。加 --push 才建远端分支。")
        return 0

    p = git("push", "public", f"{commit}:refs/heads/{BRANCH}")
    print(p.stdout or "", p.stderr or "")
    return p.returncode


if __name__ == "__main__":
    sys.exit(main())
