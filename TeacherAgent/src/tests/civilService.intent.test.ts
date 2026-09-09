/**
 * 考公（行测 xingce / 申论 shenlun）意图识别测试 —— SocraticIntent 路由
 *
 * 放置位置（集成时）：复制到 TeacherAgent/src/tests/ 下，例如
 *   src/tests/civilService.intent.test.ts
 * 依赖源码改动见 src-patches/INTEGRATION_SPEC.md §6（socraticAgent.ts 扩展 SocraticIntent +
 * 6 个检测函数 + 在 selectSocraticStrategy 主流程中「行测优先 / 申论优先」插入分支）。
 *
 * 分支插入顺序（与真实函数一致）：requested 覆盖 → 情绪 → review → learning_plan →
 * direct_answer → answer_with_reasoning → student_attempt → 【考公分支】 →
 * outline_or_summary → concept → counterexample → exam_sprint → default_guide。
 * 因此考公分支位于 student_attempt 之后、outline_or_summary 之前，且受 subjectCode 守卫。
 */

import { describe, expect, it } from "vitest"
import { selectSocraticStrategy } from "../engine/agents/socraticAgent"
import type { SocraticDecision } from "../engine/agents/socraticAgent"

type CivilSubject = "xingce" | "shenlun"

function decide(message: string, subjectCode: CivilSubject): SocraticDecision {
  return selectSocraticStrategy({ userMessage: message, subjectCode })
}

describe("行测意图识别（IX.4 / IX.5）", () => {
  it("xingce_practice：『给我一道判断推理的练习』走题型训练分支", () => {
    const d = decide("给我一道判断推理的练习", "xingce")
    expect(d.intent).toBe("xingce_practice")
    expect(d.mode).toBe("diagnose")
    expect(d.maxHintLevel).toBe("L2")
    expect(d.strategy).toBe("decomposition")
  })

  it("xingce_practice：『来一道资料分析题』同样识别为出题/训练", () => {
    const d = decide("来一道资料分析题", "xingce")
    expect(d.intent).toBe("xingce_practice")
  })

  it("xingce_method：『资料分析的增长率怎么速算？』走方法讲解分支", () => {
    const d = decide("资料分析的增长率怎么速算？", "xingce")
    expect(d.intent).toBe("xingce_method")
    expect(d.mode).toBe("explain")
    expect(d.maxHintLevel).toBe("L2")
  })

  it("xingce_method：『言语理解的逻辑填空怎么找线索？』走方法讲解分支", () => {
    const d = decide("言语理解的逻辑填空怎么找线索？", "xingce")
    expect(d.intent).toBe("xingce_method")
  })

  it("行测答对闭环复用既有 answer_with_reasoning（确认 + 补规范步骤，不反复低阶追问）", () => {
    // 含结论(数值) + 推导依据，应命中既有 answer_with_reasoning，而非落到 xingce_practice
    const d = decide("我算出增长率等于 15%，因为用公式 (现期-基期)/基期算的", "xingce")
    expect(d.intent).toBe("answer_with_reasoning")
    expect(d.mode).toBe("review")
    expect(d.maxHintLevel).toBe("L4")
  })
})

describe("申论意图识别（IX.4 / IX.5 / IX.6）", () => {
  it("shenlun_material：『帮我拆一下这段申论材料』走材料拆解分支", () => {
    const d = decide("帮我拆一下这段申论材料", "shenlun")
    expect(d.intent).toBe("shenlun_material")
    expect(d.mode).toBe("explain")
    expect(d.maxHintLevel).toBe("L2")
  })

  it("shenlun_outline：『帮我搭一个大作文提纲』走提纲辅导分支", () => {
    const d = decide("帮我搭一个大作文提纲", "shenlun")
    expect(d.intent).toBe("shenlun_outline")
    expect(d.mode).toBe("explain")
    expect(d.maxHintLevel).toBe("L2")
  })

  it("shenlun_rewrite：『帮我润色这段申论，去 AI 味』走段落改写分支（段落级，L3）", () => {
    const d = decide("帮我润色这段申论，去 AI 味", "shenlun")
    expect(d.intent).toBe("shenlun_rewrite")
    expect(d.mode).toBe("review")
    expect(d.maxHintLevel).toBe("L3")
    expect(d.shouldAskQuestion).toBe(false)
    expect(d.explanationDepth).toBe("key_step")
  })

  it("shenlun_essay_structure：『申论大作文的文章结构怎么搭』走大作文结构分支", () => {
    const d = decide("申论大作文的文章结构怎么搭", "shenlun")
    expect(d.intent).toBe("shenlun_essay_structure")
    expect(d.mode).toBe("explain")
    expect(d.maxHintLevel).toBe("L2")
  })
})

describe("申论不默认整篇代写（关键约束 V.6 / V.7）", () => {
  it("shenlun_outline 绝不走 review / L4（只给框架，不代写全文）", () => {
    const d = decide("帮我搭一个大作文提纲", "shenlun")
    expect(d.mode).not.toBe("review")
    expect(d.maxHintLevel).toBe("L2")
  })

  it("shenlun_essay_structure 绝不走 review / L4（只讲结构，不输出整篇）", () => {
    const d = decide("申论大作文的文章结构怎么搭", "shenlun")
    expect(d.mode).not.toBe("review")
    expect(d.maxHintLevel).toBe("L2")
  })

  it("『请直接帮我写一篇完整的申论大作文』仍被导向结构辅导，而非整篇代写", () => {
    const d = decide("请直接帮我写一篇完整的申论大作文", "shenlun")
    // 命中 shenlun_essay_structure（大作文/文章结构 关键词），且 mode 非 review
    expect(d.intent).toBe("shenlun_essay_structure")
    expect(d.mode).not.toBe("review")
    // 不应走 review/L4，不会默认输出整篇代写
    expect(d.maxHintLevel).not.toBe("L4")
  })

  it("shenlun_rewrite 始终是段落级改写（L3，非 L4 整篇代写）", () => {
    const d = decide("帮我润色这段申论，去 AI 味", "shenlun")
    expect(d.maxHintLevel).not.toBe("L4")
    expect(d.maxHintLevel).toBe("L3")
  })

  it("申论四类意图中，outline/material/essay_structure 均为 explain（仅 rewrite 为段落级 review）", () => {
    const cases: Array<[string, string]> = [
      ["帮我拆一下这段申论材料", "shenlun_material"],
      ["帮我搭一个大作文提纲", "shenlun_outline"],
      ["申论大作文的文章结构怎么搭", "shenlun_essay_structure"]
    ]
    for (const [msg, expected] of cases) {
      const d = decide(msg, "shenlun")
      expect(d.intent).toBe(expected)
      expect(d.mode).toBe("explain")
    }
  })
})

describe("subjectCode 守卫（考公分支不得泄漏到其它学科）", () => {
  it("含『材料』的拆解请求在 english 下不返回 shenlun_material", () => {
    const d = decide("帮我拆一下这段材料", "english")
    expect(d.intent).not.toBe("shenlun_material")
  })

  it("含『判断推理的练习』的出题请求在 english 下不返回 xingce_practice", () => {
    const d = decide("给我一道判断推理的练习", "english")
    expect(d.intent).not.toBe("xingce_practice")
  })

  it("行测分支仅在 subjectCode === 'xingce' 触发", () => {
    expect(decide("资料分析的增长率怎么速算？", "xingce").intent).toBe("xingce_method")
    expect(decide("资料分析的增长率怎么速算？", "english").intent).not.toBe("xingce_method")
  })
})
