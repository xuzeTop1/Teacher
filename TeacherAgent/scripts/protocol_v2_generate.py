# -*- coding: utf-8 -*-
"""C.1/C.2：生成快照协议 v2（focusAggregates）与 6 个夹具，更新 SHA-256 清单并镜像双端。

字段语义：focusAggregates.perSubject[].subjectTempId 为快照 payload.subjects 数组的
0-based 下标（论文 §4.3 的端侧聚合特征按学科上报）；rFocus ∈ [0,1]；nDistract 为非负整数；
windowDays 为聚合窗口天数（≥1）。
"""
import json, hashlib, os, shutil

TA = r"<REPO_ROOT>-alerttime-json/sync/protocol"
AT = r"<USER_HOME>/Documents/AlertTime-teacheragent-json/sync/protocol"
SNAP = "sha256"

v1_path = os.path.join(TA, "schema", "alerttime-teacher-sync-v1.schema.json")
schema = json.load(open(v1_path, encoding="utf-8"))

# ── v2 schema ───────────────────────────────────────────────────────────
v2 = json.loads(json.dumps(schema))
v2["$id"] = "https://teacher-agent.local/schemas/alerttime-teacher-sync-v2.schema.json"
v2["title"] = "alerttime-teacher-sync v2"
v2["description"] = ("AlertTime <-> TeacherAgent LAN sync protocol, schemaVersion 2: "
                     "snapshot payload gains optional focusAggregates (end-side focus features for FB-BKT). "
                     "Both repositories keep an identical copy.")
for prop in v2["properties"].values():
    if isinstance(prop, dict) and prop.get("const") == 1:
        prop["const"] = 2
v2["properties"]["schemaVersion"] = {"const": 2}
caps = v2["properties"].get("protocolCapabilities")
if isinstance(caps, dict) and "properties" in caps:
    caps["properties"]["fullSnapshotV2"] = {"const": True}

v2["$defs"]["focusAggregateEntry"] = {
    "type": "object",
    "properties": {
        "subjectTempId": {"type": "integer", "minimum": 0, "maximum": 4999},
        "rFocus": {"type": "number", "minimum": 0, "maximum": 1},
        "nDistract": {"type": "integer", "minimum": 0},
        "windowDays": {"type": "integer", "minimum": 1, "maximum": 365},
    },
    "required": ["subjectTempId", "rFocus", "nDistract"],
    "additionalProperties": False,
}
v2["$defs"]["focusAggregates"] = {
    "type": "object",
    "properties": {
        "perSubject": {
            "type": "array",
            "items": {"$ref": "#/$defs/focusAggregateEntry"},
            "maxItems": 5000,
        }
    },
    "required": ["perSubject"],
    "additionalProperties": False,
}
v2["$defs"]["snapshotPayload"]["properties"]["focusAggregates"] = {"$ref": "#/$defs/focusAggregates"}

v2_path = os.path.join(TA, "schema", "alerttime-teacher-sync-v2.schema.json")
with open(v2_path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(v2, f, ensure_ascii=False, indent=2, sort_keys=False)
    f.write("\n")

# ── 6 个 v2 夹具 ────────────────────────────────────────────────────────
base = json.load(open(os.path.join(TA, "fixtures", "snapshot-valid.json"), encoding="utf-8"))

def v2_envelope(**overrides):
    env = json.loads(json.dumps(base))
    env["schemaVersion"] = 2
    env.pop("futureUnknownField", None)
    env["protocolCapabilities"] = {"fullSnapshotV1": True, "fullSnapshotV2": True, "proposalsV1": True}
    env["payload"].pop("focusAggregates", None)
    for key, value in overrides.items():
        env[key] = value
    return env

fixtures = {}

# 1) 合法 v2：两条聚合特征，分别指向下标 0 / 1
valid = v2_envelope()
valid["payload"]["focusAggregates"] = {
    "perSubject": [
        {"subjectTempId": 0, "rFocus": 0.813, "nDistract": 3, "windowDays": 7},
        {"subjectTempId": 1, "rFocus": 0.55, "nDistract": 0, "windowDays": 7},
    ]
}
fixtures["snapshot-v2-valid.json"] = valid

# 2) 合法但聚合为空（v2 客户端还没攒够会话）
empty = v2_envelope()
empty["payload"]["focusAggregates"] = {"perSubject": []}
fixtures["snapshot-v2-empty-focus-aggregates.json"] = empty

# 3) rFocus 越界
bad_focus = v2_envelope()
bad_focus["payload"]["focusAggregates"] = {
    "perSubject": [{"subjectTempId": 0, "rFocus": 1.5, "nDistract": 0, "windowDays": 7}]
}
fixtures["snapshot-v2-rfocus-out-of-range.json"] = bad_focus

# 4) nDistract 为负
bad_distract = v2_envelope()
bad_distract["payload"]["focusAggregates"] = {
    "perSubject": [{"subjectTempId": 0, "rFocus": 0.5, "nDistract": -1, "windowDays": 7}]
}
fixtures["snapshot-v2-ndistract-negative.json"] = bad_distract

# 5) subjectTempId 越界（解引用不到任何 subject）
bad_index = v2_envelope()
bad_index["payload"]["focusAggregates"] = {
    "perSubject": [{"subjectTempId": 99, "rFocus": 0.7, "nDistract": 1, "windowDays": 7}]
}
fixtures["snapshot-v2-subject-temp-id-out-of-range.json"] = bad_index

# 6) 版本错配：schemaVersion 仍是 1，却携带 v2 字段（v1 payload 不允许该字段）
mismatch = v2_envelope()
mismatch["schemaVersion"] = 1
mismatch["payload"]["focusAggregates"] = {
    "perSubject": [{"subjectTempId": 0, "rFocus": 0.6, "nDistract": 1, "windowDays": 7}]
}
fixtures["snapshot-v2-version-mismatch.json"] = mismatch

for name, data in fixtures.items():
    with open(os.path.join(TA, "fixtures", name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote fixture", name)

# ── SHA256SUMS 重新生成（按文件名排序，格式与既有清单一致） ──────────────
def rebuild_sums(directory):
    sums_path = os.path.join(directory, "SHA256SUMS")
    names = sorted(
        entry.name for entry in os.scandir(directory)
        if entry.is_file() and entry.name != "SHA256SUMS"
    )
    lines = []
    for name in names:
        digest = hashlib.sha256(open(os.path.join(directory, name), "rb").read()).hexdigest()
        lines.append(f"{digest}  {name}")
    with open(sums_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    return names

names = rebuild_sums(os.path.join(TA, "fixtures"))
print("SHA256SUMS entries:", len(names))

# ── 镜像到 AlertTime 仓库（schema + fixtures 逐字一致） ──────────────────
os.makedirs(os.path.join(AT, "schema"), exist_ok=True)
os.makedirs(os.path.join(AT, "fixtures"), exist_ok=True)
for rel in [os.path.join("schema", os.path.basename(v2_path))]:
    shutil.copyfile(os.path.join(TA, rel), os.path.join(AT, rel))
    print("mirrored", rel)
for name in names + ["SHA256SUMS"]:
    shutil.copyfile(os.path.join(TA, "fixtures", name), os.path.join(AT, "fixtures", name))
print("mirrored fixtures:", len(names) + 1)
