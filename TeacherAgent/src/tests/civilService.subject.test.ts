/**
 * 考公（行测 xingce / 申论 shenlun）学科接入测试 —— 学科 / label / welcome / manifest
 *
 * 放置位置（集成时）：复制到 TeacherAgent/src/tests/ 下，例如
 *   src/tests/civilService.subject.test.ts
 * 依赖源码改动见 src-patches/INTEGRATION_SPEC.md（subject.ts / welcomeMessages.ts / packManifest.ts / subjectStyle.ts）。
 */
import { describe, expect, it } from "vitest"
import { subjectLabel, subjectCategory } from "../utils/subject"
import { getWelcomeContent, createWelcomeMessages } from "../components/chat/welcomeMessages"
import { PACK_MANIFEST } from "../services/knowledge/packManifest"
import { resolveSubjectStyle } from "../engine/policies/subjectStyle"

const CIVIL_PACK_IDS = [
  "civil-verbal", "civil-logic", "civil-data-analysis", "civil-quant", "civil-common-sense-scope", "civil-common-sense",
  "civil-shenlun-summary", "civil-shenlun-argument", "civil-shenlun-implementation", "civil-shenlun-writing"
]

describe("考公学科接入：subject code / 中文 label / 分类", () => {
  it("xingce 与 shenlun 都有中文 label，且不暴露英文 code", () => {
    expect(subjectLabel("xingce")).toBe("行测")
    expect(subjectLabel("shenlun")).toBe("申论")
    expect(subjectLabel("xingce")).not.toMatch(/xingce|shenlun/)
  })

  it("行测与申论在 UI 中同属「考公」分类", () => {
    expect(subjectCategory("xingce")).toBe("考公")
    expect(subjectCategory("shenlun")).toBe("考公")
  })
})

describe("考公学科接入：welcome message（IX.1 / IX.2 / IX.3）", () => {
  it("行测 welcome 包含行测关键词且不含数学模板", () => {
    const c = getWelcomeContent("xingce")
    expect(c).toContain("行测")
    expect(c).toContain("言语理解")
    expect(c).toContain("判断推理")
    expect(c).toContain("资料分析")
    expect(c).toContain("数量关系")
    expect(c).toContain("常识判断")
    // 不含数学模板
    expect(c).not.toContain("极限")
    expect(c).not.toContain("夹逼定理")
    expect(c).not.toContain("线性代数")
    expect(c).not.toContain("\\lim")
    expect(c).not.toContain("\\frac")
  })

  it("申论 welcome 包含申论关键词且不含数学模板", () => {
    const c = getWelcomeContent("shenlun")
    expect(c).toContain("申论")
    expect(c).toContain("归纳概括")
    expect(c).toContain("综合分析")
    expect(c).toContain("提出对策")
    expect(c).toContain("贯彻执行")
    expect(c).toContain("大作文")
    expect(c).not.toContain("极限")
    expect(c).not.toContain("夹逼定理")
    expect(c).not.toContain("线性代数")
    expect(c).not.toContain("\\lim")
    expect(c).not.toContain("\\frac")
  })

  it("行测 / 申论 welcome 都能生成一条 tutor 消息", () => {
    for (const s of ["xingce", "shenlun"] as const) {
      const msgs = createWelcomeMessages(s)
      expect(msgs).toHaveLength(1)
      expect(msgs[0].role).toBe("tutor")
      expect(msgs[0].id).toBe("welcome")
    }
  })
})

describe("考公学科接入：学科风格", () => {
  it("行测风格为高效、步骤感强、题型导向", () => {
    const style = resolveSubjectStyle("xingce")
    expect(style.subjectCode).toBe("xingce")
    expect(style.toneRules.join("；")).toContain("题型导向")
  })

  it("申论风格为审题严谨、结构清楚、表达克制、材料贴合", () => {
    const style = resolveSubjectStyle("shenlun")
    expect(style.subjectCode).toBe("shenlun")
    expect(style.toneRules.join("；")).toContain("材料贴合")
  })
})

describe("考公学科接入：Pack manifest 显示名 / shortTitle（IX.8）", () => {
  it("10 个考公 pack 均在 manifest 中，且 title / shortTitle 完整为中文", () => {
    const civil = PACK_MANIFEST.filter((p) => CIVIL_PACK_IDS.includes(p.id))
    expect(civil).toHaveLength(10)

    const byId = Object.fromEntries(civil.map((p) => [p.id, p]))
    expect(byId["civil-verbal"].title).toBe("言语理解与表达")
    expect(byId["civil-verbal"].shortTitle).toBe("言语理解")
    expect(byId["civil-shenlun-writing"].title).toBe("申论·大作文")
    expect(byId["civil-shenlun-writing"].shortTitle).toBe("大作文")

    for (const p of civil) {
      expect(p.title.trim().length).toBeGreaterThan(0)
      expect(p.shortTitle.trim().length).toBeGreaterThan(0)
      expect(p.knowledgePath).toContain("civil-")
      expect(p.questionPath).toContain("civil-")
    }
  })

  it("manifest 节点/题数之和与种子实测一致（行测 5/4 + 范围 2/2，申论 5/3）", () => {
    const civil = PACK_MANIFEST.filter((p) => CIVIL_PACK_IDS.includes(p.id))
    const nodes = civil.reduce((s, p) => s + p.expectedNodeCount, 0)
    const qs = civil.reduce((s, p) => s + p.expectedQuestionCount, 0)
    expect(nodes).toBe(47)
    expect(qs).toBe(34)
  })
})

describe("考公学科接入：知识图谱/练习/仪表盘/对话页可打开（IX.10 代理断言）", () => {
  it("行测 / 申论 在 welcome / manifest / style 三层均可解析（页面可加载新学科的前提）", () => {
    for (const s of ["xingce", "shenlun"] as const) {
      expect(getWelcomeContent(s).length).toBeGreaterThan(50)
      expect(resolveSubjectStyle(s).subjectCode).toBe(s)
      const packs = PACK_MANIFEST.filter((p) => p.subject === s)
      expect(packs.length).toBeGreaterThan(0)
    }
    // 行测 6 包、申论 4 包
    expect(PACK_MANIFEST.filter((p) => p.subject === "xingce")).toHaveLength(6)
    expect(PACK_MANIFEST.filter((p) => p.subject === "shenlun")).toHaveLength(4)
  })
})
