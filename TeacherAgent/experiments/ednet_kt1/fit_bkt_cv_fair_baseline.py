#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Student-level CV fitted BKT fairness baseline for the four EdNet queues.

This is an additive audit script.  It leaves historical evaluation scripts and
archives untouched.  For every queue and every student-level fold, the 81-point
grid is selected using only the other four folds' predictive Bernoulli NLL;
the held-out fold is then evaluated once with the fitted parameters.  The
fixed deployment BKT is recomputed on exactly the same held-out folds.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
BENCH_ROOT = REPO_ROOT / "benchmark-results"
LOCAL_DEPS = REPO_ROOT / "experiments" / "python-deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
sys.path.insert(0, str(HERE))
import run_eval as H  # noqa: E402


QUEUES = {
    "first_tag_2000u": {
        "features": HERE / "data_prep" / "work" / "features_ednet_2000.parquet",
        "existing": "20260914-233838-ednet-kt1-firsttag-2000u-batched-dkt",
    },
    "first_tag_20000u": {
        "features": HERE / "data_prep" / "work" / "features_ednet_20000.parquet",
        "existing": "20260914-232621-ednet-kt1-firsttag-20000u-batched-dkt",
    },
    "single_tag_10000u": {
        "features": HERE / "data_prep" / "work" / "features_ednet_singletag.parquet",
        "existing": "20260914-234626-ednet-kt1-singletag-10000u-dkt",
    },
    "part_20000u": {
        "features": HERE / "data_prep" / "work" / "features_ednet_20000_part.parquet",
        "existing": "20260914-234900-ednet-kt1-part-20000u-dkt",
    },
}

# Pre-declared, deliberately small search space.  Parameter selection never
# observes a held-out response or held-out metric.
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
    skill_ids = np.zeros((len(sequences), max_len), dtype=np.int32)
    responses = np.zeros((len(sequences), max_len), dtype=np.float64)
    for row, seq in enumerate(sequences):
        length = len(seq["correct"])
        skill_ids[row, :length] = [skill_index[str(skill)] for skill in seq["skill"]]
        responses[row, :length] = seq["correct"]
    return skill_ids, responses, lengths, len(skills)


def train_nll(indexes, tensors, params):
    """Predictive Bernoulli NLL for training students only."""
    skill_ids, responses, lengths, n_skills = tensors
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


def fit_fold(train_indexes, tensors):
    rows = []
    response_count = int(tensors[2][np.asarray(train_indexes)].sum())
    for candidate, values in enumerate(itertools.product(*(GRID[key] for key in GRID_KEYS))):
        params = dict(zip(GRID_KEYS, values))
        nll = train_nll(train_indexes, tensors, params)
        rows.append({
            "candidate": candidate,
            **params,
            "trainNll": nll,
            "trainNllPerResponse": nll / response_count if response_count else float("nan"),
        })
    # Product order is deterministic; first candidate wins exact ties.
    return min(rows, key=lambda row: row["trainNll"]), rows


def aggregate(rows):
    if not rows:
        return {"folds": 0, "aucMean": None, "aucStdPopulation": None, "accMean": None, "rmseMean": None, "nTotal": 0}
    return {
        "folds": len(rows),
        "aucMean": float(np.mean([row["auc"] for row in rows])),
        "aucStdPopulation": float(np.std([row["auc"] for row in rows])),
        "accMean": float(np.mean([row["acc"] for row in rows])),
        "rmseMean": float(np.mean([row["rmse"] for row in rows])),
        "nTotal": int(sum(row["n"] for row in rows)),
    }


def exact_sign_flip(left, right):
    diff = np.asarray(left, dtype=np.float64) - np.asarray(right, dtype=np.float64)
    if len(diff) == 0:
        return None
    null = [float(np.mean(diff * np.asarray(signs))) for signs in itertools.product((-1.0, 1.0), repeat=len(diff))]
    observed = float(diff.mean())
    return {
        "meanDiff": observed,
        "foldDeltas": [float(value) for value in diff],
        "folds": len(diff),
        "pExactSignFlip": float(np.mean(np.abs(null) >= abs(observed) - 1e-12)),
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", choices=["all", *QUEUES], default="all")
    parser.add_argument("--label", default="bkt-fitted-cv-ednet")
    args = parser.parse_args()
    queues = list(QUEUES) if args.queue == "all" else [args.queue]
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = BENCH_ROOT / f"{timestamp}-{args.label}"
    out_dir.mkdir(parents=True, exist_ok=False)

    all_rows, all_grid, all_params, comparisons, summary = [], [], [], [], {}
    started_all = time.perf_counter()
    for queue_name in queues:
        spec = QUEUES[queue_name]
        sequences = H.load_sequences(str(spec["features"]))
        tensors = padded_sequences(sequences)
        folds = H.student_folds(sequences, seed=SEED)
        fold_indices = [[sequences.index(sequence) for sequence in fold] for fold in folds]
        queue_rows, queue_grid, queue_params = [], [], []
        started = time.perf_counter()
        for fold, test_list in enumerate(fold_indices):
            test_indexes = np.asarray(test_list, dtype=np.int64)
            train_indexes = np.flatnonzero(np.ones(len(sequences), dtype=bool))
            train_indexes = train_indexes[~np.isin(train_indexes, test_indexes)]
            selected, candidates = fit_fold(train_indexes, tensors)
            for row in candidates:
                queue_grid.append({"queue": queue_name, "fold": fold, **row})
            fitted = {key: selected[key] for key in GRID_KEYS}
            queue_params.append({
                "queue": queue_name,
                "fold": fold,
                "trainStudents": int(len(train_indexes)),
                "testStudents": int(len(test_indexes)),
                "trainResponses": int(tensors[2][train_indexes].sum()),
                "testResponses": int(tensors[2][test_indexes].sum()),
                **fitted,
                "trainNll": selected["trainNll"],
                "trainNllPerResponse": selected["trainNllPerResponse"],
            })
            test_sequences = [sequences[index] for index in test_indexes]
            for model, params in (("fixed_bkt", H.BKT_DEFAULT), ("fitted_bkt", {**H.BKT_DEFAULT, **fitted})):
                y_true, y_pred = H.run_standard_bkt(test_sequences, params=params)
                metric = H.metrics(y_true, y_pred)
                row = {"queue": queue_name, "fold": fold, "model": model, **metric}
                queue_rows.append(row)
                all_rows.append(row)
            print(f"{queue_name} fold={fold} fitted={fitted} trainNLL/response={selected['trainNllPerResponse']:.6f}", flush=True)

        existing_rows, existing_path = read_existing(spec["existing"])
        fitted_rows = [row for row in queue_rows if row["model"] == "fitted_bkt"]
        fixed_rows = [row for row in queue_rows if row["model"] == "fixed_bkt"]
        summary[queue_name] = {
            "featuresFile": str(spec["features"]),
            "students": len(sequences),
            "responses": int(tensors[2].sum()),
            "folds": len(fold_indices),
            "fitObjective": "training-fold Bernoulli predictive negative log-likelihood",
            "fittedBkt": aggregate(fitted_rows),
            "fixedBkt": aggregate(fixed_rows),
            "fittedVsFixedAuc": exact_sign_flip(
                [row["auc"] for row in fitted_rows], [row["auc"] for row in fixed_rows]
            ),
            "existingArchive": spec["existing"],
            "existingArchivePath": existing_path,
            "elapsedSeconds": time.perf_counter() - started,
        }
        existing_models = {model for model in {row["model"] for row in existing_rows}}
        for model in sorted(existing_models):
            comparisons.append({"queue": queue_name, "model": model, **aggregate([row for row in existing_rows if row["model"] == model]), "source": existing_path})
        comparisons.extend([
            {"queue": queue_name, "model": "fixed_bkt_recomputed", **aggregate(fixed_rows), "source": "new_script"},
            {"queue": queue_name, "model": "fitted_bkt", **aggregate(fitted_rows), "source": "new_script"},
        ])
        all_grid.extend(queue_grid)
        all_params.extend(queue_params)

    def write_csv(name, fields, rows):
        with (out_dir / name).open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    write_csv("results.csv", ["queue", "fold", "model", "auc", "acc", "rmse", "n"], all_rows)
    write_csv("fit_grid.csv", ["queue", "fold", "candidate", *GRID_KEYS, "trainNll", "trainNllPerResponse"], all_grid)
    write_csv("fit_params.csv", ["queue", "fold", "trainStudents", "testStudents", "trainResponses", "testResponses", *GRID_KEYS, "trainNll", "trainNllPerResponse"], all_params)
    write_csv("comparison_summary.csv", ["queue", "model", "folds", "aucMean", "aucStdPopulation", "accMean", "rmseMean", "nTotal", "source"], comparisons)
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workItem": "submission fix 1: training-fold-fitted BKT fairness baseline",
        "script": str(Path(__file__).resolve()),
        "queues": queues,
        "seed": SEED,
        "folding": "student-level 5-fold assignment using run_eval.student_folds; each test fold is evaluation-only",
        "selection": {
            "objective": "minimize training-fold Bernoulli predictive negative log-likelihood",
            "grid": GRID,
            "gridSize": int(np.prod([len(values) for values in GRID.values()])),
            "tieBreak": "first candidate in lexicographic product order",
            "testUse": "selected parameters are applied once to the held-out test fold; no test response or metric enters selection",
        },
        "fixedBaseline": H.BKT_DEFAULT,
        "existingComparisonArchives": {name: QUEUES[name]["existing"] for name in queues},
        "notes": [
            "Fixed BKT remains the deployment-oriented no-training baseline.",
            "Fold summaries are exploratory CV estimates; five folds are not independent repetitions.",
            "Historical archives are read-only inputs and are not overwritten.",
        ],
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__},
        "elapsedSeconds": time.perf_counter() - started_all,
    }
    (out_dir / "run_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    unified = {
        "generatedAt": manifest["generatedAt"],
        "archive": str(out_dir),
        "method": manifest["selection"],
        "seed": SEED,
        "queues": summary,
        "comparisonRows": comparisons,
        "interpretation": "探索性学生级5折CV；不将5折视为5次独立重复。",
    }
    (out_dir / "summary.json").write_text(json.dumps(unified, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "README.md").write_text(
        "# Training-fold fitted BKT baseline\n\n"
        "This archive contains the additive fairness baseline for four EdNet-KT1 queues. "
        "Student-level five-fold splits use seed 42. In each fold, a pre-declared 81-point "
        "grid for p(L0), p(T), p(G), and p(S) is selected by training-fold predictive "
        "Bernoulli NLL; the held-out fold is used only for AUC, ACC, and RMSE. `fixed_bkt` "
        "keeps the deployment parameters from `run_eval.py`, while `fitted_bkt` is the "
        "fairness comparison. The five folds are exploratory CV estimates, not independent "
        "replications. See `summary.json`, `fit_params.csv`, `fit_grid.csv`, and `results.csv`.\n",
        encoding="utf-8",
    )
    print(json.dumps({"archive": str(out_dir), "summary": unified}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
