import { describe, it, expect } from "vitest"
import {
  VISIBLE_STEP,
  getVisibleNodes,
  nextVisibleLimit,
  hasMoreNodes,
  resolveListNodeSource
} from "./knowledgeGraphLogic"
import type { KnowledgeSeedNode } from "../services/knowledge/packLoader"

function makeNode(id: string, title?: string): KnowledgeSeedNode {
  return {
    id,
    title: title ?? `Node ${id}`,
    summary: "test summary",
    source: { title: "test", license: "MIT" }
  }
}

describe("knowledgeGraphLogic", () => {
  describe("VISIBLE_STEP", () => {
    it("is 30", () => {
      expect(VISIBLE_STEP).toBe(30)
    })
  })

  describe("getVisibleNodes", () => {
    it("returns first N nodes", () => {
      const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`n${i}`))
      const result = getVisibleNodes(nodes, 30)
      expect(result).toHaveLength(30)
      expect(result[0].id).toBe("n0")
      expect(result[29].id).toBe("n29")
    })

    it("returns all when limit >= length", () => {
      const nodes = [makeNode("a"), makeNode("b")]
      expect(getVisibleNodes(nodes, 30)).toHaveLength(2)
      expect(getVisibleNodes(nodes, 2)).toHaveLength(2)
    })

    it("returns empty for empty input", () => {
      expect(getVisibleNodes([], 30)).toEqual([])
    })
  })

  describe("nextVisibleLimit", () => {
    it("adds VISIBLE_STEP", () => {
      expect(nextVisibleLimit(30, 100)).toBe(60)
    })

    it("caps at totalCount", () => {
      expect(nextVisibleLimit(30, 40)).toBe(40)
    })

    it("caps at totalCount when already at limit", () => {
      expect(nextVisibleLimit(50, 50)).toBe(50)
    })
  })

  describe("hasMoreNodes", () => {
    it("returns true when visible < total", () => {
      expect(hasMoreNodes(30, 50)).toBe(true)
    })

    it("returns false when visible >= total", () => {
      expect(hasMoreNodes(50, 50)).toBe(false)
      expect(hasMoreNodes(60, 50)).toBe(false)
    })
  })

  describe("resolveListNodeSource", () => {
    const all = [makeNode("a"), makeNode("b"), makeNode("c")]
    const filtered = [makeNode("a")]

    it("returns all nodes when showAll is true", () => {
      expect(resolveListNodeSource(true, all, filtered)).toBe(all)
    })

    it("returns filtered nodes when showAll is false", () => {
      expect(resolveListNodeSource(false, all, filtered)).toBe(filtered)
    })
  })

  describe("knowledgeGraphLogic module boundaries", () => {
    it("does not export any orphan cleanup function", async () => {
      const mod = await import("./knowledgeGraphLogic")
      const exports = Object.keys(mod)
      expect(exports.every((k) => !k.includes("orphan") && !k.includes("delete"))).toBe(true)
    })

    it("exports exactly the expected functions", async () => {
      const mod = await import("./knowledgeGraphLogic")
      const exports = Object.keys(mod).sort()
      expect(exports).toEqual([
        "VISIBLE_STEP",
        "getVisibleNodes",
        "hasMoreNodes",
        "nextVisibleLimit",
        "resolveListNodeSource"
      ])
    })
  })

  describe("KnowledgeGraphView integration", () => {
    it("KnowledgeGraphView.vue imports from knowledgeGraphLogic", async () => {
      // Read the component source to verify it imports from the logic module
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./KnowledgeGraphView.vue"),
        "utf-8"
      )
      expect(src).toContain('from "./knowledgeGraphLogic"')
      // Verify it uses the imported functions, not local duplicates
      expect(src).not.toMatch(/const VISIBLE_STEP\s*=\s*30/)
      expect(src).toContain("getVisibleNodes(")
      expect(src).toContain("nextVisibleLimit(")
      expect(src).toContain("hasMoreNodesFn(")
      expect(src).toContain("resolveListNodeSource(")
    })

    it("KnowledgeGraphView does not import deleteOrphanKnowledgeNodes", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./KnowledgeGraphView.vue"),
        "utf-8"
      )
      expect(src).not.toContain("deleteOrphanKnowledgeNodes")
    })

    it("KnowledgeGraphView links to settings with scrollTo query", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./KnowledgeGraphView.vue"),
        "utf-8"
      )
      expect(src).toContain("scrollTo")
      expect(src).toContain("knowledge-management")
    })

    it("SettingsView delegates knowledge section to KnowledgeBasePanel", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./SettingsView.vue"),
        "utf-8"
      )
      expect(src).toContain("KnowledgeBasePanel")
    })

    it("KnowledgeBasePanel has id=knowledge-management on knowledge section", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "../components/settings/KnowledgeBasePanel.vue"),
        "utf-8"
      )
      expect(src).toContain('id="knowledge-management"')
      expect(src).toContain('id="knowledge-health-check"')
    })

    it("KnowledgeGraphView imports mastery utilities", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./KnowledgeGraphView.vue"),
        "utf-8"
      )
      expect(src).toContain('from "../utils/mastery"')
      expect(src).toContain("getMasteryLabel")
      expect(src).toContain("getMasteryBadgeText")
      expect(src).toContain("getMasteryBadgeClass")
      expect(src).toContain("getMasteryColor")
    })

    it("KnowledgeGraphView has node detail panel with action buttons", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./KnowledgeGraphView.vue"),
        "utf-8"
      )
      // Verify detail panel exists
      expect(src).toContain("node-detail")
      // Verify action buttons exist
      expect(src).toContain("askTutorToExplain")
      expect(src).toContain("askForPractice")
      expect(src).toContain("让导师讲解")
      expect(src).toContain("出一道练习")
    })

    it("KnowledgeGraphView hides the 50% prior and shows talent-state icons", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./KnowledgeGraphView.vue"),
        "utf-8"
      )
      expect(src).toContain("cold-start-note")
      expect(src).toContain("系统内部先验不会作为进度展示")
      expect(src).toContain("暂不展示 50% 先验值")
      expect(src).toContain("getNodeVisualIcon")
      expect(src).toContain("talent-node-token")
    })

    it("DashboardView uses cold-start aware mastery display", async () => {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const src = fs.readFileSync(
        path.resolve(__dirname, "./DashboardView.vue"),
        "utf-8"
      )
      expect(src).toContain("getMasteryLabel")
      expect(src).toContain("已初始化知识点")
    })
  })
})
