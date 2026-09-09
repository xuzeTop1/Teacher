use serde::{Deserialize, Serialize};

/// Bayesian Knowledge Tracking parameters for a single skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BktParams {
    /// Prior probability of knowing the skill (P(L0))
    pub p_lo: f64,
    /// Probability of learning the skill in one step (P(T))
    pub p_t: f64,
    /// Probability of guessing correctly when not knowing (P(G))
    pub p_g: f64,
    /// Probability of slipping when knowing (P(S))
    pub p_s: f64,
}

impl Default for BktParams {
    fn default() -> Self {
        Self {
            p_lo: 0.3,
            p_t: 0.1,
            p_g: 0.25,
            p_s: 0.1,
        }
    }
}

/// Result of a BKT update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BktUpdateResult {
    /// Updated probability of knowing the skill
    pub p_know: f64,
    /// Whether the student is considered to have learned the skill (p_know >= threshold)
    pub learned: bool,
    /// Observation probability given the answer
    pub observation_likelihood: f64,
}

/// Update knowledge probability using Bayesian Knowledge Tracking.
///
/// Given the current probability of knowing a skill and whether the student
/// answered correctly, compute the updated probability.
///
/// # Arguments
/// * `p_know` - Current probability of knowing the skill (0.0 to 1.0)
/// * `correct` - Whether the student answered correctly
/// * `params` - BKT parameters
/// * `learned_threshold` - Threshold above which the skill is considered learned (default 0.8)
///
/// # Returns
/// Updated BKT result with new p_know and learned status.
pub(crate) fn bkt_update(
    p_know: f64,
    correct: bool,
    params: &BktParams,
    learned_threshold: f64,
) -> BktUpdateResult {
    let p_know = p_know.clamp(0.001, 0.999);

    // Step 1: Apply learning transition
    // P(L_t | L_{t-1}) = P(L_{t-1}) + (1 - P(L_{t-1})) * P(T)
    let p_know_after_transition = p_know + (1.0 - p_know) * params.p_t;

    // Step 2: Compute observation likelihood
    // P(correct | L) = P(L) * (1 - P(S)) + (1 - P(L)) * P(G)
    // P(incorrect | L) = P(L) * P(S) + (1 - P(L)) * (1 - P(G))
    let p_correct_given_know = 1.0 - params.p_s;
    let p_correct_given_not_know = params.p_g;

    let p_obs_given_know = if correct {
        p_correct_given_know
    } else {
        1.0 - p_correct_given_know
    };
    let p_obs_given_not_know = if correct {
        p_correct_given_not_know
    } else {
        1.0 - p_correct_given_not_know
    };

    // Step 3: Bayesian update
    // P(L | obs) = P(obs | L) * P(L) / P(obs)
    let p_obs = p_obs_given_know * p_know_after_transition
        + p_obs_given_not_know * (1.0 - p_know_after_transition);

    let p_know_updated = if p_obs > 0.0 {
        (p_obs_given_know * p_know_after_transition) / p_obs
    } else {
        p_know_after_transition
    };

    let p_know_final = p_know_updated.clamp(0.001, 0.999);

    BktUpdateResult {
        p_know: p_know_final,
        learned: p_know_final >= learned_threshold,
        observation_likelihood: p_obs,
    }
}

/// Compute a simple mastery score from BKT p_know, attempts, and correct count.
/// This produces a value suitable for the student_knowledge table.
/// 预留：后续接入 BKT 与 assessment 掌握度更新时使用。
#[allow(dead_code)]
pub(crate) fn compute_mastery_score(p_know: f64, attempts: i64, correct: i64) -> f64 {
    // Weighted combination: BKT probability is primary, empirical rate is secondary
    let empirical_rate = if attempts > 0 {
        correct as f64 / attempts as f64
    } else {
        0.0
    };

    // When few attempts, trust BKT more; with many attempts, blend in empirical
    let blend_weight = (attempts as f64 / (attempts as f64 + 5.0)).min(0.5);
    let score = p_know * (1.0 - blend_weight) + empirical_rate * blend_weight;

    score.clamp(0.01, 0.99)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bkt_correct_increases_p_know() {
        let params = BktParams::default();
        let result = bkt_update(0.5, true, &params, 0.8);
        assert!(
            result.p_know > 0.5,
            "correct answer should increase p_know, got {}",
            result.p_know
        );
    }

    #[test]
    fn bkt_incorrect_decreases_p_know() {
        let params = BktParams::default();
        let result = bkt_update(0.5, false, &params, 0.8);
        assert!(
            result.p_know < 0.5,
            "incorrect answer should decrease p_know, got {}",
            result.p_know
        );
    }

    #[test]
    fn bkt_high_prior_stays_high_after_correct() {
        let params = BktParams::default();
        let result = bkt_update(0.9, true, &params, 0.8);
        assert!(
            result.p_know > 0.85,
            "high prior with correct should stay high, got {}",
            result.p_know
        );
        assert!(result.learned);
    }

    #[test]
    fn bkt_low_prior_stays_low_after_incorrect() {
        let params = BktParams::default();
        let result = bkt_update(0.1, false, &params, 0.8);
        assert!(
            result.p_know < 0.2,
            "low prior with incorrect should stay low, got {}",
            result.p_know
        );
        assert!(!result.learned);
    }

    #[test]
    fn bkt_repeated_correct_converges_to_high() {
        let params = BktParams::default();
        let mut p = 0.3;
        for _ in 0..10 {
            let result = bkt_update(p, true, &params, 0.8);
            p = result.p_know;
        }
        assert!(
            p > 0.85,
            "10 correct answers should converge to high p_know, got {}",
            p
        );
    }

    #[test]
    fn bkt_repeated_incorrect_converges_to_low() {
        let params = BktParams::default();
        let mut p = 0.7;
        for _ in 0..10 {
            let result = bkt_update(p, false, &params, 0.8);
            p = result.p_know;
        }
        assert!(
            p < 0.2,
            "10 incorrect answers should converge to low p_know, got {}",
            p
        );
    }

    #[test]
    fn bkt_guessing_parameter_effect() {
        // High guess rate
        let result_high_guess = bkt_update(
            0.3,
            true,
            &BktParams {
                p_g: 0.5,
                ..BktParams::default()
            },
            0.8,
        );

        // Low guess rate
        let result_low_guess = bkt_update(
            0.3,
            true,
            &BktParams {
                p_g: 0.1,
                ..BktParams::default()
            },
            0.8,
        );

        // With high guess rate, correct answer is less informative
        assert!(
            result_low_guess.p_know > result_high_guess.p_know,
            "low guess rate should make correct answer more informative"
        );
    }

    #[test]
    fn compute_mastery_score_basic() {
        let score = compute_mastery_score(0.8, 10, 8);
        assert!(score > 0.7 && score < 0.9, "expected ~0.8, got {}", score);
    }

    #[test]
    fn compute_mastery_score_no_attempts() {
        let score = compute_mastery_score(0.6, 0, 0);
        assert!(
            (score - 0.6).abs() < 0.01,
            "no attempts should use pure BKT, got {}",
            score
        );
    }
}
