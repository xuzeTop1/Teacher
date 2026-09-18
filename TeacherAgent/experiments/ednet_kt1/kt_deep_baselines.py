#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AKT / DKVMN 深度基线（新脚本，**不改动** run_eval.py 与 run_eval_batched_dkt.py）。

目的：把论文的知识追踪基线谱系从「概率图模型（BKT/FB-BKT）+ RNN（DKT）」
补全到记忆网络与注意力两条代表路线。

口径与既有实验完全一致（本脚本最重要的约束）：
  * 数据：同一个 --features parquet（EdNet-KT1 队列），同一过滤条件；
  * 划分：H.student_folds(seed=42) 的学生级 5 折，train/test 索引构造与
    dkt_hyperparam_scan.py 逐字一致；
  * 指标：H.metrics 的 AUC / ACC / RMSE（同一实现，不另写第二个 AUC）；
  * 训练：epochs=50、Adam、BCELoss(masked)、长度分桶批处理、不做早停
    （与 DKT 基线一致，便于横向比较）。

模型实现说明（来源已核验，不凭记忆）：
  * DKVMN —— Zhang et al., WWW 2017, doi:10.1145/3038912.3052580：
    w_t = softmax(k_t M_k^T)、r_t = Σ_i w_t(i) M_t^v(i)、
    erase_t = σ(W_e v_t + b_e)、M̃_t^v(i) = M_{t-1}^v(i)[1 − w_t(i) erase_t]、
    M_t^v(i) = M̃_t^v(i) + w_t(i) a_t、a_t = tanh(W_d v_t + b_d)、
    p_t = σ(W_p tanh(W_f [r_t, k_t] + b_f))。静态 key 随机初始化、动态 value 零初始化。
  * AKT —— Ghosh, Heffernan & Lan, KDD 2020, arXiv:2007.12324：
    单调注意力 s_{t,τ} = exp(−θ·d(t,τ))·q_tᵀk_τ/√D_k，
    上下文感知距离 d(t,τ) = |t−τ|·Σ_{t'=τ+1}^{t} γ_{t,t'}，γ 为该层未加衰减的因果 softmax；
    H=8 头、每头独立 θ=softplus(·)；预测头两层全连接后 sigmoid。
    **本脚本实现论文的 AKT-NR 变体**：EdNet-KT1 特征表只保留 KC 级 skill 标识、不含题目 ID，
    Rasch 嵌入的题目难度 μ_{q_t} 与题目变化向量 d_{c_t} 无从估计，故
    x_t = c_{c_t}、y_t = c_{c_t} + g_{r_t}。该取舍写入 run_manifest.json 的 modelVariants，不隐藏。

性能说明（探针实测，影响网格规模与并发度）：
  * AKT 是显存带宽瓶颈（RTX 4060 Laptop 上 GPU 利用率≈100%）：
    原实现的 torch.cumsum 单次调用 3.04 ms、占单步 25%，故改用**下三角矩阵乘法**求
    累积和 C = γ·tril(1)，并把 θ 折进距离矩阵、去掉多余的 nan_to_num；
  * DKVMN 是 kernel 启动瓶颈（GPU 利用率仅约 12%）：80 步串行记忆更新产生约 4500 次
    kernel 启动/步，故用**子进程并发**（--jobs）而非提高批大小来压时间。
  * 单任务结果落地式断点续跑（--emit-dir）：每个 (模型, 配置, 折) 完成即写一个 JSON，
    重跑自动跳过已完成任务，长任务中断不丢结果。

超参口径（先声明，后执行；与 dkt_hyperparam_scan.py 同构）：
  * AKT   扫描 d_model ∈ {128,256} × lr ∈ {1e-3,3e-3}，共 4 组（d=512 的排除理由见 AKT_GRID_RATIONALE）；
  * DKVMN 扫描 memory_size ∈ {50,200} × lr ∈ {1e-3,3e-3}，共 4 组；
  * 固定不扫：epochs=50、batch=128、seed=42、优化器/损失/编码方式/注意力头数/dropout；
  * 全部配置都报告，不筛选不隐藏；正文口径取**先验配置**（headline），同时给出
    「按训练折内部验证集选择」的配置与 best-of-grid（仅作上界证据）；测试折只评估一次。

用法：
  python kt_deep_baselines.py --features work/features_ednet_20000.parquet --smoke
  python kt_deep_baselines.py --features work/features_ednet_20000.parquet --models akt --jobs 1
  python kt_deep_baselines.py --features work/features_ednet_20000.parquet --models dkvmn --jobs 4
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import numpy as np
import torch
import torch.nn as nn

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH_ROOT = os.path.join(REPO_ROOT, "benchmark-results")
sys.path.insert(0, HERE)

import run_eval as H  # noqa: E402
import run_eval_batched_dkt as B  # noqa: E402

# ── 声明的超参网格 ──────────────────────────────────────────────────────
AKT_DMODELS = [128, 256]
AKT_LRS = [1e-3, 3e-3]
AKT_HEADLINE = (256, 1e-3)
AKT_HEADS = 8
AKT_DROPOUT = 0.1
AKT_FFN = (512, 256)
AKT_GRID_RATIONALE = (
    "论文 arXiv:2007.12324 的嵌入维度搜索空间为 {256,512}，那是为完整 EdNet（78 万用户）设定的；"
    "本队列只有 142 个 KC、103 万响应，d=512 对应 388 万参数（DKT 基线的 39 倍），属明显过参数化，"
    "且实测单 epoch 成本是 d=256 的 5.7 倍（22.9s vs 4.0s）后在 lr=3e-3 下出现训练不稳定。"
    "故按容量匹配原则先验声明 d ∈ {128,256}，与 DKT 扫描的 {64,100,200}、DKVMN 的 {50,200} 同为"
    "「2 个维度 × 2 档」的限定网格；d=512 未纳入扫描，此项不做隐藏。")

DKVMN_MEMS = [50, 200]
DKVMN_LRS = [1e-3, 3e-3]
DKVMN_HEADLINE = (50, 1e-3)
DKVMN_DIM = 50


# ── 数据准备 ────────────────────────────────────────────────────────────
def make_encoder(sequences):
    skills = sorted({str(skill) for sequence in sequences for skill in sequence["skill"]})
    return {skill: index for index, skill in enumerate(skills)}, len(skills)


def prepare_indexed(sequences, skill_index):
    prepared = []
    for sequence in sequences:
        ids = np.fromiter((skill_index[str(s)] for s in sequence["skill"]), dtype=np.int64,
                          count=len(sequence["skill"]))
        correct = np.asarray(sequence["correct"], dtype=np.float32)
        prepared.append((ids, correct))
    return prepared


def build_batch_cpu(prepared, index_list):
    lengths = [prepared[i][0].shape[0] for i in index_list]
    max_len = max(lengths)
    size = len(index_list)
    idx = torch.zeros((size, max_len), dtype=torch.long)
    correct = torch.zeros((size, max_len), dtype=torch.float32)
    mask = torch.zeros((size, max_len), dtype=torch.float32)
    for row, i in enumerate(index_list):
        ids, corr = prepared[i]
        length = ids.shape[0]
        idx[row, :length] = torch.from_numpy(ids)
        correct[row, :length] = torch.from_numpy(corr)
        mask[row, :length] = 1.0
    return idx, correct, mask


def make_buckets(lengths, batch_size):
    order = sorted(range(len(lengths)), key=lambda i: lengths[i])
    return [order[i:i + batch_size] for i in range(0, len(order), batch_size)]


# ── AKT：上下文感知单调注意力 ───────────────────────────────────────────
class MonotonicAttention(nn.Module):
    """AKT 的上下文感知单调注意力（论文 Eq. 2–4）。

    累积和用 tril 矩阵乘法实现：C = γ·tril(1)，替代 torch.cumsum
    （scan kernel 在 128×8×80×80 上单次 3.04 ms，占单步 25%）。
    """

    def __init__(self, d_model, n_heads, dropout, exclude_self=False):
        super().__init__()
        assert d_model % n_heads == 0, "d_model 必须能被注意力头数整除"
        self.h = n_heads
        self.dk = d_model // n_heads
        self.exclude_self = exclude_self
        self.q = nn.Linear(d_model, d_model)
        self.k = nn.Linear(d_model, d_model)
        self.v = nn.Linear(d_model, d_model)
        self.out = nn.Linear(d_model, d_model)
        self.dropout = nn.Dropout(dropout)
        self.theta_raw = nn.Parameter(torch.full((n_heads,), -1.0))  # θ = softplus(·) > 0
        self._allowed_cache: dict = {}
        self._tril_cache: dict = {}
        self._dist_cache: dict = {}

    def _tril(self, length, device):
        """下三角全 1 矩阵，用于以矩阵乘法求累积和（替代 torch.cumsum）。"""
        key = (length, str(device))
        cached = self._tril_cache.get(key)
        if cached is None:
            cached = torch.tril(torch.ones(length, length, device=device))
            self._tril_cache[key] = cached
        return cached

    def _distance(self, length, device):
        """|t − τ| 位置距离矩阵。"""
        key = (length, str(device))
        cached = self._dist_cache.get(key)
        if cached is None:
            position = torch.arange(length, device=device)
            cached = (position.view(-1, 1) - position.view(1, -1)).abs().float()
            self._dist_cache[key] = cached
        return cached

    def _base_allowed(self, length, device):
        """因果（可选排除自身）的布尔可见性矩阵。"""
        key = (length, str(device))
        cached = self._allowed_cache.get(key)
        if cached is None:
            cached = torch.tril(torch.ones(length, length, dtype=torch.bool, device=device))
            if self.exclude_self:
                cached = cached & ~torch.eye(length, dtype=torch.bool, device=device)
            self._allowed_cache[key] = cached
        return cached

    def forward(self, q_input, k_input, v_input, mask):
        size, length, _ = q_input.shape
        q = self.q(q_input).view(size, length, self.h, self.dk).transpose(1, 2)
        k = self.k(k_input).view(size, length, self.h, self.dk).transpose(1, 2)
        v = self.v(v_input).view(size, length, self.h, self.dk).transpose(1, 2)

        logits = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.dk)   # B,h,L,L
        # 因果掩码 + padding：padding 位置的 key 不可见
        allowed = self._base_allowed(length, q.device).view(1, 1, length, length) \
            & mask.view(size, 1, 1, length).bool()
        # 用**有限**负值而非 -inf：padding 行的 softmax 整行全 -inf 会产生 NaN，
        # 而 NaN 会经反向传播污染全部参数（实测触发 BCELoss 的 device-side assert）。
        negative = torch.full((), torch.finfo(logits.dtype).min / 4, device=q.device)
        bias = torch.where(allowed, torch.zeros((), device=q.device, dtype=logits.dtype), negative)
        has_key = allowed.any(dim=-1, keepdim=True)          # B,1,L,1：该步是否存在可见历史
        masked_logits = logits + bias

        # γ：该层未加衰减的因果 softmax（论文 Eq. 4）
        gamma = torch.softmax(masked_logits, dim=-1)

        # d(t,τ) = |t−τ| · Σ_{t'=τ+1}^{t} γ_{t,t'} = |t−τ| · (C(t,t) − C(t,τ))
        cumulative = torch.matmul(gamma, self._tril(length, q.device))
        span = cumulative.diagonal(dim1=-2, dim2=-1).unsqueeze(-1) - cumulative
        theta = torch.nn.functional.softplus(self.theta_raw).view(1, self.h, 1, 1)
        # θ 折进 (1,h,L,L) 的距离矩阵，省掉一次 26 MB 级 elementwise
        decay = torch.exp(-(theta * self._distance(length, q.device)) * span)

        attention = torch.softmax((decay * logits) + bias, dim=-1)
        output = torch.matmul(self.dropout(attention), v)
        # 无可见历史的步（序列首步 / padding）输出置零，避免使用未来位置的信息
        output = torch.where(has_key, output, torch.zeros_like(output))
        output = output.transpose(1, 2).reshape(size, length, self.h * self.dk)
        return self.out(output)


class AktNet(nn.Module):
    """AKT-NR：无 Rasch 题目难度项（数据集不含题目 ID，见模块 docstring）。"""

    def __init__(self, n_skills, d_model, n_heads, dropout, d_ffn=AKT_FFN):
        super().__init__()
        self.concept = nn.Embedding(n_skills, d_model)
        self.response = nn.Embedding(2, d_model)
        self.question_encoder = MonotonicAttention(d_model, n_heads, dropout)
        self.knowledge_encoder = MonotonicAttention(d_model, n_heads, dropout)
        self.retriever = MonotonicAttention(d_model, n_heads, dropout, exclude_self=True)
        self.dropout = nn.Dropout(dropout)
        self.ff1 = nn.Linear(2 * d_model, d_ffn[0])
        self.ff2 = nn.Linear(d_ffn[0], d_ffn[1])
        self.out = nn.Linear(d_ffn[1], 1)

    def forward(self, idx, correct, mask):
        x = self.concept(idx)                                     # x_t = c_{c_t}
        previous_idx = torch.zeros_like(idx)
        previous_idx[:, 1:] = idx[:, :-1]
        previous_correct = torch.zeros_like(idx)
        previous_correct[:, 1:] = correct[:, :-1].long()
        y = self.concept(previous_idx) + self.response(previous_correct)   # y_t = c_{c_t}+g_{r_t}

        x_hat = self.question_encoder(x, x, x, mask)
        y_hat = self.knowledge_encoder(y, y, y, mask)
        hidden = self.retriever(x_hat, x_hat, y_hat, mask)
        z = torch.cat([hidden, x_hat], dim=-1)
        z = self.dropout(torch.relu(self.ff1(z)))
        z = self.dropout(torch.relu(self.ff2(z)))
        return torch.sigmoid(self.out(z)).squeeze(-1)


# ── DKVMN：动态键值记忆网络 ─────────────────────────────────────────────
class DkvmnNet(nn.Module):
    def __init__(self, n_skills, memory_size, dim=DKVMN_DIM):
        super().__init__()
        self.memory_size = memory_size
        self.dim = dim
        self.skill_emb = nn.Embedding(n_skills, dim)
        self.key_memory = nn.Parameter(torch.randn(memory_size, dim) * 0.1)   # 随机初始化
        self.interaction = nn.Linear(dim + 2, dim)
        self.read = nn.Linear(2 * dim, dim)
        self.predict = nn.Linear(dim, 1)
        self.erase = nn.Linear(dim, dim)
        self.add = nn.Linear(dim, dim)

    def forward(self, idx, correct, mask):
        size, length = idx.shape
        device = idx.device
        value_memory = torch.zeros(size, self.memory_size, self.dim, device=device)
        onehot = torch.nn.functional.one_hot(correct.long(), 2).float()
        embedding = self.skill_emb(idx)

        predictions = []
        for step in range(length):
            key = embedding[:, step]
            weight = torch.softmax(key @ self.key_memory.t(), dim=-1)            # w_t
            read_content = torch.einsum("bn,bnd->bd", weight, value_memory)       # r_t
            summary = torch.tanh(self.read(torch.cat([read_content, key], dim=-1)))
            predictions.append(torch.sigmoid(self.predict(summary)).squeeze(-1))

            interaction = torch.tanh(self.interaction(torch.cat([key, onehot[:, step]], dim=-1)))
            erase_vector = torch.sigmoid(self.erase(interaction))
            add_vector = torch.tanh(self.add(interaction))
            # M ← M + w ⊗ (a − M ⊙ e)（与 erase-then-add 等价，少一次全量 elementwise）
            updated = value_memory + weight.unsqueeze(-1) * (
                add_vector.unsqueeze(1) - value_memory * erase_vector.unsqueeze(1))
            active = mask[:, step].view(size, 1, 1).bool()
            value_memory = torch.where(active, updated, value_memory)

        return torch.stack(predictions, dim=1)


# ── 训练／评测 ──────────────────────────────────────────────────────────
def build_model(kind, n_skills, config):
    if kind == "akt":
        return AktNet(n_skills, config[0], AKT_HEADS, AKT_DROPOUT)
    return DkvmnNet(n_skills, config[0])


def predict(model, prepared, index_list, batch_size, device):
    model.eval()
    order = sorted(index_list, key=lambda i: prepared[i][0].shape[0])
    targets, predictions = [], []
    with torch.no_grad():
        for start in range(0, len(order), batch_size):
            chunk = order[start:start + batch_size]
            idx, correct, mask = build_batch_cpu(prepared, chunk)
            output = model(idx.to(device), correct.to(device), mask.to(device)).cpu().numpy()
            keep = mask.numpy().astype(bool)
            predictions.append(output[keep])
            targets.append(correct.numpy()[keep])
    return np.concatenate(predictions), np.concatenate(targets)


def split_train_val(train_index, val_frac, seed):
    if val_frac <= 0:
        return list(train_index), []
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(train_index))
    n_val = max(1, int(round(len(train_index) * val_frac)))
    return [train_index[i] for i in order[n_val:]], [train_index[i] for i in order[:n_val]]


def run_one(kind, config, sequences, train_index, val_index, test_index,
            epochs, batch_size, device, log_prefix=""):
    lr = config[1]
    skill_index, n_skills = make_encoder(sequences)
    prepared = prepare_indexed(sequences, skill_index)

    torch.manual_seed(H.SEED)
    model = build_model(kind, n_skills, config).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCELoss(reduction="none")
    n_params = sum(p.numel() for p in model.parameters())

    train_lengths = [prepared[i][0].shape[0] for i in train_index]
    batches = [[train_index[i] for i in bucket] for bucket in make_buckets(train_lengths, batch_size)]
    # 训练集总量约 20 MB（2 万用户 × ≤80 步），一次搬进显存，消除每步 H2D 传输
    cached = [(i.to(device), c.to(device), m.to(device))
              for (i, c, m) in (build_batch_cpu(prepared, b) for b in batches)]

    started = time.perf_counter()
    generator = torch.Generator().manual_seed(H.SEED)
    for _ in range(epochs):
        model.train()
        for batch_index in torch.randperm(len(batches), generator=generator).tolist():
            idx, correct, mask = cached[batch_index]
            optimizer.zero_grad(set_to_none=True)
            prediction = model(idx, correct, mask)
            loss = (loss_fn(prediction, correct) * mask).sum() / mask.sum()
            loss.backward()
            optimizer.step()

    with torch.no_grad():
        val_auc = float("nan")
        if val_index:
            val_prediction, val_target = predict(model, prepared, val_index, batch_size, device)
            val_auc = H.metrics(val_target, val_prediction)["auc"]
        test_prediction, test_target = predict(model, prepared, test_index, batch_size, device)
    elapsed = time.perf_counter() - started
    metric = {**H.metrics(test_target, test_prediction), "params": int(n_params)}
    print("%s auc=%.6f valAuc=%.6f params=%d (%.1fs)"
          % (log_prefix, metric["auc"], val_auc, n_params, elapsed), flush=True)
    return metric, val_auc, elapsed


# ── 任务模式（子进程）──────────────────────────────────────────────────
def config_slug(kind, config):
    return "%s_d%d_lr%s" % (kind, config[0], ("%g" % config[1]).replace(".", "p"))


def run_task(args):
    # 归一化成与父进程网格完全相同的字面量（256 而非 256.0），否则聚合时匹配不上
    config = tuple(int(float(x)) if float(x).is_integer() else float(x)
                   for x in args.only_config.split(","))
    kind, fold = args.only_model, args.only_fold
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    sequences = H.load_sequences(args.features)
    index_by_id = {id(s): i for i, s in enumerate(sequences)}
    fold_indices = [[index_by_id[id(s)] for s in fold_] for fold_ in H.student_folds(sequences)]
    all_indices = list(range(len(sequences)))

    test_index = fold_indices[fold]
    train_pool = [i for i in all_indices if i not in set(test_index)]
    train_index, val_index = split_train_val(train_pool, args.val_frac, H.SEED + fold)
    metric, val_auc, elapsed = run_one(kind, config, sequences, train_index, val_index, test_index,
                                       args.epochs, args.batch_size, device,
                                       log_prefix="%s cfg=%s fold=%d" % (kind, config, fold))
    payload = {"model": kind, "config": str(config), "fold": fold, "valAuc": val_auc,
               "seconds": round(elapsed, 1), **metric}
    os.makedirs(args.emit_dir, exist_ok=True)
    path = os.path.join(args.emit_dir, "%s_fold%d.json" % (config_slug(kind, config), fold))
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print("emitted:", path, flush=True)
    return payload


# ── 调度模式（父进程）──────────────────────────────────────────────────
def run_scheduled(args, kinds, grids):
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    sequences = H.load_sequences(args.features)
    responses = sum(len(s["correct"]) for s in sequences)
    index_by_id = {id(s): i for i, s in enumerate(sequences)}
    fold_indices = [[index_by_id[id(s)] for s in fold] for fold in H.student_folds(sequences)]
    n_folds = len(fold_indices) if not args.folds else min(args.folds, len(fold_indices))
    print("students=%d responses=%d skills=%d folds=%d device=%s"
          % (len(sequences), responses,
             len({str(s) for seq in sequences for s in seq["skill"]}), n_folds, device), flush=True)

    bkt_fold_aucs = [H.metrics(*H.run_standard_bkt([sequences[i] for i in fold_indices[f]]))["auc"]
                     for f in range(n_folds)]
    print("standard_bkt fold auc:", [round(x, 6) for x in bkt_fold_aucs], flush=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(BENCH_ROOT, f"{timestamp}-{args.label}")
    os.makedirs(out_dir, exist_ok=True)
    emit_dir = args.emit_dir or os.path.join(out_dir, "tasks")
    os.makedirs(emit_dir, exist_ok=True)
    log_path = os.path.join(out_dir, "worker.log")

    tasks = [(kind, config, fold) for kind in kinds for config in grids[kind] for fold in range(n_folds)]
    for kind in kinds:
        print("%s declared grid: %s" % (kind, [str(c) for c in grids[kind]]), flush=True)

    pending = []
    for kind, config, fold in tasks:
        path = os.path.join(emit_dir, "%s_fold%d.json" % (config_slug(kind, config), fold))
        if not os.path.exists(path):
            pending.append((kind, config, fold))
    print("tasks=%d pending=%d jobs=%d" % (len(tasks), len(pending), args.jobs), flush=True)

    running: list = []
    with open(log_path, "a", encoding="utf-8") as log:
        while pending or running:
            while pending and len(running) < args.jobs:
                kind, config, fold = pending.pop(0)
                command = [sys.executable, os.path.abspath(__file__),
                           "--features", args.features,
                           "--only-model", kind, "--only-config", "%g,%g" % config,
                           "--only-fold", str(fold), "--emit-dir", emit_dir,
                           "--epochs", str(args.epochs), "--batch-size", str(args.batch_size),
                           "--val-frac", str(args.val_frac), "--device", args.device]
                process = subprocess.Popen(command, cwd=HERE, stdout=log, stderr=subprocess.STDOUT)
                running.append((process, (kind, config, fold), time.perf_counter()))
                print("start %s cfg=%s fold=%d" % (kind, config, fold), flush=True)
            time.sleep(2)
            for entry in list(running):
                process, (kind, config, fold), started = entry
                if process.poll() is not None:
                    running.remove(entry)
                    print("%s cfg=%s fold=%d exit=%s (%.0fs)"
                          % (kind, config, fold, process.returncode, time.perf_counter() - started),
                          flush=True)

    rows = []
    for kind, config, fold in tasks:
        path = os.path.join(emit_dir, "%s_fold%d.json" % (config_slug(kind, config), fold))
        if not os.path.exists(path):
            raise SystemExit("缺少任务结果：%s" % path)
        rows.append(json.load(open(path, encoding="utf-8")))
    rows.sort(key=lambda r: (r["model"], r["config"], r["fold"]))

    with open(os.path.join(out_dir, "kt_deep_baselines_scan.csv"), "w",
              encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["model", "config", "fold",
                                                    "auc", "acc", "rmse", "n", "params",
                                                    "valAuc", "seconds"])
        writer.writeheader()
        writer.writerows(rows)

    summary = {"generatedAt": datetime.now(timezone.utc).isoformat(),
               "featuresFile": os.path.abspath(args.features),
               "students": len(sequences), "responses": int(responses),
               "folds": n_folds, "seed": H.SEED,
               "epochs": args.epochs, "batchSize": args.batch_size, "valFrac": args.val_frac,
               "standardBktFoldAucs": [round(x, 6) for x in bkt_fold_aucs],
               "standardBktAucMean": round(float(np.mean(bkt_fold_aucs)), 6)}

    for kind in kinds:
        configs = []
        for config in grids[kind]:
            selected = [r for r in rows if r["model"] == kind and r["config"] == str(config)]
            fold_aucs = [r["auc"] for r in selected]
            fold_vals = [r["valAuc"] for r in selected]
            if not selected:
                continue
            entry = {
                "config": str(config),
                "aucMean": round(float(np.mean(fold_aucs)), 6),
                "aucStd": round(float(np.std(fold_aucs)), 6),
                "accMean": round(float(np.mean([r["acc"] for r in selected])), 6),
                "rmseMean": round(float(np.mean([r["rmse"] for r in selected])), 6),
                "params": selected[0]["params"],
                "foldAucs": [round(x, 6) for x in fold_aucs],
                "valAucMean": round(float(np.nanmean(fold_vals)), 6) if not all(
                    np.isnan(fold_vals)) else None,
                "foldValAucs": [None if np.isnan(v) else round(float(v), 6) for v in fold_vals],
                "seconds": round(sum(r["seconds"] for r in selected), 1),
                "deltaVsStandardBkt": round(float(np.mean(fold_aucs) - np.mean(bkt_fold_aucs)), 6),
            }
            entry["pairedVsStandardBkt"] = B.paired(fold_aucs, bkt_fold_aucs[:len(fold_aucs)])
            configs.append(entry)

        headline_config = AKT_HEADLINE if kind == "akt" else DKVMN_HEADLINE
        headline = next((c for c in configs if c["config"] == str(headline_config)), configs[0])
        selectable = [c for c in configs if c["valAucMean"] is not None]
        selected_by_val = max(selectable, key=lambda c: c["valAucMean"]) if selectable else headline
        best = max(configs, key=lambda c: c["aucMean"])
        summary[kind] = {
            "declaredGrid": [str(g) for g in grids[kind]],
            "configs": configs,
            "headlineConfig": {"note": "先验配置，用于论文正文引用（与 DKT 基线同口径）",
                               "pairedVsStandardBkt": headline["pairedVsStandardBkt"], **headline},
            "selectedByTrainFoldValidation": {
                "note": "仅用训练折内部 10% 验证集选择；测试折只评估一次",
                "pairedVsStandardBkt": selected_by_val["pairedVsStandardBkt"], **selected_by_val},
            "bestOfGrid": {"note": "仅作为上界证据，不作为正文结论口径",
                           "config": best["config"], "aucMean": best["aucMean"],
                           "deltaVsHeadline": round(best["aucMean"] - headline["aucMean"], 6)},
        }

    summary["fairnessNote"] = ("三个深度基线（DKT / AKT / DKVMN）使用同一 5 折学生级划分、同一 KC 定义、"
                              "同一批处理与损失函数、同一 epochs 预算与批大小；AKT 与 DKVMN 各自只扫描 2 个维度，"
                              "不扫结构与正则，与 dkt_hyperparam_scan.py 的 6 组扫描同构。")
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "script": os.path.basename(__file__),
        "featuresFile": os.path.abspath(args.features),
        "dataSource": f"EdNet-KT1 | features={os.path.basename(args.features)}",
        "students": len(sequences), "responses": int(responses), "folds": n_folds, "seed": H.SEED,
        "protocol": {"epochs": args.epochs, "batchSize": args.batch_size, "optimizer": "Adam",
                     "loss": "BCELoss(masked)", "earlyStopping": False, "lengthBucketing": True,
                     "valFracForModelSelection": args.val_frac, "jobs": args.jobs},
        "declaredGrids": {k: [str(c) for c in grids[k]] for k in kinds},
        "gridRationale": {"akt": AKT_GRID_RATIONALE},
        "notSwept": ["epochs", "batchSize", "attentionHeads", "dropout", "ffnSizes",
                     "memoryInit", "optimizer", "loss", "architecture", "earlyStopping"],
        "modelVariants": {
            "akt": "AKT-NR（arXiv:2007.12324 的无 Rasch 变体）：特征表仅含 KC 级 skill、无题目 ID，"
                   "题目难度 μ_q 与题目变化向量 d_c 无从估计，故 x_t=c_{c_t}、y_t=c_{c_t}+g_{r_t}；"
                   "单调注意力与上下文感知距离按论文 Eq.2–4 实现，H=8，θ=softplus(θ_raw)。",
            "dkvmn": "DKVMN（WWW 2017, doi:10.1145/3038912.3052580）：静态 key 随机初始化、"
                     "动态 value 零初始化，读/写（erase-then-add）按论文 Eq.6–10 实现；"
                     "记忆更新写成 M←M+w⊗(a−M⊙e)（代数等价，减少一次全量 elementwise）。",
        },
        "performanceNotes": {
            "akt": "显存带宽瓶颈；累积和用 tril 矩阵乘法替代 torch.cumsum（原实现单次 3.04 ms、占单步 25%）。",
            "dkvmn": "kernel 启动瓶颈（GPU 利用率约 12%，≈4500 次启动/步）；用 --jobs 子进程并发压时间，"
                     "不改变任何声明超参。",
            "emitDir": emit_dir, "jobs": args.jobs,
        },
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__,
                        "torch": torch.__version__, "device": str(device),
                        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None},
    }
    with open(os.path.join(out_dir, "run_manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    print(json.dumps({k: v for k, v in summary.items() if isinstance(v, dict) and "configs" in v},
                     ensure_ascii=False, indent=2), flush=True)
    print("outputs:", out_dir, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="AKT / DKVMN 深度基线（与既有 KT 口径一致）")
    parser.add_argument("--features", required=True)
    parser.add_argument("--label", default="ednet-kt1-akt-dkvmn")
    parser.add_argument("--models", default="akt,dkvmn", help="akt / dkvmn / 逗号分隔")
    parser.add_argument("--epochs", type=int, default=H.EPOCHS)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--val-frac", type=float, default=0.1)
    parser.add_argument("--folds", type=int, default=0, help="仅前 N 折（0=全部）")
    parser.add_argument("--jobs", type=int, default=1,
                        help="并发子进程数；实测 8GB 显存下单进程约 0.8GB 峰值 + 0.5GB CUDA context，"
                             "DKVMN 建议 3、AKT 建议 1（AKT 是带宽瓶颈，并发无收益）")
    parser.add_argument("--emit-dir", default="", help="单任务结果目录（断点续跑）")
    parser.add_argument("--only-model", default="", help="子进程模式：只跑该模型的单个任务")
    parser.add_argument("--only-config", default="")
    parser.add_argument("--only-fold", type=int, default=-1)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()

    if args.only_model:
        run_task(args)
        return

    if args.smoke:
        args.epochs, args.folds, args.val_frac, args.jobs = 3, 1, 0.05, 1

    kinds = [k.strip() for k in args.models.split(",") if k.strip()]
    grids = {}
    if "akt" in kinds:
        grids["akt"] = [(d, lr) for d in AKT_DMODELS for lr in AKT_LRS]
    if "dkvmn" in kinds:
        grids["dkvmn"] = [(m, lr) for m in DKVMN_MEMS for lr in DKVMN_LRS]
    if args.smoke:
        grids = {k: [v[0]] for k, v in grids.items()}
    run_scheduled(args, kinds, grids)


if __name__ == "__main__":
    sys.exit(main())
