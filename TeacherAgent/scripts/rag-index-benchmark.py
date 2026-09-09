#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""论文实验 B（表 4）：暴力余弦检索 vs 典型向量索引（FAISS HNSW）同进程对照。

口径说明（写进论文表注）：
  * 两组均在同一 Python 进程内测量，消除跨语言/跨运行时差异；系统实际
    实现（Rust 标量循环）的绝对耗时见表 3（scripts 与 vector.rs bench）。
  * 向量：1536 维单位化伪随机高斯（Irwin–Hall 近似，固定种子可复现），
    与 text-embedding-3-small 维度一致。
  * 指标：top-5 检索耗时（均值/最大/P95，30 查询，前 3 次预热不计入），
    以及 HNSW 相对暴力精确解的 recall@5（一致率）。
  * HNSW 参数：M=32，efSearch=128（FAISS 默认建库 efC=40）。

用法：python rag-index-benchmark.py > rag-index-benchmark.csv
"""
import time
import statistics
import numpy as np
import faiss

DIM = 1536
QUERIES = 30
WARMUP = 3
TOPK = 5
SCALES = [1000, 2000, 3000, 10000]
SEED = 20260909


def normalized_vectors(rng, n):
    x = rng.standard_normal((n, DIM)).astype("float32")
    # Irwin–Hall 与真高斯在基准意义上等价；这里直接用 numpy 高斯保证可复现。
    x /= np.linalg.norm(x, axis=1, keepdims=True)
    return x


def stats(times):
    s = sorted(times)
    p95 = s[round(0.95 * (len(s) - 1))]
    return statistics.fmean(s), s[-1], p95


def main():
    rng = np.random.default_rng(SEED)
    print("scale,brute_mean_ms,brute_max_ms,brute_p95_ms,hnsw_mean_ms,hnsw_max_ms,hnsw_p95_ms,recall_at_5")
    corpus = np.zeros((0, DIM), dtype="float32")
    inserted = 0
    for scale in SCALES:
        add = normalized_vectors(rng, scale - inserted)
        corpus = np.vstack([corpus, add])
        inserted = scale

        index = faiss.IndexHNSWFlat(DIM, 32, faiss.METRIC_INNER_PRODUCT)
        index.hnsw.efConstruction = 40
        index.hnsw.efSearch = 128
        index.add(corpus)

        queries = normalized_vectors(rng, QUERIES)
        brute_t, hnsw_t, hits = [], [], []
        for i, q in enumerate(queries):
            q = np.ascontiguousarray(q[None, :])

            t0 = time.perf_counter()
            sims = corpus @ q.T
            brute_top = np.argpartition(-sims[:, 0], TOPK)[:TOPK]
            brute_top = brute_top[np.argsort(-sims[brute_top, 0])]
            brute_t.append((time.perf_counter() - t0) * 1000)

            t0 = time.perf_counter()
            _, hnsw_ids = index.search(q, TOPK)
            hnsw_t.append((time.perf_counter() - t0) * 1000)

            if i >= WARMUP:
                hits.append(len(set(brute_top.tolist()) & set(hnsw_ids[0].tolist())) / TOPK)

        bm, bx, bp = stats(brute_t[WARMUP:])
        hm, hx, hp = stats(hnsw_t[WARMUP:])
        print(f"{scale},{bm:.2f},{bx:.2f},{bp:.2f},{hm:.2f},{hx:.2f},{hp:.2f},{statistics.fmean(hits) * 100:.1f}")


if __name__ == "__main__":
    main()
