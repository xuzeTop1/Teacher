#!/usr/bin/env python3
"""Run the outbound-egress harness and archive its structured result.

vitest prints one `EGRESS_JSON {...}` line holding the A/B arm measurements,
the C-arm privacy-gate inventory (`gate`) and the 20-turn decomposition; this
extracts it, writes the raw measurement plus a human-readable summary, and
records the git commit the measurement describes so the artifact is traceable.
"""

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "experiments" / "privacy_egress"
TEST = "src/services/llm/outboundEgress.test.ts"

NPX = shutil.which("npx") or "npx"  # Windows resolves npx.cmd only through which()

run = subprocess.run([NPX, "vitest", "run", TEST], cwd=REPO,
                     capture_output=True, text=True, encoding="utf-8", errors="replace")
if run.returncode != 0:
    print(run.stdout[-4000:])
    print(run.stderr[-2000:], file=sys.stderr)
    raise SystemExit(f"harness failed rc={run.returncode}")

MARK = "EGRESS_JSON "
line = None
for candidate in run.stdout.splitlines():
    i = candidate.find(MARK)
    if i >= 0:
        line = candidate[i + len(MARK):]
        break
if line is None:
    print(run.stdout[-3000:])
    raise SystemExit("EGRESS_JSON marker not found -- harness output format changed")

payload = json.loads(line)
payload["git_commit"] = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO,
                                       capture_output=True, text=True).stdout.strip()
payload["captured_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
payload["harness"] = TEST

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
OUT.mkdir(parents=True, exist_ok=True)
(OUT / f"egress-{stamp}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
(OUT / "egress-latest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

d = payload["decomposition_20turn"]
g = payload.get("gate", {})
prov = d["armA_provenance"]
print(f"wrote egress-{stamp}.json")
print(f"  window            = {payload['window']} messages")
print(f"  20-turn A total   = {d['armA_total_bytes']:,} B  (scaffold {d['scaffold_share']:.1%})")
print(f"    provenance      = " + ", ".join(f"{k}={v:,}" for k, v in sorted(prov.items())))
print(f"    envelope        = {d['armA_envelope_bytes']:,} B (JSON framing)")
print(f"  unwindowed        = {d['unwindowed_bytes']:,} B")
print(f"  window saving     = {d['window_saving_bytes']:,} B ({d['window_saving_ratio']:.2f}x)")
if g:
    print(f"  cloud default     = {g['cloud_default_bytes']:,} B vs local {g['local_bytes']:,} B")
    print(f"  gate withheld     = {g['withheld_bytes']:,} B "
          f"(private nodes {g['local_private_doc_nodes']} -> {g['cloud_private_doc_nodes']})")
    print(f"    by layer        = " + ", ".join(f"{k}={v:,}" for k, v in sorted(g["withheld_by_layer"].items())))
    print(f"  identical payload : default-deny == cloudPrivacy omitted: "
          f"{g['cloud_default_bytes'] == g['privacy_absent_bytes']}")

inj = payload.get("injection", {})
if inj:
    print(f"  injection         = {inj['learningDataSurvivingCount']}/{inj['learningDataCases']} "
          f"learning-data echoes reach the student past the guardrail")
    print(f"  positive controls : both PII-shape and internal-name echoes blocked: "
          f"{inj['positiveControlsBlocked']}")
