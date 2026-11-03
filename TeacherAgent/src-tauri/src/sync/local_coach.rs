//! B1 untrusted flat inference records: storage/display only, no BKT consumers.
use serde_json::Value;
const MODEL: &str = "daed6c55a53da9196c8ce1f6ce5b645d731ad628d3b78946b0f564dd56e83cf8";
const RESERVED: &[&str] = &[
    "inferences",
    "fallback_reason",
    "model_id",
    "model_sha256",
    "r_focus",
    "n_distract",
    "perceived_difficulty",
    "confidence",
    "risk",
    "commitment",
    "abandon_reason",
    "frustration_level",
    "suggest_action",
    "bkt_signal",
];
fn choice(v: &Value, choices: &[&str]) -> bool {
    v.as_str().is_some_and(|s| choices.contains(&s))
}
fn number(v: &Value, low: f64, high: f64) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && (low..=high).contains(&n))
}
pub(crate) fn valid_record(v: &Value) -> bool {
    let Some(obj) = v.as_object() else {
        return false;
    };
    if v["model_id"] != "qwen2.5-0.5b-bkt-v2-q4_k_m"
        || v["model_sha256"] != MODEL
        || v["schema_version"].as_i64() != Some(1)
        || !v["created_at"]
            .as_i64()
            .is_some_and(|t| (0..=9_007_199_254_740_991).contains(&t))
    {
        return false;
    }
    let model = v["source"] == "model";
    if !choice(
        &v["source"],
        &["model", "fallback_rule", "fallback_default"],
    ) || !(if model {
        v["fallback_reason"] == "none"
    } else {
        choice(
            &v["fallback_reason"],
            &[
                "model_missing",
                "hash_mismatch",
                "oom",
                "low_battery",
                "timeout",
                "invalid_output",
                "runtime_error",
            ],
        )
    }) {
        return false;
    }
    let fields: &[&str] = match v["task"].as_str() {
        Some("extract_factors") => {
            if !number(&v["r_focus"], 0.0, 1.0)
                || !v["n_distract"]
                    .as_i64()
                    .is_some_and(|n| (0..=i32::MAX as i64).contains(&n))
            {
                return false;
            }
            if model {
                if !number(&v["perceived_difficulty"], 0.0, 1.0)
                    || !number(&v["confidence"], 0.0, 1.0)
                {
                    return false;
                }
            } else if v["source"] != "fallback_default"
                || v["r_focus"].as_f64() != Some(1.0)
                || v["n_distract"].as_i64() != Some(0)
                || !v["perceived_difficulty"].is_null()
                || !v["confidence"].is_null()
            {
                return false;
            }
            &[
                "r_focus",
                "n_distract",
                "perceived_difficulty",
                "confidence",
            ]
        }
        Some("plan_create_advice") => {
            if !choice(&v["risk"], &["none", "vague", "overload"])
                || !(if model {
                    number(&v["commitment"], 0.0, 1.0)
                } else {
                    v["source"] == "fallback_rule" && v["commitment"].is_null()
                })
            {
                return false;
            }
            &["risk", "commitment"]
        }
        Some("plan_delete_inference") => {
            if !model
                || !choice(
                    &v["abandon_reason"],
                    &[
                        "difficulty_avoidance",
                        "time_conflict",
                        "already_completed",
                        "burnout",
                        "plan_adjustment",
                    ],
                )
                || !choice(&v["frustration_level"], &["low", "medium", "high"])
                || !choice(
                    &v["suggest_action"],
                    &[
                        "split_into_micro_steps",
                        "reschedule",
                        "switch_subject",
                        "rest",
                    ],
                )
                || !number(&v["bkt_signal"], -0.3, 0.1)
            {
                return false;
            }
            &[
                "abandon_reason",
                "frustration_level",
                "suggest_action",
                "bkt_signal",
            ]
        }
        _ => return false,
    };
    let common = [
        "task",
        "source",
        "fallback_reason",
        "model_id",
        "model_sha256",
        "schema_version",
        "created_at",
    ];
    obj.len() == common.len() + fields.len()
        && common.iter().chain(fields).all(|k| obj.contains_key(*k))
}
pub(crate) fn valid_records(records: &[Value]) -> bool {
    let mut tasks = std::collections::HashSet::new();
    records.len() <= 3
        && records
            .iter()
            .all(|r| valid_record(r) && tasks.insert(r["task"].as_str().unwrap_or("")))
}
pub(crate) fn fact_contains_inference(code: &str, value: &Value) -> bool {
    fn nested(value: &Value, depth: usize) -> bool {
        if depth > 32 {
            return true;
        }
        match value {
            Value::Object(o) => {
                o.keys().any(|k| RESERVED.contains(&k.as_str()))
                    || o.values().any(|v| nested(v, depth + 1))
            }
            Value::Array(a) => a.iter().any(|v| nested(v, depth + 1)),
            _ => false,
        }
    }
    RESERVED.contains(&code) || nested(value, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(
        name: &str,
    ) -> super::super::protocol::Envelope<super::super::protocol::SnapshotPayload> {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../sync/protocol/fixtures");
        serde_json::from_str(&std::fs::read_to_string(root.join(name)).unwrap()).unwrap()
    }
    #[test]
    fn three_tasks_and_fallback_records_pass_the_production_validator() {
        for name in [
            "snapshot-inferences-task1-valid.json",
            "snapshot-inferences-task2-valid.json",
            "snapshot-inferences-task3-valid.json",
            "snapshot-inferences-all-valid.json",
            "snapshot-inferences-fallback-valid.json",
        ] {
            let e = fixture(name);
            super::super::protocol::validate_learning_analysis(
                &e.payload,
                e.snapshot_id.as_deref().unwrap(),
            )
            .unwrap();
            let json = serde_json::to_string(&e.payload.learning_analysis).unwrap();
            assert!(!json.contains("evidence\":"));
            assert!(!json.contains("advice\":"));
        }
    }
    #[test]
    fn both_privacy_fields_unknown_fields_enums_and_signal_boundaries_are_rejected() {
        for name in [
            "evidence",
            "advice",
            "unexpected",
            "enum",
            "bkt-negative",
            "bkt-positive",
            "task3-fallback",
            "facts-promotion",
        ] {
            let e = fixture(&format!("snapshot-inferences-{name}-invalid.json"));
            assert!(
                super::super::protocol::validate_learning_analysis(
                    &e.payload,
                    e.snapshot_id.as_deref().unwrap()
                )
                .is_err(),
                "{name}"
            );
        }
    }
    #[test]
    fn missing_block_keeps_old_client_usable() {
        let e = fixture("snapshot-valid.json");
        assert!(e
            .payload
            .learning_analysis
            .as_ref()
            .unwrap()
            .inferences
            .is_none());
        super::super::protocol::validate_learning_analysis(
            &e.payload,
            e.snapshot_id.as_deref().unwrap(),
        )
        .unwrap();
    }
    #[test]
    fn duplicate_tasks_and_forged_default_observations_fail() {
        let e = fixture("snapshot-inferences-fallback-valid.json");
        let records = e.payload.learning_analysis.unwrap().inferences.unwrap();
        assert!(!valid_records(&[records[0].clone(), records[0].clone()]));
        let mut bad = records[0].clone();
        bad["r_focus"] = serde_json::json!(0.7);
        assert!(!valid_record(&bad));
    }
}
