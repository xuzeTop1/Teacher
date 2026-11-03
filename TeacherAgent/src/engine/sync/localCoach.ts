import type { SyncLocalCoachResult } from "../../types/sync"
const common = ["task", "source", "fallback_reason", "model_id", "model_sha256", "schema_version", "created_at"]
const reasons = ["model_missing", "hash_mismatch", "oom", "low_battery", "timeout", "invalid_output", "runtime_error"]
const reserved = ["inferences", "fallback_reason", "model_id", "model_sha256", "r_focus", "n_distract", "perceived_difficulty", "confidence", "risk", "commitment", "abandon_reason", "frustration_level", "suggest_action", "bkt_signal"]
function object(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v) }
function number(v: unknown, low: number, high: number): v is number { return typeof v === "number" && Number.isFinite(v) && v >= low && v <= high }
function choice(v: unknown, allowed: string[]): boolean { return typeof v === "string" && allowed.includes(v) }
export function validateLocalInference(v: unknown): v is SyncLocalCoachResult {
  if (!object(v) || v.model_id !== "qwen2.5-0.5b-bkt-v2-q4_k_m" || v.model_sha256 !== "daed6c55a53da9196c8ce1f6ce5b645d731ad628d3b78946b0f564dd56e83cf8" || v.schema_version !== 1 || !Number.isSafeInteger(v.created_at) || (v.created_at as number) < 0) return false
  const model = v.source === "model"
  if (!choice(v.source, ["model", "fallback_rule", "fallback_default"]) || !(model ? v.fallback_reason === "none" : choice(v.fallback_reason, reasons))) return false
  let fields: string[]
  switch (v.task) {
    case "extract_factors":
      if (!number(v.r_focus, 0, 1) || !number(v.n_distract, 0, 2147483647) || !Number.isInteger(v.n_distract)) return false
      if (!(model ? number(v.perceived_difficulty, 0, 1) && number(v.confidence, 0, 1) : v.source === "fallback_default" && v.r_focus === 1 && v.n_distract === 0 && v.perceived_difficulty === null && v.confidence === null)) return false
      fields = ["r_focus", "n_distract", "perceived_difficulty", "confidence"]; break
    case "plan_create_advice":
      if (!choice(v.risk, ["none", "vague", "overload"]) || !(model ? number(v.commitment, 0, 1) : v.source === "fallback_rule" && v.commitment === null)) return false
      fields = ["risk", "commitment"]; break
    case "plan_delete_inference":
      if (!model || !choice(v.abandon_reason, ["difficulty_avoidance", "time_conflict", "already_completed", "burnout", "plan_adjustment"]) || !choice(v.frustration_level, ["low", "medium", "high"]) || !choice(v.suggest_action, ["split_into_micro_steps", "reschedule", "switch_subject", "rest"]) || !number(v.bkt_signal, -0.3, 0.1)) return false
      fields = ["abandon_reason", "frustration_level", "suggest_action", "bkt_signal"]; break
    default: return false
  }
  return Object.keys(v).length === common.length + fields.length && [...common, ...fields].every(k => Object.hasOwn(v, k))
}
export function validLocalInferences(v: unknown): v is SyncLocalCoachResult[] {
  return Array.isArray(v) && v.length <= 3 && v.every(validateLocalInference) && new Set(v.map(r => r.task)).size === v.length
}
export function factContainsInference(code: string, value: unknown): boolean {
  function nested(v: unknown, depth: number): boolean {
    if (depth > 32) return true
    if (Array.isArray(v)) return v.some(x => nested(x, depth + 1))
    return object(v) && (Object.keys(v).some(k => reserved.includes(k)) || Object.values(v).some(x => nested(x, depth + 1)))
  }
  return reserved.includes(code) || nested(value, 0)
}
export function localCoachSourceLabel(v: SyncLocalCoachResult): string {
  return ({ model: "模型输出", fallback_rule: "规则降级", fallback_default: "默认值降级" })[v.source]
}
export function localCoachValueLabel(v: SyncLocalCoachResult): string {
  if (v.task === "plan_create_advice") return `规则类别：${({ none: "具备行动与范围，仍需核对负荷", overload: "当日已排负荷达到阈值", vague: "计划需要细化或补充时长" })[String(v.risk)] ?? "未知"}`
  if (v.task === "extract_factors") return `${v.source === "model" ? "估计" : "默认"}专注率 ${Math.round(Number(v.r_focus) * 100)}%，分心 ${v.n_distract} 次${v.source !== "model" ? "；这些默认值不是观测事实" : ""}`
  return ({ difficulty_avoidance: "可能遇到难点", time_conflict: "可能时间冲突", already_completed: "可能已完成", burnout: "可能需要休息", plan_adjustment: "计划调整" })[String(v.abandon_reason)] ?? "未知"
}
