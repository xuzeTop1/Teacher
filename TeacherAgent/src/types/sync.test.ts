/**
 * 同步类型辅助函数测试（AI 使用时间「未记录」判断）。
 */

import { describe, expect, it } from "vitest"
import { aiUsageSourceLabel, isAiUsageUnknown } from "./sync"

describe("isAiUsageUnknown（AI 时长是否未记录）", () => {
  it("旧客户端（无任何 AI 字段）→ 未记录", () => {
    expect(isAiUsageUnknown({})).toBe(true)
  })

  it("来源 unknown → 未记录", () => {
    expect(
      isAiUsageUnknown({ aiUsageSource: "unknown", aiHelpSeconds: 0, aiHelpCount: 0 })
    ).toBe(true)
  })

  it("有 AlertTime AI 求助记录 → 已记录", () => {
    expect(
      isAiUsageUnknown({ aiUsageSource: "alerttime_ai_help", aiHelpSeconds: 60, aiHelpCount: 2 })
    ).toBe(false)
  })

  it("只有外部 AI App 记录（usage_stats）→ 已记录，不算未记录", () => {
    expect(
      isAiUsageUnknown({
        aiUsageSource: "usage_stats",
        aiHelpSeconds: 0,
        aiHelpCount: 0,
        externalAiAppSeconds: 120
      })
    ).toBe(false)
  })

  it("来源缺失但 externalAiAppSeconds 有值 → 已记录（不误判为未记录）", () => {
    expect(
      isAiUsageUnknown({ aiHelpSeconds: 0, aiHelpCount: 0, externalAiAppSeconds: 30 })
    ).toBe(false)
  })

  it("externalAiAppSeconds 为 null 且其余为零 → 未记录", () => {
    expect(
      isAiUsageUnknown({ aiHelpSeconds: 0, aiHelpCount: 0, externalAiAppSeconds: null })
    ).toBe(true)
  })
})

describe("aiUsageSourceLabel（来源展示）", () => {
  it("三类来源与缺失都有稳定中文标签", () => {
    expect(aiUsageSourceLabel("alerttime_ai_help")).toBe("AlertTime AI 求助")
    expect(aiUsageSourceLabel("usage_stats")).toContain("外部 AI App")
    expect(aiUsageSourceLabel("unknown")).toBe("未记录")
    expect(aiUsageSourceLabel(null)).toBe("未记录")
    expect(aiUsageSourceLabel(undefined)).toBe("未记录")
  })
})
