//! FB-BKT：融合端侧行为的遗忘感知贝叶斯知识追踪（论文 §4.3）。
//!
//! 与标准 BKT 的两点差异：
//!   1. 后验更新前先按艾宾浩斯型指数衰减修正先验：`P(L_t^-) = P(L_{t-1}) · e^{-λ·Δt}`；
//!   2. 学习转移概率按端侧专注特征调节：`P_T' = P_T · (1 + α·R_focus / (1 + β·N_distract))`。
//!
//! 更新顺序遵循论文式 (5)–(7)：先以 `P(L_t^-)` 为条件做观测后验，再施加
//! `P_T'` 的转移更新。注意这与本 crate 早期 `bkt::bkt_update` 的"先转移后观测"
//! 变体不同；λ=0、α=0 时本模块退化为经典顺序的标准 BKT（见 tests）。

use serde::{Deserialize, Serialize};

/// FB-BKT 参数。BKT 四参数与 §4.3 保持一致，λ/α/β 为冷启动占位值。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct FbBktParams {
    /// 先验掌握概率 P(L0)
    pub p_l0: f64,
    /// 学习转移概率 P(T)
    pub p_t: f64,
    /// 猜对概率 P(G)
    pub p_g: f64,
    /// 失误概率 P(S)
    pub p_s: f64,
    /// 记忆衰减率 λ（day⁻¹），冷启动占位 0.05
    pub lambda: f64,
    /// 专注度调节系数 α，冷启动占位 0.5
    pub alpha: f64,
    /// 分心惩罚系数 β，冷启动占位 0.3
    pub beta: f64,
    /// 掌握判定阈值，默认 0.8
    pub mastery_threshold: f64,
}

impl Default for FbBktParams {
    fn default() -> Self {
        Self {
            p_l0: 0.5,
            p_t: 0.1,
            p_g: 0.25,
            p_s: 0.1,
            lambda: 0.05,
            alpha: 0.5,
            beta: 0.3,
            mastery_threshold: 0.8,
        }
    }
}

/// 一次 FB-BKT 更新的输入。端侧特征来自同步快照的聚合层。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct FbBktInputs {
    /// 上一次的掌握概率 P(L_{t-1})；首次作答取 P(L0)
    pub p_l_prev: f64,
    /// 生产评估路径中，为桌面本次写入时刻距该节点 last_response_at 的间隔（天）。
    /// last_response_at 仅在 FB 分支写入，增量分支不更新；首次无时间戳时取 0。
    pub delta_t_days: f64,
    /// 前序学习会话有效专注率 R_focus ∈ [0,1]
    pub r_focus: f64,
    /// 分心事件计数 N_distract（非负整数）
    pub n_distract: u32,
    /// 本次作答是否正确
    pub obs: bool,
}

/// 一次 FB-BKT 更新的全部中间量，便于落库回放。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct FbBktOutput {
    /// 遗忘衰减后的先验 P(L_t^-)
    pub p_l_minus: f64,
    /// 专注度调节后的转移概率 P_T'
    pub p_t_prime: f64,
    /// 观测后验 P(L_t | obs)
    pub p_l_post_obs: f64,
    /// 施加转移后的最终掌握概率 P(L_t)
    pub p_l_final: f64,
    /// 是否达到掌握阈值
    pub mastered: bool,
}

/// 依论文式 (3)–(7) 执行一次 FB-BKT 更新。
pub(crate) fn update(params: &FbBktParams, inputs: &FbBktInputs) -> FbBktOutput {
    let p_l_prev = clamp_probability(inputs.p_l_prev);
    let delta_t = inputs.delta_t_days.max(0.0);
    let r_focus = inputs.r_focus.clamp(0.0, 1.0);

    // 式 (3)：艾宾浩斯型指数遗忘衰减。
    let p_l_minus = p_l_prev * (-params.lambda * delta_t).exp();

    // 式 (4)：端侧专注特征调节学习转移概率，上界为 (1+α)·P_T。
    let p_t_prime = params.p_t
        * (1.0 + params.alpha * r_focus / (1.0 + params.beta * inputs.n_distract as f64));

    // 式 (5)/(6)：以 P(L_t^-) 为条件的贝叶斯后验。
    let (numerator, denominator) = if inputs.obs {
        (
            p_l_minus * (1.0 - params.p_s),
            p_l_minus * (1.0 - params.p_s) + (1.0 - p_l_minus) * params.p_g,
        )
    } else {
        (
            p_l_minus * params.p_s,
            p_l_minus * params.p_s + (1.0 - p_l_minus) * (1.0 - params.p_g),
        )
    };
    let p_l_post_obs = if denominator > 0.0 {
        numerator / denominator
    } else {
        // P(L^-)=0 且 obs 分支分母退化时保持原状态，避免 NaN。
        p_l_minus
    };

    // 式 (7)：观测后验之上施加学习转移。
    let p_l_final = p_l_post_obs + (1.0 - p_l_post_obs) * p_t_prime;
    let p_l_final = clamp_probability(p_l_final);

    FbBktOutput {
        p_l_minus,
        p_t_prime,
        p_l_post_obs: clamp_probability(p_l_post_obs),
        p_l_final,
        mastered: p_l_final >= params.mastery_threshold,
    }
}

fn clamp_probability(value: f64) -> f64 {
    if value.is_nan() {
        return 0.0;
    }
    value.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(
        p_l_prev: f64,
        delta_t_days: f64,
        r_focus: f64,
        n_distract: u32,
        obs: bool,
    ) -> FbBktInputs {
        FbBktInputs {
            p_l_prev,
            delta_t_days,
            r_focus,
            n_distract,
            obs,
        }
    }

    /// 经典顺序标准 BKT（先观测后验、后学习转移），作为 λ=0、α=0 的 oracle。
    fn classic_bkt_oracle(p_l_prev: f64, obs: bool, p_t: f64, p_g: f64, p_s: f64) -> f64 {
        let post = if obs {
            p_l_prev * (1.0 - p_s) / (p_l_prev * (1.0 - p_s) + (1.0 - p_l_prev) * p_g)
        } else {
            p_l_prev * p_s / (p_l_prev * p_s + (1.0 - p_l_prev) * (1.0 - p_g))
        };
        post + (1.0 - post) * p_t
    }

    #[test]
    fn zero_interval_keeps_prior_unchanged() {
        let params = FbBktParams::default();
        let out = update(&params, &inputs(0.62, 0.0, 0.8, 1, true));
        assert!(
            (out.p_l_minus - 0.62).abs() < 1e-12,
            "Δt=0 时衰减应为恒等，got {}",
            out.p_l_minus
        );
    }

    #[test]
    fn zero_focus_and_zero_distraction_keep_base_transition() {
        let params = FbBktParams::default();
        let out = update(&params, &inputs(0.3, 1.0, 0.0, 0, true));
        assert!(
            (out.p_t_prime - params.p_t).abs() < 1e-12,
            "R_focus=0、N_distract=0 时 P_T' 应等于 P_T，got {}",
            out.p_t_prime
        );
    }

    #[test]
    fn full_focus_scales_transition_by_alpha() {
        let params = FbBktParams::default();
        let out = update(&params, &inputs(0.3, 1.0, 1.0, 0, true));
        let expected = params.p_t * (1.0 + params.alpha);
        assert!(
            (out.p_t_prime - expected).abs() < 1e-12,
            "R_focus=1、N_distract=0 时 P_T' 应为 (1+α)·P_T={expected}，got {}",
            out.p_t_prime
        );
    }

    #[test]
    fn transition_is_monotonic_non_decreasing_in_focus() {
        let params = FbBktParams::default();
        let mut previous = f64::NEG_INFINITY;
        for step in 0..=10 {
            let r_focus = step as f64 / 10.0;
            let out = update(&params, &inputs(0.4, 2.0, r_focus, 2, true));
            assert!(
                out.p_t_prime >= previous - 1e-15,
                "P_T' 应随 R_focus 单调不降：r={r_focus} got {} prev {previous}",
                out.p_t_prime
            );
            previous = out.p_t_prime;
        }
    }

    #[test]
    fn transition_is_monotonic_non_increasing_in_distraction() {
        let params = FbBktParams::default();
        let mut previous = f64::INFINITY;
        for n_distract in 0..=10u32 {
            let out = update(&params, &inputs(0.4, 2.0, 0.8, n_distract, true));
            assert!(
                out.p_t_prime <= previous + 1e-15,
                "P_T' 应随 N_distract 单调不增：n={n_distract} got {} prev {previous}",
                out.p_t_prime
            );
            previous = out.p_t_prime;
        }
    }

    #[test]
    fn decay_is_monotonic_non_increasing_in_interval() {
        let params = FbBktParams::default();
        let mut previous = f64::INFINITY;
        for step in 0..=12 {
            let delta_t = step as f64 * 2.0;
            let out = update(&params, &inputs(0.75, delta_t, 0.5, 0, true));
            assert!(
                out.p_l_minus <= previous + 1e-15,
                "P(L^-) 应随 Δt 单调不增：Δt={delta_t} got {} prev {previous}",
                out.p_l_minus
            );
            previous = out.p_l_minus;
        }
    }

    #[test]
    fn paper_case_study_decay_value() {
        // 论文 7.7 节场景：P(L_{t-1})=0.62、Δt=6 天、λ=0.05 → P(L^-)≈0.4593
        let params = FbBktParams::default();
        let out = update(&params, &inputs(0.62, 6.0, 0.813, 3, false));
        assert!(
            (out.p_l_minus - 0.4593).abs() < 1e-3,
            "期望 P(L^-)≈0.4593，got {}",
            out.p_l_minus
        );
    }

    #[test]
    fn paper_case_study_adjusted_transition_value() {
        // R_focus=0.813、N_distract=3、α=0.5、β=0.3、P_T=0.1 → P_T'≈0.1214
        let params = FbBktParams::default();
        let out = update(&params, &inputs(0.62, 6.0, 0.813, 3, false));
        assert!(
            (out.p_t_prime - 0.1214).abs() < 1e-3,
            "期望 P_T'≈0.1214，got {}",
            out.p_t_prime
        );
    }

    #[test]
    fn degenerate_parameters_match_classic_bkt() {
        // λ=0、α=0 → 与经典顺序标准 BKT 逐位一致（同一更新顺序的 oracle）。
        let params = FbBktParams {
            lambda: 0.0,
            alpha: 0.0,
            ..FbBktParams::default()
        };
        for p_l_prev in [0.05, 0.3, 0.5, 0.62, 0.9] {
            for obs in [true, false] {
                let out = update(&params, &inputs(p_l_prev, 7.0, 0.0, 0, obs));
                let oracle = classic_bkt_oracle(p_l_prev, obs, params.p_t, params.p_g, params.p_s);
                assert!(
                    (out.p_l_final - oracle).abs() < 1e-12,
                    "退化情形应与经典 BKT 逐位一致：p={p_l_prev} obs={obs} got {} oracle {oracle}",
                    out.p_l_final
                );
            }
        }
    }

    #[test]
    fn degenerate_output_equals_manually_recomputed_transition() {
        // 退化的另一条独立断言：P(L_t) = post + (1-post)·P_T
        let params = FbBktParams {
            lambda: 0.0,
            alpha: 0.0,
            ..FbBktParams::default()
        };
        let out = update(&params, &inputs(0.4, 3.0, 0.7, 2, true));
        let expected = out.p_l_post_obs + (1.0 - out.p_l_post_obs) * params.p_t;
        assert!((out.p_l_final - expected).abs() < 1e-12);
    }

    #[test]
    fn extreme_priors_do_not_produce_nan() {
        let params = FbBktParams::default();
        for p_l_prev in [0.0, 1.0] {
            for obs in [true, false] {
                let out = update(&params, &inputs(p_l_prev, 1.0, 1.0, 3, obs));
                assert!(!out.p_l_minus.is_nan(), "p_l_minus NaN at {p_l_prev}/{obs}");
                assert!(!out.p_l_post_obs.is_nan(), "post NaN at {p_l_prev}/{obs}");
                assert!(!out.p_l_final.is_nan(), "final NaN at {p_l_prev}/{obs}");
                assert!((0.0..=1.0).contains(&out.p_l_final));
            }
        }
    }

    #[test]
    fn very_long_interval_decays_without_denormal() {
        let params = FbBktParams::default();
        let out = update(&params, &inputs(0.9, 3650.0, 0.5, 0, true));
        assert!(out.p_l_minus.is_finite());
        assert!(
            out.p_l_minus < 1e-10,
            "十年间隔应衰减到接近 0，got {}",
            out.p_l_minus
        );
        assert!(out.p_l_final > 0.0, "转移更新后仍应有 P_T' 的上界");
    }

    /// 批量评测入口（论文 §7.4 的 ASSISTments 精度评测用）：与生产实现同源，
    /// 避免在 Python 侧重写公式。**按作答序列推进状态链**（同一知识点跨步累积）。
    ///
    /// 读 `FB_BKT_EVAL_IN`（JSONL，每行一个序列请求）→ 写 `FB_BKT_EVAL_OUT`（每行一个序列结果）。
    /// 请求形如：
    /// `{"params":{"pT":0.1,"pG":0.25,"pS":0.1,"lambda":0.05,"alpha":0.5,"beta":0.3},
    ///   "steps":[{"skill":"s1","obs":true,"deltaTDays":0.2,"rFocus":0.85,"nDistract":0}]}`
    /// 结果形如：`{"pPred":[...],"pLFinal":[...],"pLMinus":[...],"pTPrime":[...],"mastered":[...]}`
    /// 其中 `pPred[i]` = 观测前状态（衰减后 P(L^-)）下的 P(答对)。
    ///
    /// 运行：cargo test --release batch_evaluate_fb_bkt -- --ignored --nocapture
    #[test]
    #[ignore = "批量评测入口，需设置 FB_BKT_EVAL_IN / FB_BKT_EVAL_OUT"]
    fn batch_evaluate_fb_bkt() {
        use std::collections::HashMap;
        use std::io::{BufRead, BufReader, Write};

        let input_path = std::env::var("FB_BKT_EVAL_IN").expect("FB_BKT_EVAL_IN");
        let output_path = std::env::var("FB_BKT_EVAL_OUT").expect("FB_BKT_EVAL_OUT");
        let reader = BufReader::new(std::fs::File::open(&input_path).expect("open input"));
        let mut writer =
            std::io::BufWriter::new(std::fs::File::create(&output_path).expect("create output"));

        let mut sequences = 0usize;
        let mut steps_total = 0usize;
        for line in reader.lines() {
            let line = line.expect("read line");
            if line.trim().is_empty() {
                continue;
            }
            let request: serde_json::Value = serde_json::from_str(&line).expect("parse request");
            let number = |value: Option<&serde_json::Value>, fallback: f64| -> f64 {
                value.and_then(|item| item.as_f64()).unwrap_or(fallback)
            };
            let defaults = FbBktParams::default();
            let params_json = request.get("params");
            let params = FbBktParams {
                p_l0: number(params_json.and_then(|p| p.get("pL0")), defaults.p_l0),
                p_t: number(params_json.and_then(|p| p.get("pT")), defaults.p_t),
                p_g: number(params_json.and_then(|p| p.get("pG")), defaults.p_g),
                p_s: number(params_json.and_then(|p| p.get("pS")), defaults.p_s),
                lambda: number(params_json.and_then(|p| p.get("lambda")), defaults.lambda),
                alpha: number(params_json.and_then(|p| p.get("alpha")), defaults.alpha),
                beta: number(params_json.and_then(|p| p.get("beta")), defaults.beta),
                mastery_threshold: number(
                    params_json.and_then(|p| p.get("masteryThreshold")),
                    defaults.mastery_threshold,
                ),
            };

            let steps = request.get("steps").and_then(|value| value.as_array());
            let mut state: HashMap<String, f64> = HashMap::new();
            let (mut p_pred, mut p_final, mut p_minus, mut p_t_prime, mut mastered) =
                (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
            if let Some(steps) = steps {
                for step in steps {
                    let skill = step
                        .get("skill")
                        .and_then(|value| value.as_str())
                        .unwrap_or("__default__")
                        .to_string();
                    let previous = *state.get(&skill).unwrap_or(&params.p_l0);
                    let obs = step
                        .get("obs")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    let inputs = FbBktInputs {
                        p_l_prev: previous,
                        delta_t_days: number(step.get("deltaTDays"), 0.0),
                        r_focus: number(step.get("rFocus"), 0.0),
                        n_distract: step.get("nDistract").and_then(|v| v.as_u64()).unwrap_or(0)
                            as u32,
                        obs,
                    };
                    let out = update(&params, &inputs);
                    // 观测前（已衰减）状态下的 P(答对)：模型对本题的预测
                    let likelihood =
                        out.p_l_minus * (1.0 - params.p_s) + (1.0 - out.p_l_minus) * params.p_g;
                    p_pred.push(likelihood);
                    p_minus.push(out.p_l_minus);
                    p_t_prime.push(out.p_t_prime);
                    p_final.push(out.p_l_final);
                    mastered.push(out.mastered);
                    state.insert(skill, out.p_l_final);
                    steps_total += 1;
                }
            }
            let record = serde_json::json!({
                "pPred": p_pred,
                "pLMinus": p_minus,
                "pTPrime": p_t_prime,
                "pLFinal": p_final,
                "mastered": mastered,
            });
            writeln!(writer, "{record}").expect("write result");
            sequences += 1;
        }
        writer.flush().expect("flush");
        println!("fb_bkt batch evaluated: {sequences} sequences / {steps_total} steps");
    }

    #[test]
    fn mastery_threshold_flags_learned_state() {
        let params = FbBktParams::default();
        let low = update(&params, &inputs(0.2, 5.0, 0.0, 5, false));
        assert!(!low.mastered);
        let mut p = 0.3;
        let mut mastered_any = false;
        for _ in 0..12 {
            let out = update(&params, &inputs(p, 0.0, 1.0, 0, true));
            p = out.p_l_final;
            mastered_any |= out.mastered;
        }
        assert!(mastered_any, "连续答对应能越过 0.8 掌握阈值，最终 {p}");
    }

    #[test]
    fn distraction_penalty_keeps_transition_bounded() {
        // β 只做惩罚：N_distract 很大时 P_T' 收敛到 P_T 而不会低于它。
        let params = FbBktParams::default();
        let out = update(&params, &inputs(0.5, 1.0, 1.0, 1_000_000, true));
        assert!(out.p_t_prime >= params.p_t - 1e-12);
        assert!(out.p_t_prime <= params.p_t * (1.0 + params.alpha) + 1e-12);
    }
}
