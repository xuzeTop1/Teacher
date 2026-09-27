#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fit a BKT baseline inside each EdNet student-CV training fold.

This is an additive submission audit.  It imports the existing EdNet loader and
metric implementation, but never changes the historical evaluation scripts or
archives.  The fixed BKT baseline remains the deployment-oriented baseline;
the fitted BKT is selected only from the training students of each fold by
Bernoulli predictive negative log-likelihood.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
EXP_ROOT = REPO_ROOT / "experiments" / "ednet_kt1"
BENCH_ROOT = REPO_ROOT / "benchmark-results"
LOCAL_DEPS = REPO_ROOT / "experiments" / "python-deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
sys.path.insert(0, str(EXP_ROOT))
import run_eval as H  # noqa: E402


QUEUES = {
    "first_tag_2000u": {
        "features": EXP_ROOT / "data_prep" / "work" / "features_ednet_2000.parquet",
        "existing": "20260914-233838-ednet-kt1-firsttag-2000u-batched-dkt",
    },
    "first_tag_20000u": {
        "features": EXP_ROOT / "data_prep" / "work" / "features_ednet_20000.parquet",
        "existing": "20260914-232621-ednet-kt1-firsttag-20000u-batched-dkt",
    },
    "single_tag_10000u": {
        "features": EXP_ROOT / "data_prep" / "work" / "features_ednet_singletag.parquet",
        "existing": "20260914-234626-ednet-kt1-singletag-10000u-dkt",
    },
    "part_20000u": {
        "features": EXP_ROOT / "data_prep" / "work" / "features_ednet_20000_part.parquet",
        "existing": "20260914-234900-ednet-kt1-part-20000u-dkt",
    },
}

# Pre-declared, deliberately small grid.  p(L0), p(T), p(G), p(S) are all
# chosen only from the training fold.  The grid is not chosen from test AUC.
GRID = {
    "pL0": (0.10, 0.30, 0.50),
    "pT": (0.05, 0.10, 0.20),
    "pG": (0.10, 0.25, 0.40),
    "pS": (0.05, 0.10, 0.20),
}
GRID_KEYS = tuple(GRID)
SEED = H.SEED


def padded_sequences(sequences):
    skills = sorted({str(skill) for seq in sequences for skill in seq["skill"]})
    skill_index = {skill: index for index, skill in enumerate(skills)}
    lengths = np.asarray([len(seq["correct"]) for seq in sequences], dtype=np.int32)
    max_len = int(lengths.max()) if len(lengths) else 0
    skill_ids = np.zeros((len(sequences), max_len), dtype=np.int16)
    responses = np.zeros((len(sequences), max_len), dtype=np.float32)
    for row, seq in enumerate(sequences):
        length = len(seq["correct"])
        skill_ids[row, :length] = [skill_index[str(skill)] for skill in seq["skill"]]
        responses[row, :length] = seq["correct"]
    return skill_ids, responses, lengths, len(skills)


def train_nll(indexes, skill_ids, responses, lengths, n_skills, params):
    """Vectorized BKT predictive NLL over sequences in one training fold."""
    indexes = np.asarray(indexes, dtype=np.int64)
    if len(indexes) == 0:
        return float("inf")
    skills = skill_ids[indexes]
    observations = responses[indexes]
    seq_lengths = lengths[indexes]
    state = np.full((len(indexes), n_skills), float(params["pL0"]), dtype=np.float64)
    rows = np.arange(len(indexes), dtype=np.int64)
    nll = 0.0
    for step in range(skills.shape[1]):
        active = seq_lengths > step
        if not np.any(active):
            break
        rr = rows[active]
        kk = skills[active, step]
        previous = state[rr, kk]
        p_correct = previous * (1.0 - params["pS"]) + (1.0 - previous) * params["pG"]
        obs = observations[active, step]
        likelihood = np.where(obs > 0.0, p_correct, 1.0 - p_correct)
        nll -= float(np.log(np.clip(likelihood, 1e-12, 1.0)).sum())
        posterior = np.where(
            obs > 0.0,
            previous * (1.0 - params["pS"]) / np.clip(p_correct, 1e-12, 1.0),
            previous * params["pS"] / np.clip(1.0 - p_correct, 1e-12, 1.0),
        )
        state[rr, kk] = posterior + (1.0 - posterior) * params["pT"]
    return nll


def all_grid_rows(train_indexes, tensors):
    skill_ids, responses, lengths, n_skills = tensors
    rows = []
    for values in itertools.product(*(GRID[key] for key in GRID_KEYS)):
        params = dict(zip(GRID_KEYS, values))
        nll = train_nll(train_indexes, skill_ids, responses, lengths, n_skills, params)
        rows.append({**params, "trainNll": nll, "trainNllPerResponse": nll / int(lengths[train_indexes].sum())})
    return rows


def fit_fold(train_indexes, tensors):
    rows = all_grid_rows(train_indexes, tensors)
    # Product order above is deterministic.  min() preserves its first item
    # on exact ties, providing an explicit deterministic tie-break.
    selected = min(rows, key=lambda row: row["trainNll"])
    return selected, rows


def exact_sign_flip(left, right):
    diff = np.asarray(left, dtype=np.float64) - np.asarray(right, dtype=np.float64)
    if len(diff) == 0:
        return None
    null = [float(np.mean(diff * np.asarray(signs))) for signs in itertools.product((-1.0, 1.0), repeat=len(diff))]
    observed = float(diff.mean())
    p = float(np.mean(np.abs(null) >= abs(observed) - 1e-12))
    return {
        "meanDiff": observed,
        "foldDeltas": [float(x) for x in diff],
        "folds": len(diff),
        "pExactSignFlip": p,
        "minimumAchievableTwoSidedP": 2.0 / (2 ** len(diff)),
    }


def read_existing(folder):
    path = BENCH_ROOT / folder / "results.csv"
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            row["fold"] = int(row["fold"])
            for key in ("auc", "acc", "rmse", "n"):
                row[key] = float(row[key])
            rows.append(row)
    return rows, str(path)


def aggregate(rows):
    out = {}
    for model in sorted({row["model"] for row in rows}):
        values = [row for row in rows if row["model"] == model]
        out[model] = {
            "folds": len(values),
            "aucMean": float(np.mean([row["auc"] for row in values])),
            "aucStdPopulation": float(np.std([row["auc"] for row in values])),
            "accMean": float(np.mean([row["acc"] for row in values])),
            "rmseMean": float(np.mean([row["rmse"] for row in values])),
            "nTotal": int(sum(row["n"] for row in values)),
        }
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", choices=["all", *QUEUES], default="all")
    parser.add_argument("--label", default="bkt-fitted-cv-ednet")
    args = parser.parse_args()
    selected_queues = list(QUEUES) if args.queue == "all" else [args.queue]

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = BENCH_ROOT / f"{timestamp}-{args.label}"
    out_dir.mkdir(parents=True, exist_ok=False)
    all_rows = []
    all_fit_rows = []
    all_params = []
    queue_summaries = {}
    comparison_rows = []

    for queue_name in selected_queues:
        spec = QUEUES[queue_name]
        started = time.perf_counter()
        sequences = H.load_sequences(str(spec["features"]))
        tensors = padded_sequences(sequences)
        folds = H.student_folds(sequences, seed=SEED)
        fold_indices = [[sequences.index(seq) for seq in fold] for fold in folds]
        all_indexes = np.arange(len(sequences), dtype=np.int64)
        queue_rows = []
        queue_fit_rows = []
        queue_params = []
        for fold, test_index_list in enumerate(fold_indices):
            test_indexes = np.asarray(test_index_list, dtype=np.int64)
            train_mask = np.ones(len(sequences), dtype=bool)
            train_mask[test_indexes] = False
            train_indexes = np.flatnonzero(train_mask)
            selected, grid_rows = fit_fold(train_indexes, tensors)
            for candidate, grid_row in enumerate(grid_rows):
                queue_fit_rows.append({"queue": queue_name, "fold": fold, "candidate": candidate, **grid_row})
            fitted_params = {key: selected[key] for key in GRID_KEYS}
            queue_params.append({
                "queue": queue_name,
                "fold": fold,
                "trainStudents": len(train_indexes),
                "testStudents": len(test_indexes),
                "trainResponses": int(tensors[2][train_indexes].sum()),
                "testResponses": int(tensors[2][test_indexes].sum()),
                **fitted_params,
                "trainNll": selected["trainNll"],
                "trainNllPerResponse": selected["trainNllPerResponse"],
            })
            test_sequences = [sequences[i] for i in test_indexes]
            for model, params in (("fixed_bkt", H.BKT_DEFAULT), ("fitted_bkt", {**H.BKT_DEFAULT, **fitted_params})):
                y_true, y_pred = H.run_standard_bkt(test_sequences, params=params)
                metric = H.metrics(y_true, y_pred)
                row = {"queue": queue_name, "fold": fold, "model": model, **metric}
                queue_rows.append(row)
                all_rows.append(row)
            print(f"{queue_name} fold={fold} fitted={fitted_params} trainNLL/resp={selected['trainNllPerResponse']:.6f}", flush=True)

        existing_rows, existing_path = read_existing(spec["existing"])
        existing_agg = aggregate(existing_rows)
        fitted_rows = [row for row in queue_rows if row["model"] == "fitted_bkt"]
        fixed_rows = [row for row in queue_rows if row["model"] == "fixed_bkt"]
        queue_summaries[queue_name] = {
            "featuresFile": spec["features"].name,
            "students": len(sequences),
            "responses": int(tensors[2].sum()),
            "folds": len(fold_indices),
            "fitObjective": "training-fold Bernoulli predictive negative log-likelihood",
            "fittedBkt": aggregate(fitted_rows)["fitted_bkt"],
            "fixedBkt": aggregate(fixed_rows)["fixed_bkt"],
            "existingArchive": spec["existing"],
            "existingArchivePath": existing_path,
            "fittedVsFixedAuc": exact_sign_flip(
                [row["auc"] for row in fitted_rows], [row["auc"] for row in fixed_rows]
            ),
            "elapsedSeconds": time.perf_counter() - started,
        }
        for model, metrics in existing_agg.items():
            comparison_rows.append({"queue": queue_name, "model": model, **metrics, "source": existing_path})
        comparison_rows.append({"queue": queue_name, "model": "fixed_bkt_recomputed", **aggregate(fixed_rows)["fixed_bkt"], "source": "new_script"})
        comparison_rows.append({"queue": queue_name, "model": "fitted_bkt", **aggregate(fitted_rows)["fitted_bkt"], "source": "new_script"})
        all_fit_rows.extend(queue_fit_rows)
        all_params.extend(queue_params)

    with (out_dir / "results.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["queue", "fold", "model", "auc", "acc", "rmse", "n"])
        writer.writeheader(); writer.writerows(all_rows)
    with (out_dir / "fit_grid.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        fields = ["queue", "fold", "candidate", *GRID_KEYS, "trainNll", "trainNllPerResponse"]
        writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader(); writer.writerows(all_fit_rows)
    with (out_dir / "fit_params.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        fields = list(all_params[0]) if all_params else []
        writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader(); writer.writerows(all_params)
    with (out_dir / "comparison_summary.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        fields = list(comparison_rows[0]) if comparison_rows else []
        writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader(); writer.writerows(comparison_rows)

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workItem": "submission fix 1: training-fold-fitted BKT fairness baseline",
        "queues": selected_queues,
        "seed": SEED,
        "folding": "student-level 5-fold assignment, seed 42; test fold is evaluation-only",
        "selection": {
            "objective": "minimize training-fold Bernoulli predictive negative log-likelihood",
            "grid": GRID,
            "gridSize": int(np.prod([len(values) for values in GRID.values()])),
            "tieBreak": "first candidate in lexicographic product order",
            "testUse": "selected parameters are applied once to the held-out test fold; no test AUC enters selection",
        },
        "fixedBaseline": H.BKT_DEFAULT,
        "existingComparisonArchives": {name: QUEUES[name]["existing"] for name in selected_queues},
        "notes": [
            "Fixed BKT remains the deployment-oriented no-training baseline.",
            "Fold-level summaries are exploratory because five CV folds are not independent repetitions.",
            "The DKT and FB-BKT columns in comparison_summary.csv are copied from prior immutable archives; this run only adds fitted BKT and recomputes fixed BKT.",
        ],
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__},
    }
    (out_dir / "run_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "README.md").write_text(
        "# Training-fold fitted BKT baseline\n\n"
        "For each of the four EdNet queues, the five student folds are fixed by seed 42.\n"
        "The 81-point grid is selected on training-fold predictive Bernoulli NLL only.\n"
        "The held-out fold is used only once for AUC/ACC/RMSE evaluation. `fixed_bkt`\n"
        "retains the historical deployment parameters; `fitted_bkt` is the fairness\n"
        "comparison baseline. Five folds are summarized as exploratory CV estimates,\n"
        "not five independent replications.\n",
        encoding="utf-8",
    )
    print(json.dumps({"outputs": str(out_dir), "queues": queue_summaries}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
