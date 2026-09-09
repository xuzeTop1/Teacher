#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AlertTime <-> TeacherAgent 局域网同步：投稿前实机基准测试脚本

测量三类数据（对应论文占位段落）：
  1. pairing  扫码配对 → 快照确认的端到端耗时。
              「扫码」在服务端视角即 POST /v1/pair（手机解析二维码后发起
              配对请求），「快照确认」即 POST /v1/snapshots 收到 snapshotAck。
              默认重复 10 轮，报告每步与端到端的均值/最大值/P95。
  2. scale    不同数据规模（1 个月 / 6 个月记录）下快照体积（压缩前 JSON
              字节数与 gzip 后传输字节数）与上报耗时（请求发出→收到 ack）。
  3. proposal 建议稿「生成 → 拉取 → 采纳 → 确认」完整链路：
              生成 = 桌面端 sync_proposals 出现 pending 行（默认等你在 UI 上
              点「生成建议稿」；--insert-proposal 可直接落库测纯传输）；
              拉取/采纳 = 脚本以合成手机端身份走真实 HTTP 协议；
              确认 = 轮询到 status 变为 accepted。
              每个阶段自动截图（桌面全屏；若 adb 可用同时抓手机屏），图号
              即论文图 5 的四联图。

用法示例：
  python sync-benchmark.py --host 10.248.148.58 all
  python sync-benchmark.py --host 10.248.148.58 pairing --rounds 10
  python sync-benchmark.py --host 10.248.148.58 scale --months 1 6 --repeats 3
  python sync-benchmark.py --host 10.248.148.58 proposal --wait-generate 300

说明与口径：
  * 脚本是「合成手机端」：直接说 v1 同步协议（与 AlertTime 相同的请求），
    不经过手机 UI；因此测得的是网络 + 服务端处理耗时，真人扫码/点击的
    UI 操作时间不在此列（论文中应表述为「协议链路耗时」）。
  * 配对 token 由脚本直接写入桌面端 SQLite（与 UI 生成二维码时同一张表、
    同一哈希口径），因此无需人工生成二维码。
  * 服务端为自签名 TLS 证书（rcgen），脚本跳过证书校验；每轮结束通过
    /v1/unpair 撤销基准设备，保持设备列表干净（proposal 模式除外，便于
    桌面端 UI 展示「已采纳」截图）。
  * 快照不含 learningAnalysis 字段（协议明确兼容旧版客户端）；学习分析
    体积约 10 KB，对 1/6 个月数据规模结论无影响。
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import random
import shutil
import socket
import sqlite3
import statistics
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

PROTOCOL_FORMAT = "alerttime-teacher-sync"
SCHEMA_VERSION = 1
APP_VERSION = "sync-benchmark/1.0"
DEFAULT_DB = r"C:\Users\Acer\AppData\Roaming\com.teacheragent.app\teacher_agent.sqlite3"
DEFAULT_PORT = 8787
DAY_MS = 24 * 3600 * 1000


def now_ms() -> int:
    return int(time.time() * 1000)


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(time.time()*1000)%1000:03d}Z"


# ── HTTP 客户端（自签名证书，跳过校验） ─────────────────────────────────

class SyncClient:
    def __init__(self, host: str, port: int, timeout_s: float = 60.0):
        import ssl
        self.base = f"https://{host}:{port}"
        self.ctx = ssl.create_default_context()
        self.ctx.check_hostname = False
        self.ctx.verify_mode = ssl.CERT_NONE
        self.timeout_s = timeout_s

    def request(self, method: str, path: str, body: dict | None = None,
                credential: str | None = None) -> tuple[float, int, dict]:
        """返回 (耗时ms, HTTP状态码, 响应JSON)。耗时 = 请求发出到读完整响应。"""
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else b"{}"
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if credential:
            req.add_header("Authorization", f"Bearer {credential}")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s, context=self.ctx) as resp:
                status, payload = resp.status, resp.read()
        except urllib.error.HTTPError as e:
            status, payload = e.code, e.read()
        elapsed_ms = (time.monotonic() - t0) * 1000.0
        try:
            parsed = json.loads(payload.decode("utf-8")) if payload else {}
        except Exception:
            parsed = {"_raw": payload[:400].decode("utf-8", "replace")}
        return elapsed_ms, status, parsed

    def health(self) -> bool:
        try:
            _, status, body = self.request("GET", "/v1/health")
            if status != 200:
                return False
            # /v1/health 返回裸 payload（不套信封），兼容两种形态。
            payload = body.get("payload") if isinstance(body.get("payload"), dict) else body
            return payload.get("service") == "teacher-agent-sync"
        except Exception:
            return False

    def envelope(self, message_type: str, device_id: str, payload: dict,
                 snapshot_id: str | None = None) -> dict:
        return {
            "format": PROTOCOL_FORMAT,
            "schemaVersion": SCHEMA_VERSION,
            "messageType": message_type,
            "deviceId": device_id,
            "snapshotId": snapshot_id,
            "generatedAt": now_ms(),
            "appVersion": APP_VERSION,
            "protocolCapabilities": None,
            "cursor": None,
            "payload": payload,
        }

    def pair(self, device_id: str, token: str, owner_identity: str | None) -> tuple[float, str]:
        payload = {"token": token, "deviceId": device_id}
        if owner_identity:
            payload["ownerIdentity"] = owner_identity
        elapsed, status, body = self.request("POST", "/v1/pair", self.envelope("pair", device_id, payload))
        if status != 200:
            raise RuntimeError(f"pair 失败 HTTP {status}: {json.dumps(body, ensure_ascii=False)[:300]}")
        return elapsed, body["payload"]["credential"]

    def push_snapshot(self, device_id: str, credential: str, snapshot_payload: dict) -> tuple[float, str, int]:
        snapshot_id = str(uuid.uuid4())
        body = self.envelope("snapshot", device_id, snapshot_payload, snapshot_id=snapshot_id)
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elapsed, status, resp = self.request("POST", "/v1/snapshots", body, credential)
        if status != 200:
            raise RuntimeError(f"snapshot 失败 HTTP {status}: {json.dumps(resp, ensure_ascii=False)[:300]}")
        return elapsed, snapshot_id, len(raw)

    def pull_proposals(self, device_id: str, credential: str) -> tuple[float, list]:
        elapsed, status, resp = self.request("GET", "/v1/proposals", None, credential)
        if status != 200:
            raise RuntimeError(f"proposals 失败 HTTP {status}: {json.dumps(resp, ensure_ascii=False)[:300]}")
        return elapsed, resp["payload"]["proposals"]

    def decide(self, device_id: str, credential: str, proposal_id: str, decision: str) -> tuple[float, dict]:
        body = self.envelope("proposalDecision", device_id, {
            "proposalId": proposal_id, "decision": decision, "decidedAt": now_ms()})
        elapsed, status, resp = self.request("POST", "/v1/proposal-decisions", body, credential)
        if status != 200:
            raise RuntimeError(f"decision 失败 HTTP {status}: {json.dumps(resp, ensure_ascii=False)[:300]}")
        return elapsed, resp["payload"]

    def unpair(self, credential: str) -> None:
        try:
            self.request("POST", "/v1/unpair", None, credential)
        except Exception as e:
            print(f"  [warn] unpair 失败（不影响测量结果）: {e}")


# ── 桌面端 SQLite（与运行中的 App 并发访问） ────────────────────────────

class DesktopDb:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path, timeout=15.0)
        self.conn.execute("PRAGMA busy_timeout=15000")

    def issue_pairing_token(self, device_id: str, ttl_ms: int = 600_000) -> str:
        token = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii").rstrip("=")
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_pairing_tokens (token_hash, device_id, expires_at, used_at, created_at)"
            " VALUES (?,?,?,NULL,?)",
            (token_hash, device_id, now_ms() + ttl_ms, iso_now()))
        self.conn.commit()
        return token

    def insert_proposal(self, device_id: str, rationale: str,
                        goals: list, tasks: list, source_ids: list,
                        expires_at: int | None = None) -> str:
        proposal_id = str(uuid.uuid4())
        created = now_ms()
        self.conn.execute(
            "UPDATE sync_proposals SET status='superseded', decided_at=COALESCE(decided_at, ?)"
            " WHERE device_id=? AND status='pending'", (created, device_id))
        self.conn.execute(
            "INSERT INTO sync_proposals (id, device_id, version, status, rationale, payload_json,"
            " source_assessment_ids_json, created_at, expires_at) VALUES (?,?,1,'pending',?,?,?,?,?)",
            (proposal_id, device_id, rationale,
             json.dumps({"proposedWeeklyGoals": goals, "proposedTasks": tasks}, ensure_ascii=False),
             json.dumps(source_ids), created, expires_at))
        self.conn.commit()
        return proposal_id, created

    def wait_pending_proposal(self, device_id: str, timeout_s: float) -> tuple[str, int] | None:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            row = self.conn.execute(
                "SELECT id, created_at FROM sync_proposals WHERE device_id=? AND status='pending'"
                " ORDER BY created_at DESC LIMIT 1", (device_id,)).fetchone()
            if row:
                return row
            time.sleep(0.25)
        return None

    def poll_status(self, proposal_id: str, expected: str, timeout_s: float) -> bool:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            row = self.conn.execute("SELECT status FROM sync_proposals WHERE id=?", (proposal_id,)).fetchone()
            if row and row[0] == expected:
                return True
            time.sleep(0.1)
        return False

    def device_owner(self, device_id: str) -> str | None:
        row = self.conn.execute("SELECT owner_identity FROM sync_devices WHERE id=?", (device_id,)).fetchone()
        return row[0] if row else None


# ── 合成数据 ─────────────────────────────────────────────────────────────

def build_snapshot(months: float, rng: random.Random) -> dict:
    """按日活近似真实结构：13 科目、每周 1 目标、每天 ~4 任务、~5 会话。"""
    now = now_ms()
    subject_ids = [str(uuid.UUID(int=rng.getrandbits(128), version=4)) for _ in range(13)]
    subjects = [{
        "remoteId": sid, "name": f"科目{i:02d}", "color": "#4CAF50", "icon": None,
        "sortOrder": i, "isArchived": False,
        "createdAt": now - int(months) * 30 * DAY_MS, "updatedAt": now, "deletedAt": None,
        "examTrackId": None, "examSubjectId": None, "examModuleId": None,
    } for i, sid in enumerate(subject_ids)]

    weekly_goals = []
    weeks = max(1, int(months * 30 / 7))
    for w in range(weeks):
        week_start = now - (weeks - w) * 7 * DAY_MS
        weekly_goals.append({
            "remoteId": str(uuid.UUID(int=rng.getrandbits(128), version=4)),
            "weekStart": week_start, "title": f"第{w + 1}周目标：完成既定复习任务",
            "successCriteria": "诊断正确率 ≥ 80%", "sourceProposalId": None,
            "status": 2 if w < weeks - 1 else 0,
            "completedAt": week_start + 5 * DAY_MS if w < weeks - 1 else None,
            "deferredToWeekStart": None, "exceptionReason": None,
            "createdAt": week_start, "updatedAt": week_start + 5 * DAY_MS, "deletedAt": None,
        })

    days = max(1, int(months * 30))
    tasks, sessions = [], []
    for d in range(days):
        day0 = now - (days - d) * DAY_MS
        for t in range(4):
            task_id = str(uuid.UUID(int=rng.getrandbits(128), version=4))
            done = d < days - 1
            tasks.append({
                "remoteId": task_id, "subjectRemoteId": subject_ids[(d + t) % 13],
                "title": f"练习单元 {d:03d}-{t}", "content": "合成基准数据：教材复习与习题。" * 6,
                "sourceProposalId": None, "type": 1, "priority": t % 3,
                "status": 2 if done else 0, "targetDurationSeconds": 2700,
                "dueAt": day0 + (t + 1) * 3000_000, "completedAt": day0 + 7 * 3600_000 if done else None,
                "sortOrder": t, "createdAt": day0, "updatedAt": day0 + 8 * 3600_000 if done else day0,
                "deletedAt": None,
            })
            for s in range(5):
                sessions.append({
                    "remoteId": str(uuid.UUID(int=rng.getrandbits(128), version=4)),
                    "subjectRemoteId": subject_ids[(d + t + s) % 13], "taskRemoteId": task_id,
                    "title": f"专注会话 {d:03d}-{t}-{s}",
                    "startTime": day0 + (s + 9) * 3600_000,
                    "endTime": day0 + (s + 10) * 3600_000,
                    "durationSeconds": 3000 + rng.randrange(1200), "pauseSeconds": rng.randrange(120),
                    "focusScore": 3 + rng.randrange(2), "note": None, "status": 2,
                    "createdAt": day0 + (s + 10) * 3600_000, "updatedAt": day0 + (s + 10) * 3600_000,
                    "deletedAt": None, "aiHelpSeconds": rng.randrange(300),
                    "aiHelpCount": rng.randrange(3), "externalAiAppSeconds": None,
                })
    return {"subjects": subjects, "weeklyGoals": weekly_goals, "tasks": tasks,
            "studySessions": sessions}


def build_snapshot_counts(total: int, rng: random.Random) -> dict:
    """按「快照实体总条数」构造规模。build_snapshot 每天生成 4 任务 + 20 会话
    （会话嵌套在任务循环内，5/任务）+ 每周 1 目标 + 固定 13 科目：
    total ≈ 13 + days × (4 + 20 + 1/7)。"""
    days = max(1, round((total - 13) / (24 + 1 / 7)))
    return build_snapshot(months=days / 30.0, rng=rng)


# ── 截图 ─────────────────────────────────────────────────────────────────

def capture_desktop(path: str) -> bool:
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
        "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;"
        "$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height);"
        "$g=[System.Drawing.Graphics]::FromImage($bmp);"
        "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);"
        f"$bmp.Save('{path}',[System.Drawing.Imaging.ImageFormat]::Png);"
        "$g.Dispose();$bmp.Dispose()"
    )
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                           capture_output=True, timeout=20)
        return r.returncode == 0 and os.path.isfile(path)
    except Exception:
        return False


def capture_phone(path: str) -> bool:
    adb = shutil.which("adb")
    if not adb:
        return False
    try:
        r = subprocess.run([adb, "exec-out", "screencap", "-p"], capture_output=True, timeout=20)
        if r.returncode == 0 and r.stdout[:4] == b"\x89PNG":
            with open(path, "wb") as f:
                f.write(r.stdout)
            return True
    except Exception:
        pass
    return False


# ── 统计输出 ─────────────────────────────────────────────────────────────

def summarize(values: list[float]) -> dict:
    s = sorted(values)
    p95 = s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))]
    return {"n": len(s), "meanMs": round(statistics.fmean(s), 1),
            "maxMs": round(s[-1], 1), "p95Ms": round(p95, 1)}


def print_table(title: str, rows: list[dict]) -> None:
    print(f"\n== {title} ==")
    for row in rows:
        print("  " + json.dumps(row, ensure_ascii=False))


# ── 模式 1：配对 → 快照端到端 ───────────────────────────────────────────

def mode_pairing(client: SyncClient, db: DesktopDb, out_dir: str,
                 rounds: int, owner_identity: str | None) -> dict:
    print(f"[pairing] {rounds} 轮：pair(扫码) → 首次快照 ack(确认)，每轮结束自动撤销设备")
    rows = []
    for i in range(1, rounds + 1):
        device_id = str(uuid.uuid4())
        token = db.issue_pairing_token(device_id)
        t_pair, credential = client.pair(device_id, token, owner_identity)
        small = build_snapshot(months=0.25, rng=random.Random(i))
        t_snap, snapshot_id, size = client.push_snapshot(device_id, credential, small)
        client.unpair(credential)
        e2e = t_pair + t_snap
        rows.append({"round": i, "pairMs": round(t_pair, 1), "snapshotMs": round(t_snap, 1),
                     "e2eMs": round(e2e, 1), "snapshotBytes": size})
        print(f"  round {i:2d}: pair {t_pair:7.1f} ms | snapshot {t_snap:7.1f} ms | e2e {e2e:7.1f} ms")
    stats = {"pair": summarize([r["pairMs"] for r in rows]),
             "snapshot": summarize([r["snapshotMs"] for r in rows]),
             "e2e": summarize([r["e2eMs"] for r in rows])}
    csv_path = os.path.join(out_dir, "pairing.csv")
    with open(csv_path, "w", encoding="utf-8-sig") as f:  # BOM：Excel 正确识别 UTF-8 中文
        f.write("round,pairMs,snapshotMs,e2eMs,snapshotBytes\n")
        for r in rows:
            f.write(f"{r['round']},{r['pairMs']},{r['snapshotMs']},{r['e2eMs']},{r['snapshotBytes']}\n")
    print_table("pairing 统计 (ms)", [stats])
    return {"mode": "pairing", "rounds": rounds, "stats": stats, "rows": rows, "csv": csv_path}


# ── 模式 2：数据规模 → 体积与上报耗时 ───────────────────────────────────

def mode_scale(client: SyncClient, db: DesktopDb, out_dir: str,
               months_list: list[float], repeats: int, owner_identity: str | None,
               counts_list: list[int] | None = None) -> dict:
    device_id = str(uuid.uuid4())
    token = db.issue_pairing_token(device_id)
    _, credential = client.pair(device_id, token, owner_identity)
    if counts_list:
        plan = [(f"{c}条", lambda c=c: build_snapshot_counts(c, random.Random(42))) for c in counts_list]
    else:
        plan = [(f"{m}月", lambda m=m: build_snapshot(months=m, rng=random.Random(42))) for m in months_list]
    label0 = "实体总条数" if counts_list else "数据规模(月)"
    print(f"[scale] 基准设备 {device_id[:8]}；规模 {label0} {[p[0] for p in plan]}，各重复 {repeats} 次")
    rows = []
    for label, builder in plan:
        payload = builder()
        body = client.envelope("snapshot", device_id, payload)
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        gz = gzip.compress(raw, 6)
        times = []
        k = 0
        while k < repeats:
            try:
                t, _, _ = client.push_snapshot(device_id, credential, payload)
            except Exception as error:
                # 瞬时连接错误（如 TLS EOF）不污染统计：重试同一轮，只记录成功轮。
                print(f"  {label} 第 {k + 1} 轮连接异常，重试: {error}")
                continue
            times.append(t)
            k += 1
            print(f"  {label} ×{k}: {t:8.1f} ms")
        counts = {key: len(payload[key]) for key in ("subjects", "weeklyGoals", "tasks", "studySessions")}
        total = sum(counts.values())
        rows.append({"scale": label, "totalEntities": total, "entities": counts,
                     "jsonBytes": len(raw), "gzipBytes": len(gz), "upload": summarize(times),
                     "successRate": 100.0 if all(t > 0 for t in times) else None})
    client.unpair(credential)
    csv_path = os.path.join(out_dir, "scale.csv")
    with open(csv_path, "w", encoding="utf-8-sig") as f:  # BOM：Excel 正确识别 UTF-8 中文
        f.write("scale,totalEntities,subjects,goals,tasks,sessions,jsonBytes,gzipBytes,meanMs,maxMs,p95Ms\n")
        for r in rows:
            e = r["entities"]
            f.write(f"{r['scale']},{r['totalEntities']},{e['subjects']},{e['weeklyGoals']},{e['tasks']},"
                    f"{e['studySessions']},{r['jsonBytes']},{r['gzipBytes']},{r['upload']['meanMs']},"
                    f"{r['upload']['maxMs']},{r['upload']['p95Ms']}\n")
    print_table("scale 统计", rows)
    return {"mode": "scale", "rows": rows, "csv": csv_path}


# ── 模式 3：建议稿完整链路 + 图5截图 ────────────────────────────────────

def mode_proposal(client: SyncClient, db: DesktopDb, out_dir: str,
                  wait_generate_s: float, insert_proposal: bool,
                  owner_identity: str | None) -> dict:
    device_id = str(uuid.uuid4())
    token = db.issue_pairing_token(device_id)
    _, credential = client.pair(device_id, token, owner_identity)
    client.push_snapshot(device_id, credential, build_snapshot(months=0.25, rng=random.Random(7)))
    print(f"[proposal] 基准设备 {device_id[:8]}（本轮结束后请在桌面端 UI 手动撤销）")

    stage = {}
    if insert_proposal:
        proposal_id, created_at = db.insert_proposal(
            device_id, "基准测试：合成建议稿用于链路计时。",
            [{"weekStart": now_ms(), "title": "完成基准复习", "successCriteria": "正确率≥80%"}],
            [{"title": "基准任务：完成 20 道练习题", "targetDurationSeconds": 1800, "dueAt": now_ms() + DAY_MS}],
            [])
        print(f"  已直接落库 proposal {proposal_id[:8]}（--insert-proposal，纯传输口径）")
    else:
        print("  请在桌面端「AlertTime 同步」页选择该设备并点击「生成建议稿」…")
        got = db.wait_pending_proposal(device_id, wait_generate_s)
        if not got:
            raise RuntimeError(f"{wait_generate_s}s 内未检测到 pending 建议稿。"
                               "可改用 --insert-proposal 测纯传输链路。")
        proposal_id, created_at = got
    stage["generateDetectedMs"] = now_ms()
    shot = os.path.join(out_dir, "fig5-1-desktop-generated.png")
    stage["screenshotGenerated"] = shot if capture_desktop(shot) else None

    t_pull, proposals = client.pull_proposals(device_id, credential)
    found = any(p["proposalId"] == proposal_id for p in proposals)
    print(f"  拉取: {t_pull:.1f} ms, 含目标建议稿={found}")
    stage["pullMs"] = round(t_pull, 1)
    stage["pullContainsProposal"] = found
    shot = os.path.join(out_dir, "fig5-2-desktop-pulled.png")
    if shutil.which("adb"):
        capture_phone(os.path.join(out_dir, "fig5-2-phone-pending.png"))
    stage["screenshotPulled"] = shot if capture_desktop(shot) else None

    t_decide, ack = client.decide(device_id, credential, proposal_id, "accepted")
    post_done = now_ms()
    print(f"  采纳(POST): {t_decide:.1f} ms, recorded={ack.get('recorded')}")
    stage["decideMs"] = round(t_decide, 1)
    confirmed = db.poll_status(proposal_id, "accepted", 30.0)
    stage["confirmDetectLatencyMs"] = now_ms() - post_done
    print(f"  确认: status=accepted 检测于 {stage['confirmDetectLatencyMs']} ms 后 (轮询粒度100ms)")
    shot = os.path.join(out_dir, "fig5-3-desktop-accepted.png")
    if shutil.which("adb"):
        capture_phone(os.path.join(out_dir, "fig5-3-phone-accepted.png"))
    stage["screenshotAccepted"] = shot if capture_desktop(shot) else None
    if not confirmed:
        stage["warning"] = "30s 内未观察到 accepted 状态，请检查桌面端服务日志"
    return {"mode": "proposal", "deviceId": device_id, "proposalId": proposal_id,
            "createdAtMs": created_at, "stages": stage}


# ── 模式 4：真实手机链路观察（图5 实机四联图） ─────────────────────────

def mode_observe(client: SyncClient, db: DesktopDb, out_dir: str, timeout_s: float) -> dict:
    """不注入任何数据：观察真实手机走「生成→拉取→采纳→确认」，DB 轮询 + 截图。

    流程：你在桌面端点「生成建议稿」→ 脚本捕获桌面图；提示你在手机上点
    「立即同步」查看建议稿 → 脚本抓手机图；你在手机点「采纳」→ 脚本轮询到
    accepted 后抓桌面确认图。拉取动作本身不落库，故拉取耗时以手机侧日志为准，
    脚本给出「生成→采纳落库」「决策→桌面可见」两段可测耗时。"""
    print("[observe] 只读观察真实链路。请在桌面端对真实设备点击「生成建议稿」…")
    start_ms = now_ms()
    deadline = time.monotonic() + timeout_s
    proposal = None
    while time.monotonic() < deadline:
        row = db.conn.execute(
            "SELECT id, device_id, created_at FROM sync_proposals"
            " WHERE status='pending' AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
            (start_ms,)).fetchone()
        if row:
            proposal = row
            break
        time.sleep(0.5)
    if not proposal:
        raise RuntimeError(f"{timeout_s}s 内未检测到新生成的 pending 建议稿")
    proposal_id, device_id, created_at = proposal
    print(f"  检测到建议稿 {proposal_id[:8]}（设备 {device_id[:8]}, created_at={created_at}）")
    shot = os.path.join(out_dir, "fig5-1-desktop-generated.png")
    capture_desktop(shot)

    print("  请在手机上点击「立即同步」，等建议稿显示后按回车抓手机截图…")
    input()
    shot_phone_pending = os.path.join(out_dir, "fig5-2-phone-pending.png")
    print(f"  手机截图: {'成功' if capture_phone(shot_phone_pending) else '失败(adb 不可用)'}")

    print("  请在手机上点击「采纳」，脚本正在等待桌面端确认…")
    t_decide_wait = now_ms()
    confirmed = db.poll_status(proposal_id, "accepted", 120.0)
    row = db.conn.execute(
        "SELECT d.decided_at FROM sync_proposal_decisions d WHERE d.proposal_id=?",
        (proposal_id,)).fetchone()
    decided_at = row[0] if row else None
    stage = {
        "proposalId": proposal_id, "deviceId": device_id, "createdAtMs": created_at,
        "decidedAtMs": decided_at,
        "generateToDecisionMs": (decided_at - created_at) if decided_at else None,
        "decisionToDesktopVisibleMs": (now_ms() - decided_at) if decided_at else None,
        "confirmed": confirmed,
        "note": "generateToDecision 含真人操作时间；decisionToDesktopVisible 为服务端处理+轮询(100ms粒度)；手机/桌面时钟可能有偏差",
    }
    capture_desktop(os.path.join(out_dir, "fig5-3-desktop-accepted.png"))
    capture_phone(os.path.join(out_dir, "fig5-4-phone-accepted.png"))
    print_table("observe 统计", [stage])
    return {"mode": "observe", "stages": stage}


# ── 模式 5：协议鲁棒性（表 5） ──────────────────────────────────────────

def mode_robustness(client: SyncClient, db: DesktopDb, out_dir: str,
                    owner_identity: str | None) -> dict:
    """对运行中的同步服务构造异常输入，统计「正确拒绝 / 漏放 / 误拒」。

    限流预算：pairing 失败 2 次、auth 失败 4 次，均低于 10 次/15min 阈值。"""
    device_id = str(uuid.uuid4())
    token = db.issue_pairing_token(device_id)
    _, credential = client.pair(device_id, token, owner_identity)
    small = build_snapshot(months=0.1, rng=random.Random(9))
    counts = {k: len(small[k]) for k in ("subjects", "weeklyGoals", "tasks", "studySessions")}
    total = sum(counts.values())
    results = []

    def check(name, expect_reject, status, note=""):
        accepted = 200 <= status < 300
        if expect_reject and not accepted:
            verdict = "correct_rejection"
        elif expect_reject and accepted:
            verdict = "MISSED"
        elif not expect_reject and accepted:
            verdict = "correct_accept"
        else:
            verdict = "WRONG_REJECTION"
        results.append({"case": name, "expect": "reject" if expect_reject else "accept",
                        "status": status, "verdict": verdict, "note": note})
        print(f"  {name:38s} HTTP {status:3d}  {verdict}")

    # —— 正常基线（期望接受）——
    _, st, _ = client.request("GET", "/v1/health")
    check("health_baseline", False, st)

    # —— 信封校验类（期望 400）——
    def pair_envelope(**over):
        env = client.envelope("pair", device_id, {"token": "unused", "deviceId": device_id})
        env.update(over)
        return env

    env = pair_envelope(); del env["format"]
    st = client.request("POST", "/v1/pair", env)[1]; check("pair_missing_format", True, st)
    st = client.request("POST", "/v1/pair", pair_envelope(schemaVersion=99))[1]
    check("pair_bad_schema_version", True, st)
    st = client.request("POST", "/v1/pair", pair_envelope(messageType="snapshot"))[1]
    check("pair_wrong_message_type", True, st)
    env = pair_envelope(payload={"token": "x" * 43, "deviceId": device_id})
    st = client.request("POST", "/v1/pair", env)[1]
    check("pair_invalid_token", True, st)
    other = str(uuid.uuid4())
    env = client.envelope("pair", other, {"token": token, "deviceId": other})
    st = client.request("POST", "/v1/pair", env)[1]
    check("pair_token_device_mismatch", True, st)

    # —— 鉴权与归属（期望 401/403）——
    env = client.envelope("snapshot", device_id, small, snapshot_id=str(uuid.uuid4()))
    st = client.request("POST", "/v1/snapshots", env)[1]
    check("snapshot_missing_credential", True, st)
    st = client.request("POST", "/v1/snapshots", env, credential="forged-credential")[1]
    check("snapshot_invalid_credential", True, st)
    env2 = client.envelope("snapshot", str(uuid.uuid4()), small, snapshot_id=str(uuid.uuid4()))
    st = client.request("POST", "/v1/snapshots", env2, credential)[1]
    check("snapshot_device_id_mismatch", True, st, "envelope deviceId ≠ 凭据设备")

    # —— 载荷合法性（期望 400/422）——
    st = client.request("POST", "/v1/snapshots",
                        client.envelope("snapshot", device_id, small, snapshot_id="short"), credential)[1]
    check("snapshot_bad_snapshot_id", True, st)
    oversized = {"subjects": small["subjects"], "weeklyGoals": [], "tasks": [],
                 "studySessions": [dict(s, note="x" * 9_000_000) for s in
                                   [small["studySessions"][0] if small["studySessions"] else
                                    {"remoteId": str(uuid.uuid4()), "startTime": 1, "endTime": 2,
                                     "durationSeconds": 1, "pauseSeconds": 0, "status": 2,
                                     "createdAt": 1, "updatedAt": 1}]]}
    st = client.request("POST", "/v1/snapshots",
                        client.envelope("snapshot", device_id, oversized), credential)[1]
    check("snapshot_oversized_body_8MiB", True, st)

    # —— 幂等重发（期望接受，且计数回传一致）——
    fixed_sid = str(uuid.uuid4())
    _, st1, r1 = client.request("POST", "/v1/snapshots",
                                client.envelope("snapshot", device_id, small, snapshot_id=fixed_sid), credential)
    _, st2, r2 = client.request("POST", "/v1/snapshots",
                                client.envelope("snapshot", device_id, small, snapshot_id=fixed_sid), credential)
    echo = r2.get("payload", {}).get("entityCounts", {})
    expect_echo = {"subjects": counts["subjects"], "weeklyGoals": counts["weeklyGoals"],
                   "tasks": counts["tasks"], "studySessions": counts["studySessions"]}
    check("snapshot_duplicate_idempotent_replay", False, st2,
          f"首次 {st1}；计数回传 {'一致' if echo == expect_echo else f'不一致 {echo}'}")

    # —— 决策端点 ——
    st = client.request("POST", "/v1/proposal-decisions",
                        client.envelope("proposalDecision", device_id,
                                        {"proposalId": str(uuid.uuid4()), "decision": "accepted",
                                         "decidedAt": now_ms()}), credential)[1]
    check("decision_unknown_proposal", True, st, "期望 404")
    st = client.request("POST", "/v1/proposal-decisions",
                        client.envelope("snapshot", device_id, {}), credential)[1]
    check("decision_wrong_message_type", True, st)

    # —— 撤销后凭据失效（期望 401）——
    client.unpair(credential)
    st = client.request("POST", "/v1/snapshots",
                        client.envelope("snapshot", device_id, small, snapshot_id=str(uuid.uuid4())), credential)[1]
    check("revoked_credential_after_unpair", True, st)

    n_reject_expected = sum(1 for r in results if r["expect"] == "reject")
    n_correct = sum(1 for r in results if r["verdict"] in ("correct_rejection", "correct_accept"))
    n_missed = sum(1 for r in results if r["verdict"] == "MISSED")
    n_wrong = sum(1 for r in results if r["verdict"] == "WRONG_REJECTION")
    summary = {"totalCases": len(results), "rejectExpected": n_reject_expected,
               "correct": n_correct, "missed": n_missed, "wrongRejections": n_wrong,
               "snapshotEntities": total}
    csv_path = os.path.join(out_dir, "robustness.csv")
    with open(csv_path, "w", encoding="utf-8-sig") as f:  # BOM：Excel 正确识别 UTF-8 中文
        f.write("case,expect,status,verdict,note\n")
        for r in results:
            f.write(f"{r['case']},{r['expect']},{r['status']},{r['verdict']},\"{r['note']}\"\n")
    print_table("robustness 汇总", [summary])
    return {"mode": "robustness", "summary": summary, "cases": results, "csv": csv_path}


# ── host 发现与主流程 ───────────────────────────────────────────────────

def discover_hosts() -> list[str]:
    hosts = ["127.0.0.1"]
    try:
        ps = "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress"
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                           capture_output=True, timeout=20, text=True)
        hosts += [line.strip() for line in r.stdout.splitlines() if line.strip()]
    except Exception:
        pass
    seen, out = set(), []
    for h in hosts:
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out


def pick_client(args) -> SyncClient:
    candidates = [args.host] if args.host else discover_hosts()
    for host in candidates:
        client = SyncClient(host, args.port)
        if client.health():
            print(f"[server] 同步服务在线: https://{host}:{args.port}")
            return client
    raise SystemExit("无法连接同步服务 /v1/health。请先在桌面端「AlertTime 同步」页开启局域网同步服务，"
                     "并用 --host 指定服务监听 IP（如手机 USB 共享的 10.248.x.x 本机地址）。")


def main() -> None:
    ap = argparse.ArgumentParser(description="AlertTime/TeacherAgent 同步链路基准测试（合成手机端）")
    ap.add_argument("--host", help="同步服务监听 IP（默认自动探测本机各 IPv4 上的 :port /v1/health）")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--db", default=DEFAULT_DB, help="桌面端 teacher_agent.sqlite3 路径（需可写，用于注入配对 token）")
    ap.add_argument("--owner-identity", help="pair 时携带的 ownerIdentity（uuid），用于复用已有学科映射")
    ap.add_argument("--out", default="benchmark-results", help="输出根目录")
    sub = ap.add_subparsers(dest="mode", required=True)

    p1 = sub.add_parser("pairing", help="扫码配对→快照确认端到端耗时")
    p1.add_argument("--rounds", type=int, default=10)
    p2 = sub.add_parser("scale", help="不同数据规模的快照体积与上报耗时")
    p2.add_argument("--months", type=float, nargs="+", default=[1, 6])
    p2.add_argument("--counts", type=int, nargs="+", default=None,
                    help="按快照实体总条数定规模（如 1000 2000 3000 10000），给出时忽略 --months")
    p2.add_argument("--repeats", type=int, default=3)
    p6 = sub.add_parser("robustness", help="协议鲁棒性：异常输入正确拒绝/漏放统计（表 5）")
    p3 = sub.add_parser("proposal", help="建议稿生成→拉取→采纳→确认链路 + 图5截图")
    p3.add_argument("--wait-generate", type=float, default=300.0, help="等待 UI 生成建议稿的秒数")
    p3.add_argument("--insert-proposal", action="store_true", help="跳过 UI，直接落库建议稿（纯传输口径）")
    p5 = sub.add_parser("observe", help="只读观察真实手机的完整链路并截图（图5 实机四联图）")
    p5.add_argument("--wait-generate", type=float, default=600.0)
    p4 = sub.add_parser("all", help="依次运行三种测量")
    p4.add_argument("--rounds", type=int, default=10)
    p4.add_argument("--months", type=float, nargs="+", default=[1, 6])
    p4.add_argument("--repeats", type=int, default=3)
    p4.add_argument("--wait-generate", type=float, default=300.0)
    p4.add_argument("--insert-proposal", action="store_true")
    args = ap.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(args.out, stamp)
    os.makedirs(out_dir, exist_ok=True)

    client = pick_client(args)
    db = DesktopDb(args.db)
    results = []
    if args.mode in ("pairing", "all"):
        rounds = getattr(args, "rounds", 10)
        results.append(mode_pairing(client, db, out_dir, rounds, args.owner_identity))
    if args.mode in ("scale", "all"):
        counts = getattr(args, "counts", None)
        months = [] if counts else args.months
        results.append(mode_scale(client, db, out_dir, months, args.repeats,
                                  args.owner_identity, counts_list=counts))
    if args.mode in ("proposal", "all"):
        results.append(mode_proposal(client, db, out_dir, args.wait_generate,
                                     args.insert_proposal, args.owner_identity))
    if args.mode == "observe":
        results.append(mode_observe(client, db, out_dir, args.wait_generate))
    if args.mode == "robustness":
        results.append(mode_robustness(client, db, out_dir, args.owner_identity))

    report = {"generatedAt": iso_now(), "server": client.base, "rounds": results}
    report_path = os.path.join(out_dir, "report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n[done] 报告: {report_path}")
    print(f"[done] 截图/CSV 目录: {os.path.abspath(out_dir)}")


if __name__ == "__main__":
    main()
