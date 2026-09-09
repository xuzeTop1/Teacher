/**
 * 考试体系 Registry 测试（验收组 A：分类 Registry）。
 *
 * 覆盖：
 * - 每个叶子节点有合法父级；
 * - 父级 Exam Track 不能被当作具体题目归属；
 * - 408 四门子科目与别名映射正确；
 * - 至少另一真实考研专业组（考研英语）做同样验证；
 * - 用户自定义、未知与模糊科目不会被错误映射。
 */

import { describe, expect, it } from "vitest"
import {
  formatExamPath,
  getDescendantLeaves,
  getExamChildren,
  getExamLeaves,
  getExamNode,
  getExamPath,
  getExamTracks,
  getLeafPackIds,
  isQuestionScopeNode,
  resolveByLegacyCode,
  resolveByPhoneName,
  validateCatalog
} from "./registry"

describe("考试体系 Registry：目录整体校验", () => {
  it("目录校验通过：无缺父级、无非法 questionScope、无坏 pack 引用", () => {
    const result = validateCatalog()
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it("每个节点都有合法父级且 stableId 唯一", () => {
    const tracks = getExamTracks()
    expect(tracks.length).toBeGreaterThanOrEqual(2)
    const allLeaves = getExamLeaves()
    expect(allLeaves.length).toBeGreaterThanOrEqual(10)
    const ids = new Set<string>()
    for (const track of tracks) {
      for (const leaf of getDescendantLeaves(track.stableId)) {
        expect(ids.has(leaf.stableId)).toBe(false)
        ids.add(leaf.stableId)
        const parent = getExamNode(leaf.parentId ?? "")
        expect(parent).not.toBeNull()
        expect(parent!.nodeType).not.toBe("MODULE")
      }
    }
  })

  it("父级 EXAM_TRACK 不能作为具体题目归属（questionScope 为空、非叶子）", () => {
    for (const track of getExamTracks()) {
      expect(track.nodeType).toBe("EXAM_TRACK")
      expect(track.questionScope).toHaveLength(0)
      expect(isQuestionScopeNode(track.stableId)).toBe(false)
      expect(getLeafPackIds(track.stableId)).toEqual([])
    }
  })
})

describe("考试体系 Registry：408 建模", () => {
  const track = getExamNode("408")

  it("408 是 EXAM_TRACK，不是独立课程", () => {
    expect(track).not.toBeNull()
    expect(track!.nodeType).toBe("EXAM_TRACK")
    expect(track!.code).toBe("408")
    expect(track!.displayName).toBe("计算机学科专业基础")
    expect(isQuestionScopeNode("408")).toBe(false)
  })

  it("408 四门子科目与别名映射正确", () => {
    expect(resolveByPhoneName("数据结构").map((n) => n.stableId)).toContain("408.data-structures")
    expect(resolveByPhoneName("数构").map((n) => n.stableId)).toContain("408.data-structures")
    expect(resolveByPhoneName("Data Structures").map((n) => n.stableId)).toContain("408.data-structures")

    expect(resolveByPhoneName("计组").map((n) => n.stableId)).toContain("408.computer-organization")
    expect(resolveByPhoneName("组成原理").map((n) => n.stableId)).toContain("408.computer-organization")
    expect(resolveByPhoneName("Computer Organization").map((n) => n.stableId)).toContain("408.computer-organization")

    expect(resolveByPhoneName("操作系统").map((n) => n.stableId)).toContain("408.operating-systems")
    expect(resolveByPhoneName("OS").map((n) => n.stableId)).toContain("408.operating-systems")
    expect(resolveByPhoneName("Operating Systems").map((n) => n.stableId)).toContain("408.operating-systems")

    expect(resolveByPhoneName("计算机网络").map((n) => n.stableId)).toContain("408.computer-networks")
    expect(resolveByPhoneName("计网").map((n) => n.stableId)).toContain("408.computer-networks")
    expect(resolveByPhoneName("网络").map((n) => n.stableId)).toContain("408.computer-networks")
    expect(resolveByPhoneName("Computer Networks").map((n) => n.stableId)).toContain("408.computer-networks")
  })

  it("408 的四门子科目都是叶子且归属同一考试组", () => {
    for (const stableId of [
      "408.data-structures",
      "408.computer-organization",
      "408.operating-systems",
      "408.computer-networks"
    ]) {
      const node = getExamNode(stableId)
      expect(node).not.toBeNull()
      expect(node!.nodeType).toBe("SUBJECT")
      expect(node!.parentId).toBe("408")
      expect(isQuestionScopeNode(stableId)).toBe(true)
      expect(getLeafPackIds(stableId).length).toBeGreaterThan(0)
      expect(getExamPath(stableId).map((n) => n.stableId)).toEqual(["408", stableId])
    }
  })

  it("「408」本身不能解析为具体叶子", () => {
    const hits = resolveByPhoneName("408")
    expect(hits.some((n) => n.nodeType === "EXAM_TRACK")).toBe(true)
    expect(hits.some((n) => isQuestionScopeNode(n.stableId))).toBe(false)
  })
})

describe("考试体系 Registry：另一真实考研专业组（考研英语）", () => {
  const track = getExamNode("kaoyan-english")

  it("考研英语是 EXAM_TRACK，包含 4 个叶子子科目", () => {
    expect(track).not.toBeNull()
    expect(track!.nodeType).toBe("EXAM_TRACK")
    const leaves = getDescendantLeaves("kaoyan-english")
    expect(leaves.map((n) => n.stableId).sort()).toEqual([
      "kaoyan-english.cloze",
      "kaoyan-english.grammar",
      "kaoyan-english.reading",
      "kaoyan-english.translation"
    ])
  })

  it("考研英语子科目别名正确（与 408 子科目不混淆）", () => {
    // 「语法」只能命中考研英语，不能命中 408 的任何科目。
    const grammarHits = resolveByPhoneName("语法")
    expect(grammarHits.map((n) => n.stableId)).toContain("kaoyan-english.grammar")
    expect(grammarHits.some((n) => n.stableId.startsWith("408."))).toBe(false)
  })

  it("同一中文标题在不同考试组拥有不同 stableId", () => {
    // 「逻辑」在管理类联考中是叶子，在行测中不存在（行测叫判断推理）。
    const logicHits = resolveByPhoneName("逻辑")
    expect(logicHits.map((n) => n.stableId)).toContain("management-coop.logic")
    // 「写作」在管理类联考中与申论大作文不同节点。
    expect(resolveByPhoneName("写作").map((n) => n.stableId)).toContain("management-coop.writing")
  })
})

describe("考试体系 Registry：不误映射", () => {
  it("用户自定义科目名（不存在的名称）不会被错误映射", () => {
    expect(resolveByPhoneName("我的自定义科目123")).toEqual([])
    expect(resolveByPhoneName("高数强化班")).toEqual([])
  })

  it("未知科目名返回空（调用方标记 unresolved，不得猜测）", () => {
    expect(resolveByPhoneName("")).toEqual([])
    expect(resolveByPhoneName("  ")).toEqual([])
    expect(resolveByPhoneName("考研数学二")).toEqual([])
  })

  it("模糊名称（多个候选）返回全部候选，不自动选择", () => {
    // 「网络」只命中计网一个叶子——单个候选直接可用；
    // 但「英语」同时是考试组展示名（考研英语），不能直接当叶子。
    const englishHits = resolveByPhoneName("英语")
    expect(englishHits.length).toBeGreaterThanOrEqual(1)
    expect(englishHits.some((n) => n.nodeType === "EXAM_TRACK")).toBe(true)
    expect(englishHits.some((n) => isQuestionScopeNode(n.stableId))).toBe(false)
  })

  it("旧平面学科代码解析：cs408 解析到考试组而非某门课程", () => {
    const hits = resolveByLegacyCode("cs408")
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.some((n) => n.stableId === "408" && n.nodeType === "EXAM_TRACK")).toBe(true)
  })

  it("叶子路径展示格式为 考试组 / 课程", () => {
    expect(formatExamPath("408.computer-networks")).toBe("计算机学科专业基础 / 计算机网络")
    expect(formatExamPath("kaoyan-english.grammar")).toBe("考研英语 / 语法")
  })

  it("getExamChildren 按目录顺序返回子节点", () => {
    const children = getExamChildren("408")
    expect(children.map((n) => n.stableId)).toEqual([
      "408.data-structures",
      "408.computer-organization",
      "408.operating-systems",
      "408.computer-networks"
    ])
  })
})
