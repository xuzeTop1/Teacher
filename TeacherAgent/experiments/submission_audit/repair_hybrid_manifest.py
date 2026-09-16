#!/usr/bin/env python3
"""Repair only the provenance wording in the specified immutable-run manifest."""
from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

TARGET = Path(r"D:\TeacherAgent-alerttime-json\benchmark-results\20260915-213052-hybrid-retrieval-100q\run_manifest.json")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    before_sha = digest(TARGET)
    backup = TARGET.with_name("run_manifest.before-provenance-repair.json")
    if not backup.exists():
        shutil.copy2(TARGET, backup)
    data = json.loads(TARGET.read_text(encoding="utf-8"))
    data["qa"]["questionConstruction"] = "题目由语料标题/正文模板构造（术语、是什么意思、怎么算）；93题是原100题中候选池至少有一项多数相关项的条件子集"
    data["qa"]["coverage"] = {
        "totalQuestions": 100,
        "includedQuestions": 93,
        "candidatePoolCoverage": 0.93,
        "excludedQids": ["q073", "q074", "q087", "q092", "q095", "q099", "q100"],
        "exclusionRule": "候选池没有任何达到多数票门槛（>=3/5）的相关项",
    }
    data["caveats"][0] = "gold set由2名真人与3个AI评审等权多数决形成（多数票>=3/5）；题目由语料模板构造；93题是原100题中候选池有多数相关项的条件子集，不应表述为纯人工金标准；"
    data["caveats"].insert(1, "候选池覆盖率为93/100=93%；未进入条件子集的7题应在100题总体口径中按未命中计入。")
    data["caveats"].append("评测副本内注入159条private_chunk向量仅用于本次离线评测；默认部署库不包含这些私有切片向量，线上库未被写入。")
    data["provenanceRepair"] = {
        "revisedAt": datetime.now(timezone.utc).isoformat(),
        "reason": "修正humanAnnotated=true/2人+3AI多数决与旧caveat机器标注之间的矛盾，并显式记录题目构造、93/100条件覆盖和评测副本私有向量边界",
        "previousSha256": before_sha,
        "backup": backup.name,
    }
    TARGET.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    after_sha = digest(TARGET)
    revision = {
        "target": TARGET.name,
        "beforeSha256": before_sha,
        "afterSha256": after_sha,
        "backup": backup.name,
        "changedFields": ["qa.questionConstruction", "qa.coverage", "caveats[0]", "caveats[1]", "caveats[-1]", "provenanceRepair"],
        "interpretation": "2名真人+3个AI等权多数决；不是纯人工金标准；93题为候选池覆盖的条件子集；159条私有切片向量只在评测副本。",
    }
    (TARGET.parent / "manifest_provenance_repair.json").write_text(json.dumps(revision, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(revision, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
