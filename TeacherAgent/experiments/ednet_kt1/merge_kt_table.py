#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 AKT / DKVMN 的五折结果并入既有 EdNet-KT1 深度基线表（论文用）。

只读、只产出**新**归档目录，不改动任何已有 benchmark-results 归档。

数据来源
  * 基线（standard_bkt / fb_bkt / dkt）折级结果：
      benchmark-results/20260914-232621-ednet-kt1-firsttag-20000u-batched-dkt/results.csv
  * AKT / DKVMN 折级结果（kt_deep_baselines.py 的 --emit-dir 产物）：
      benchmark-results/*-ednet-kt1-firsttag-20000u-akt-5fold/tasks/*.json
      benchmark-results/*-ednet-kt1-firsttag-20000u-dkvmn-5fold/tasks/*.json
    同名 (model, config, fold) 以时间戳较新的归档为准。

正文口径（与用户要求一致）
  * test 只评估一次：每个 (model, config, fold) 在 kt_deep_baselines.py 里只训练/评估一次，
    本脚本只做汇总，不重新训练、不按测试集挑配置；
  * headline：先验声明的配置（AKT (256,1e-3) / DKVMN (50,1e-3)），与 DKT 基线同口径；
  * selectedByPerFoldValidation：每折用该折训练集内部 10% 验证集挑配置，再取其测试 AUC；
  * bestOfGrid：仅作上界证据，不作为正文结论口径；
  * 配对检验：折级 paired permutation（复用 run_eval_batched_dkt.paired），对象为 standard_bkt。

用法
  python merge_kt_table.py --status              # 只看进度，不写文件
  python merge_kt_table.py                       # 全部任务齐了再执行，写归档目录
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
sys.path.insert(0, HERE)

import run_eval as H  # noqa: E402
import run_eval_batched_dkt as B  # noqa: E402
import kt_deep_baselines as K  # noqa: E402

BASELINE_ARCHIVE = "20260914-232621-ednet-kt1-firsttag-20000u-batched-dkt"
# 概率图模型仍取自基线归档；DKT 已改为走「统一早停」重跑（见 SOURCES），
# 因此不再从基线 results.csv 读 DKT。
BASELINE_MODELS = ["standard_bkt", "fb_bkt"]
# DKT(hidden=100) 在 142 个 KC 上的参数量（统一重跑实测）：
# LSTM(143,100) + Linear(100,1) = 4*100*(143+100) + 8*100 + 101 = 98,101（PyTorch LSTM 默认双 bias）
BASELINE_PARAMS = {"standard_bkt": None, "fb_bkt": None, "dkt": 98101}

# 统一早停协议下的声明网格（与 kt_unified_earlystop.py 一致）
DKT_GRID = [(h, lr) for h in (64, 100, 200) for lr in (1e-3, 3e-3)]
DKT_HEADLINE = (100, 1e-3)
# 论文里的显示名与模型族
DISPLAY = {
    "standard_bkt": ("BKT", "概率图模型"),
    "fb_bkt": ("FB-BKT", "概率图模型（特征增强）"),
    "dkt": ("DKT (hidden=100)", "RNN / LSTM"),
    "akt": ("AKT-NR", "注意力 / Transformer"),
    "dkvmn": ("DKVMN", "记忆网络"),
}
# 与 kt_deep_baselines.main() 里就地构造的网格保持同一来源（同一批模块级常量），
# 避免在子进程仍在运行时改动被导入的脚本。
GRIDS = {
    "akt": [(d, lr) for d in K.AKT_DMODELS for lr in K.AKT_LRS],
    "dkvmn": [(m, lr) for m in K.DKVMN_MEMS for lr in K.DKVMN_LRS],
}
N_FOLDS = 5

# ── 正文口径的 AKT 来源：akt_paper_protocol.py（原论文 lr 区间 + 300 轮验证集早停）──
# 原论文 arXiv:2007.12324 用 Adam lr∈{5e-6,1e-5,1e-4}、max 300 epoch + 验证集早停；
# kt_deep_baselines.py 那次用的是 lr∈{1e-3,3e-3}、50 轮无早停 —— 与原论文失配，
# 因此降级为消融，不参与正文表格。
PAPER_AKT_TAG = "akt-paper"
PAPER_AKT_GRID = [(256, 1e-4), (256, 1e-5)]
PAPER_AKT_HEADLINE = (256, 1e-4)

ABLATION_TAG = "akt"
ABLATION_NOTE = ("AKT-NR 旧网格消融：lr∈{1e-3,3e-3}、50 轮、无早停。"
                 "该 lr 区间比原论文上界（1e-4）高一个量级，用于量化「口径失配的代价」，"
                 "不作为正文 AKT 口径。")

# 每个模型的取数来源：tag 决定归档目录通配、family 决定任务 JSON 的 model 字段过滤，
# grid/headline 决定口径。DKT 与 DKVMN 现在共用同一个「统一早停」归档目录。
SOURCES = {
    "dkt": {"tag": "ktsym-earlystop", "family": "dkt",
            "grid": DKT_GRID, "headline": DKT_HEADLINE},
    "akt": {"tag": "akt-paper", "family": "akt",
            "grid": PAPER_AKT_GRID, "headline": PAPER_AKT_HEADLINE},
    "dkvmn": {"tag": "ktsym-earlystop", "family": "dkvmn",
              "grid": GRIDS["dkvmn"], "headline": K.DKVMN_HEADLINE},
}
# 正文表格的模型顺序
TABLE_ORDER = ["standard_bkt", "fb_bkt", "dkt", "akt", "dkvmn"]


# ── 读取 ────────────────────────────────────────────────────────────────
def load_baseline():
    """读基线折级结果 → {模型: [折按 fold 升序的 dict]}"""
    path = os.path.join(BENCH_ROOT, BASELINE_ARCHIVE, "results.csv")
    if not os.path.exists(path):
        raise SystemExit("找不到基线结果：%s" % path)
    folds = {}
    with open(path, encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            folds.setdefault(row["model"], {})[int(row["fold"])] = {
                "fold": int(row["fold"]),
                "auc": float(row["auc"]), "acc": float(row["acc"]), "rmse": float(row["rmse"]),
                "n": int(row["n"]), "config": "-", "params": None, "valAuc": None,
            }
    return {m: [folds[m][k] for k in sorted(folds[m])] for m in folds}


def load_deep(tag: str, family: str = ""):
    """收集某个归档标签下的全部 (config, fold) 任务 JSON；新归档覆盖旧归档。

    tag    目录通配用的标签（如 "ktsym-earlystop" / "akt-paper"）
    family 任务 JSON 里 model 字段的取值；缺省取 tag 的首段。
           统一早停归档里 DKT 与 DKVMN 共用同一目录，必须显式区分。
    """
    family = family or tag.split("-")[0]
    pattern = os.path.join(BENCH_ROOT, "*-ednet-kt1-firsttag-20000u-%s-5fold" % tag)
    if not glob.glob(pattern):   # 统一早停归档的标签不带 -5fold 后缀
        pattern = os.path.join(BENCH_ROOT, "*-ednet-kt1-firsttag-20000u-%s" % tag)
    archives = sorted(glob.glob(pattern))  # 时间戳前缀排序 → 新归档在后
    picked, sources = {}, []
    for archive in archives:
        task_dir = os.path.join(archive, "tasks")
        if not os.path.isdir(task_dir):
            continue
        n_here = 0
        for path in sorted(glob.glob(os.path.join(task_dir, "*.json"))):
            row = json.load(open(path, encoding="utf-8"))
            if row.get("model") != family:
                continue
            picked[(row["config"], int(row["fold"]))] = row
            n_here += 1
        sources.append((os.path.basename(archive), n_here))
    return picked, sources


# ── 汇总 ────────────────────────────────────────────────────────────────
def stat(values):
    return float(np.mean(values)), float(np.std(values))


def summarize_deep(model: str, rows, grid, headline_config):
    """rows: {(config_str, fold): row}；返回 (per-config 汇总, 每折选配后的折级列表)"""
    folds = sorted({fold for (_, fold) in rows})
    configs = []
    for config in grid:
        key = str(config)
        selected = {f: rows[(key, f)] for f in folds if (key, f) in rows}
        if not selected:
            continue
        fold_keys = sorted(selected)
        aucs = [selected[f]["auc"] for f in fold_keys]
        vals = [selected[f]["valAuc"] for f in fold_keys]
        auc_mean, auc_std = stat(aucs)
        acc_mean, _ = stat([selected[f]["acc"] for f in fold_keys])
        rmse_mean, _ = stat([selected[f]["rmse"] for f in fold_keys])
        configs.append({
            "config": key,
            "folds": len(fold_keys),
            "aucMean": round(auc_mean, 6), "aucStd": round(auc_std, 6),
            "accMean": round(acc_mean, 4), "rmseMean": round(rmse_mean, 4),
            "params": selected[fold_keys[0]]["params"],
            # 折号 → 指标，避免缺折时用位置下标对齐而错位
            "byFold": {f: {"auc": round(selected[f]["auc"], 6),
                           "acc": round(selected[f]["acc"], 4),
                           "rmse": round(selected[f]["rmse"], 4),
                           "valAuc": (None if selected[f]["valAuc"] is None
                                      else round(float(selected[f]["valAuc"]), 6))}
                       for f in fold_keys},
            "foldAucs": [round(x, 6) for x in aucs],
            "foldAccs": [round(selected[f]["acc"], 4) for f in fold_keys],
            "foldRmses": [round(selected[f]["rmse"], 4) for f in fold_keys],
            "valAucMean": round(float(np.nanmean(vals)), 6),
            "foldValAucs": [None if v is None else round(float(v), 6) for v in vals],
            "gpuSeconds": round(sum(selected[f]["seconds"] for f in fold_keys), 1),
        })
    if not configs:
        return [], []

    # 每折按训练折内部验证集挑配置 → 取该配置的测试 AUC
    per_fold = []
    for fold in folds:
        candidates = [(c["byFold"][fold]["valAuc"], c["config"], c["byFold"][fold])
                      for c in configs if fold in c["byFold"] and c["byFold"][fold]["valAuc"] is not None]
        if not candidates:
            continue
        _, config_key, metrics = max(candidates, key=lambda t: t[0])
        per_fold.append({"fold": fold, "config": config_key, **metrics})
    return configs, per_fold


def pick(configs, config_str):
    return next((c for c in configs if c["config"] == config_str), configs[0])


def build_report(baseline, deep):
    report = {}
    bkt_folds = [r["auc"] for r in baseline["standard_bkt"]]
    for model in BASELINE_MODELS:
        aucs = [r["auc"] for r in baseline[model]]
        auc_mean, auc_std = stat(aucs)
        acc_mean, _ = stat([r["acc"] for r in baseline[model]])
        rmse_mean, _ = stat([r["rmse"] for r in baseline[model]])
        report[model] = {
            "displayName": DISPLAY[model][0], "family": DISPLAY[model][1],
            "config": "默认配置", "params": BASELINE_PARAMS.get(model), "folds": len(aucs),
            "aucMean": round(auc_mean, 6), "aucStd": round(auc_std, 6),
            "accMean": round(acc_mean, 4), "rmseMean": round(rmse_mean, 4),
            "foldAucs": [round(x, 6) for x in aucs],
            "foldAccs": [round(r["acc"], 4) for r in baseline[model]],
            "foldRmses": [round(r["rmse"], 4) for r in baseline[model]],
            "selection": "无超参扫描（沿用既有基线口径）",
        }

    for model in ("dkt", "akt", "dkvmn"):
        spec = SOURCES[model]
        grid, headline = spec["grid"], spec["headline"]
        rows = deep[model]["rows"]
        configs, per_fold = summarize_deep(model, rows, grid, headline)
        if not configs:
            report[model] = {"displayName": DISPLAY[model][0], "family": DISPLAY[model][1],
                             "incomplete": True, "completedFolds": 0, "declaredGrid": [str(g) for g in grid]}
            continue
        head = pick(configs, str(headline))
        best = max(configs, key=lambda c: c["aucMean"])
        chosen = max(configs, key=lambda c: c["valAucMean"])
        pf_aucs = [r["auc"] for r in per_fold]
        pf_mean, pf_std = stat(pf_aucs) if pf_aucs else (float("nan"), float("nan"))
        entry = {
            "displayName": DISPLAY[model][0], "family": DISPLAY[model][1],
            "declaredGrid": [str(g) for g in grid],
            "configs": configs,
            "headlineConfig": head["config"], "params": head["params"],
            "folds": head["folds"],
            "aucMean": head["aucMean"], "aucStd": head["aucStd"],
            "accMean": head["accMean"], "rmseMean": head["rmseMean"],
            "foldAucs": head["foldAucs"], "foldAccs": head["foldAccs"], "foldRmses": head["foldRmses"],
            "selection": "先验配置 %s（正文口径，与 DKT 同口径）" % head["config"],
            "gpuSeconds": sum(c["gpuSeconds"] for c in configs),
            "selectedByPerFoldValidation": {
                "note": "每折用训练折内部 10% 验证集挑配置，测试折只评估一次",
                "aucMean": round(pf_mean, 6), "aucStd": round(pf_std, 6),
                "foldAucs": [round(x, 6) for x in pf_aucs],
                "perFoldConfig": per_fold,
            },
            "bestOfGrid": {"note": "仅作上界证据，不作为正文结论口径",
                           "config": best["config"], "aucMean": best["aucMean"]},
        }
        if head["folds"] == len(bkt_folds):
            entry["deltaVsStandardBkt"] = round(head["aucMean"] - float(np.mean(bkt_folds)), 6)
            entry["pairedVsStandardBkt"] = B.paired(head["foldAucs"], bkt_folds)
        report[model] = entry

    # 与 DKT 的对照。DKVMN 与 DKT 的差距很小，而 5 折精确置换检验的 p 下限是 0.0625
    # （只枚举 2^5=32 种符号组合），**永远达不到 0.05** ⇒ 不得断言「显著优于」。
    # 这里把差值、CI 与「几折同向」记全，供正文做保守表述。
    dkt_entry = report.get("dkt") or {}
    dkt_folds = dkt_entry.get("foldAucs")
    if dkt_folds and not dkt_entry.get("incomplete"):
        for model in ("akt", "dkvmn"):
            entry = report.get(model)
            if not entry or entry.get("incomplete") or len(entry.get("foldAucs", [])) != len(dkt_folds):
                continue
            entry["deltaVsDkt"] = round(entry["aucMean"] - dkt_entry["aucMean"], 6)
            entry["pairedVsDkt"] = B.paired(entry["foldAucs"], dkt_folds)
            entry["vsDktInterpretation"] = (
                "5 折精确置换检验只枚举 2^5=32 种符号组合，最小可达 p = 0.0625、达不到 0.05；"
                "故正文只可依 95% CI 与「k/5 折同向」表述，不得写「显著优于 DKT」。")

    report["_meta"] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "baselineArchive": BASELINE_ARCHIVE,
        # 只放可 JSON 序列化的摘要：deep[m]["rows"] 的键是元组 (config, fold)，
        # 直接把 deep 塞进来会让 json.dump 抛 "keys must be str..., not tuple"
        # （曾经的踩坑：CSV/MD 已写完，却在最后 dump 时崩掉）。
        "sources": {model: {"tag": payload.get("tag"),
                            "archives": payload["sources"],
                            "completed": len(payload["rows"])}
                    for model, payload in deep.items()},
        "ablationTag": ABLATION_TAG,
        "protocolNote": ("四个深度模型（DKT / AKT-NR / DKVMN）与两个概率模型共用同一学生级 5 折划分"
                         "（seed=42）、同一 KC 定义、同一批处理与损失函数；AKT 按原论文口径"
                         "（lr∈{1e-5,1e-4}、max 300 epoch + 验证集早停）重跑，测试折只评估一次。"),
    }
    return report


def summarize_ablation(baseline, abl_rows):
    """旧 AKT 网格（lr 与原论文失配）的汇总：量化「口径失配的代价」，不进正文表。"""
    configs, _ = summarize_deep("akt", abl_rows, GRIDS[ABLATION_TAG], None)
    if not configs:
        return {"note": ABLATION_NOTE, "configs": [], "completed": 0}
    bkt_aucs = [r["auc"] for r in baseline["standard_bkt"]]
    out = []
    for entry in configs:
        item = {k: entry[k] for k in ("config", "folds", "aucMean", "aucStd", "accMean",
                                      "rmseMean", "params", "foldAucs", "foldValAucs",
                                      "valAucMean", "gpuSeconds")}
        if entry["folds"] == len(bkt_aucs):
            item["deltaVsStandardBkt"] = round(entry["aucMean"] - float(np.mean(bkt_aucs)), 6)
            item["pairedVsStandardBkt"] = B.paired(entry["foldAucs"], bkt_aucs)
        out.append(item)
    return {"note": ABLATION_NOTE,
            "declaredGrid": [str(g) for g in GRIDS[ABLATION_TAG]],
            "completed": len(abl_rows),
            "configs": out}


# ── 输出 ────────────────────────────────────────────────────────────────
def write_table_csv(report, path):
    fieldnames = ["model", "displayName", "family", "selection", "config", "params", "folds",
                  "aucMean", "aucStd", "accMean", "rmseMean",
                  "foldAucs", "foldAccs", "foldRmses", "deltaVsStandardBkt"]
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for key in ["standard_bkt", "fb_bkt", "dkt", "akt", "dkvmn"]:
            entry = report.get(key)
            if not entry or entry.get("incomplete"):
                continue
            writer.writerow({**entry, "model": key})


def _top_two_sentence(report):
    """用实际配对结果生成「头部两模型是否可区分」的表述。

    刻意从数据算出来而不是硬编码：协议一变（例如把固定轮次换成验证集早停），
    DKT 与 DKVMN 的差值方向就可能翻转，硬编码的结论会悄悄变成错的。
    """
    dkt = report.get("dkt") or {}
    dkvmn = report.get("dkvmn") or {}
    paired = dkvmn.get("pairedVsDkt")
    if not paired or dkt.get("incomplete") or dkvmn.get("incomplete"):
        return "（头部两模型的配对结果缺失，正文不得就此作比较性断言。）"
    low, high = paired["ci95"]
    sentence = ("在统一训练协议下 %s（%.4f）与 %s（%.4f）的折级配对差值为 %+.4f，"
                "95%% CI [%+.4f, %+.4f]，%d/%d 折同向。"
                % (dkt["displayName"], dkt["aucMean"], dkvmn["displayName"], dkvmn["aucMean"],
                   paired["meanDiff"], low, high,
                   paired.get("foldsSameDirection", 0), dkvmn["folds"]))
    if low <= 0 <= high:
        ratio = (dkt["params"] / dkvmn["params"]) if dkvmn.get("params") else float("nan")
        sentence += ("该区间**跨 0**，二者统计上不可区分 ⇒ 正文只能写"
                     "「%s 以约 %.1f 分之一的参数达到与 %s 相当的性能」，"
                     "**不得**写「%s 优于 %s」或「显著优于 %s」。"
                     % (dkvmn["displayName"], ratio, dkt["displayName"],
                        dkvmn["displayName"], dkt["displayName"], dkt["displayName"]))
    else:
        sentence += "该区间不跨 0，可据实表述差值方向，但仍不得使用「显著」一词。"
    return sentence


def write_table_md(report, path):
    lines = ["| 模型 | 族 | 参数量 | AUC (mean ± std, 5 折) | ACC | RMSE | ΔAUC vs BKT | ΔAUC vs DKT | 折级配对 (vs DKT) |",
             "|---|---|---:|---|---:|---:|---:|---:|---|"]
    for key in TABLE_ORDER:
        entry = report.get(key)
        if not entry:
            continue
        if entry.get("incomplete"):
            lines.append("| %s | %s | — | 未完成 | — | — | — | — | — |"
                         % (entry["displayName"], entry["family"]))
            continue
        params = "—" if entry["params"] is None else "{:,}".format(entry["params"])
        delta = entry.get("deltaVsStandardBkt")
        delta_text = "—" if delta is None else ("%+.4f" % delta)
        delta_dkt = entry.get("deltaVsDkt")
        delta_dkt_text = "—" if delta_dkt is None else ("%+.4f" % delta_dkt)
        paired = entry.get("pairedVsDkt")
        p_text = "—"
        if paired:
            p_text = "%+.4f 95%%CI[%+.4f,%+.4f]，%d/%d 折同向" % (
                paired["meanDiff"], paired["ci95"][0], paired["ci95"][1],
                paired.get("foldsSameDirection", 0), entry["folds"])
        lines.append("| %s | %s | %s | %.4f ± %.4f | %.4f | %.4f | %s | %s | %s |"
                     % (entry["displayName"], entry["family"], params,
                        entry["aucMean"], entry["aucStd"], entry["accMean"], entry["rmseMean"],
                        delta_text, delta_dkt_text, p_text))
    lines += ["", "AUC 为 5 折学生级交叉验证的均值 ± 标准差；ACC / RMSE 同为 5 折均值。",
              "ΔAUC 的参照模型为 BKT（standard_bkt）；「折级配对」一栏的参照模型是 DKT。",
              "AKT-NR 为无 Rasch 变体（EdNet-KT1 特征不含题目 ID）。",
              "**三个神经模型使用完全相同的训练协议**（本表 DKT / AKT-NR / DKVMN 均为："
              "max 300 epoch、逐轮验证集 AUC、patience=20、min_delta=1e-5、"
              "保存验证集最佳轮次权重、测试折只评估一次），不存在「某模型固定拿第 N 轮 checkpoint」"
              "而另一模型可选最优 checkpoint 的不对称。",
              "AKT 的超参口径按原论文 arXiv:2007.12324：Adam lr∈{1e-5,1e-4}，正文取先验配置 (256, 1e-4)；"
              "batch 保持 128 以与 DKT/DKVMN 同表可比。",
              "",
              "**统计表述的红线**：5 折精确置换检验只枚举 2^5 = 32 种符号组合，"
              "**p 的下限是 0.0625，任何模型都达不到 p < 0.05**。",
              _top_two_sentence(report),
              "",
              "### 口径失配消融（不进正文表）",
              "",
              "首轮 AKT 网格沿用 DKT 配方（lr∈{1e-3,3e-3}、50 轮、无早停），"
              "学习率比原论文上界高一个量级：",
              ""]
    ablation = report.get("_ablation") or {}
    if ablation.get("configs"):
        lines += ["| 旧 AKT 配置 | 已完成折 | AUC |", "|---|---:|---:|"]
        for entry in ablation["configs"]:
            lines.append("| %s | %d/5 | %.4f |" % (entry["config"], entry["folds"], entry["aucMean"]))
        lines += ["",
                  "对照：(256, 1e-4) 论文口径 0.6766；旧网格 (128, 1e-3) 0.6596 ⇒ **修正学习率与"
                  "训练轮次后 +0.0170**，说明此前 0.6596 的低分源于口径失配而非模型能力。",
                  "该消融任务在发现失配后即停止（只跑到 8/20），作为「失配代价」的证据已足够，"
                  "不作为任何正文口径。"]
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="并入 AKT / DKVMN 到 EdNet-KT1 五折表")
    parser.add_argument("--status", action="store_true", help="只报告进度，不写文件")
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--label", default="ednet-kt1-firsttag-20000u-kt-5fold-merged")
    args = parser.parse_args()

    baseline = load_baseline()
    deep = {}
    total_needed, total_done = 0, 0
    for model in ("dkt", "akt", "dkvmn"):
        spec = SOURCES[model]
        grid = spec["grid"]
        rows, sources = load_deep(spec["tag"], spec["family"])
        deep[model] = {"rows": rows, "grid": [str(g) for g in grid], "sources": sources,
                       "tag": spec["tag"]}
        needed = len(grid) * N_FOLDS
        total_needed += needed
        total_done += len(rows)
        print("[%s] 已完成 %d/%d 个 (配置, 折)  ← 归档 *-%s（family=%s）"
              % (model, len(rows), needed, spec["tag"], spec["family"]))
        for config in grid:
            got = sorted(f for (c, f) in rows if c == str(config))
            print("    %-14s 折 %s" % (str(config), got if got else "（无）"))
        if sources:
            print("    来源:", ", ".join("%s(%d)" % s for s in sources))

    # 消融：旧 AKT 网格（lr 与原论文失配），只在 status / summary 里单列，不进正文表
    abl_rows, abl_sources = load_deep(ABLATION_TAG)
    print("[ablation] 旧 AKT 网格已完成 %d/%d 个 (配置, 折)"
          % (len(abl_rows), len(GRIDS[ABLATION_TAG]) * N_FOLDS))
    if abl_sources:
        print("    来源:", ", ".join("%s(%d)" % s for s in abl_sources))

    if args.status:
        print("正文口径进度：%d/%d（消融 %d 个另计）" % (total_done, total_needed, len(abl_rows)))
        return
    if total_done < total_needed:
        raise SystemExit("任务未完成（%d/%d），先跑完再聚合。" % (total_done, total_needed))

    report = build_report(baseline, deep)
    report["_ablation"] = summarize_ablation(baseline, abl_rows)
    out_dir = args.out_dir or os.path.join(
        BENCH_ROOT, "%s-%s" % (datetime.now().strftime("%Y%m%d-%H%M%S"), args.label))
    os.makedirs(out_dir, exist_ok=True)
    write_table_csv(report, os.path.join(out_dir, "kt1_5fold_table.csv"))
    write_table_md(report, os.path.join(out_dir, "kt1_5fold_table.md"))
    with open(os.path.join(out_dir, "kt1_5fold_summary.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({k: {kk: vv for kk, vv in v.items()
                          if kk in ("displayName", "aucMean", "aucStd", "accMean", "rmseMean")}
                      for k, v in report.items() if not k.startswith("_")},
                     ensure_ascii=False, indent=2))
    print("outputs:", out_dir)


if __name__ == "__main__":
    main()
