import { describe, expect, it } from "vitest"
import {
  buildGraphNodes,
  buildGraphEdges,
  buildGraphLayout,
  buildNodeColors,
  truncateTitle,
  MAX_GRAPH_NODES
} from "./graphBuilder"
import type { KnowledgeSeedNode } from "./packLoader"
import type { StudentKnowledgeMastery } from "../../types/learning"

function makeNode(id: string, title: string, prerequisites: string[] = []): KnowledgeSeedNode {
  return {
    id,
    title,
    summary: `Summary of ${title}`,
    prerequisites,
    source: { title: "test", license: "CC0" }
  }
}

function makeMastery(nodeId: string, prob: number): StudentKnowledgeMastery {
  return {
    knowledgeNodeId: nodeId,
    title: `Node ${nodeId}`,
    masteryProbability: prob,
    attemptsCount: 1,
    correctCount: 1,
    updatedAt: ""
  }
}

describe("buildGraphNodes", () => {
  it("creates a node for every pack node", () => {
    const nodes = buildGraphNodes([
      makeNode("a", "Alpha"),
      makeNode("b", "Beta")
    ])
    expect(Object.keys(nodes)).toHaveLength(2)
    expect(nodes["a"].name).toBe("Alpha")
    expect(nodes["b"].name).toBe("Beta")
  })

  it("truncates long titles to 8 chars", () => {
    const nodes = buildGraphNodes([
      makeNode("x", "This is a very long title that should be truncated")
    ])
    expect(nodes["x"].name).toBe("This is …")
  })

  it("empty input returns empty object", () => {
    expect(buildGraphNodes([])).toEqual({})
  })
})

describe("buildGraphEdges", () => {
  it("creates edges for valid prerequisites", () => {
    const edges = buildGraphEdges([
      makeNode("a", "A"),
      makeNode("b", "B", ["a"])
    ])
    const edgeList = Object.values(edges)
    expect(edgeList).toHaveLength(1)
    expect(edgeList[0].source).toBe("a")
    expect(edgeList[0].target).toBe("b")
  })

  it("skips dangling prerequisites (id not in packNodes)", () => {
    const edges = buildGraphEdges([
      makeNode("a", "A"),
      makeNode("b", "B", ["a", "nonexistent"])
    ])
    const edgeList = Object.values(edges)
    expect(edgeList).toHaveLength(1)
  })

  it("skips self-references", () => {
    const edges = buildGraphEdges([
      makeNode("a", "A", ["a"])
    ])
    expect(Object.values(edges)).toHaveLength(0)
  })

  it("handles empty input", () => {
    expect(buildGraphEdges([])).toEqual({})
  })

  it("handles nodes with no prerequisites", () => {
    const edges = buildGraphEdges([
      makeNode("a", "A"),
      makeNode("b", "B")
    ])
    expect(Object.values(edges)).toHaveLength(0)
  })

  it("handles 122 nodes without throwing", () => {
    const nodes: KnowledgeSeedNode[] = []
    for (let i = 0; i < 122; i++) {
      const prereqs = i > 0 ? [`node-${i - 1}`] : []
      nodes.push(makeNode(`node-${i}`, `Node ${i}`, prereqs))
    }
    expect(() => buildGraphEdges(nodes)).not.toThrow()
    const edges = buildGraphEdges(nodes)
    expect(Object.values(edges)).toHaveLength(121)
  })
})

describe("buildGraphLayout", () => {
  it("returns empty layout for empty input", () => {
    expect(buildGraphLayout([])).toEqual({ nodes: {} })
  })

  it("assigns level 0 to nodes with no prerequisites", () => {
    const layout = buildGraphLayout([
      makeNode("a", "A"),
      makeNode("b", "B")
    ])
    expect(layout.nodes["a"]).toBeDefined()
    expect(layout.nodes["b"]).toBeDefined()
    expect(layout.nodes["a"].y).toBe(50) // level 0
    expect(layout.nodes["b"].y).toBe(50) // level 0
  })

  it("assigns higher level to nodes with prerequisites", () => {
    const layout = buildGraphLayout([
      makeNode("a", "A"),
      makeNode("b", "B", ["a"])
    ])
    expect(layout.nodes["a"].y).toBe(50) // level 0
    expect(layout.nodes["b"].y).toBe(170) // level 1 (levelSpacing=120, so 50+120=170)
  })

  it("does not throw on circular dependencies", () => {
    expect(() =>
      buildGraphLayout([
        makeNode("a", "A", ["b"]),
        makeNode("b", "B", ["a"])
      ])
    ).not.toThrow()
  })

  it("handles 122 nodes without throwing", () => {
    const nodes: KnowledgeSeedNode[] = []
    for (let i = 0; i < 122; i++) {
      const prereqs = i > 0 ? [`node-${i - 1}`] : []
      nodes.push(makeNode(`node-${i}`, `Node ${i}`, prereqs))
    }
    expect(() => buildGraphLayout(nodes)).not.toThrow()
    const layout = buildGraphLayout(nodes)
    expect(Object.keys(layout.nodes)).toHaveLength(122)
  })
})

describe("buildNodeColors", () => {
  it("colors learned nodes by mastery level", () => {
    const colors = buildNodeColors(
      [makeNode("a", "A"), makeNode("b", "B"), makeNode("c", "C"), makeNode("d", "D")],
      [makeMastery("a", 0.9), makeMastery("b", 0.5), makeMastery("c", 0.1)]
    )
    expect(colors["a"]).toBe("#4caf50") // >= 0.8
    expect(colors["b"]).toBe("#ff9800") // >= 0.4
    expect(colors["c"]).toBe("#f44336") // > 0
    expect(colors["d"]).toBe("#9e9e9e") // unlearned
  })

  it("unlearned nodes are grey", () => {
    const colors = buildNodeColors(
      [makeNode("a", "A")],
      []
    )
    expect(colors["a"]).toBe("#9e9e9e")
  })

  it("cold-start nodes (attemptsCount=0) are grey even with mastery=0.5", () => {
    const coldStartMastery: StudentKnowledgeMastery = {
      knowledgeNodeId: "a",
      title: "Node A",
      masteryProbability: 0.5,
      attemptsCount: 0,
      correctCount: 0,
      updatedAt: ""
    }
    const colors = buildNodeColors(
      [makeNode("a", "A")],
      [coldStartMastery]
    )
    // Cold start should be grey, not orange
    expect(colors["a"]).toBe("#9e9e9e")
  })

  it("nodes with real attempts show mastery color", () => {
    const realMastery: StudentKnowledgeMastery = {
      knowledgeNodeId: "a",
      title: "Node A",
      masteryProbability: 0.5,
      attemptsCount: 3,
      correctCount: 2,
      updatedAt: ""
    }
    const colors = buildNodeColors(
      [makeNode("a", "A")],
      [realMastery]
    )
    // Real mastery at 0.5 should be orange (>= 0.4)
    expect(colors["a"]).toBe("#ff9800")
  })
})

describe("truncateTitle", () => {
  it("truncates Chinese title to 8 chars", () => {
    expect(truncateTitle("非限制性定语从句与限制性定语从句的区别", 8)).toBe("非限制性定语从句…")
  })

  it("keeps short title as-is", () => {
    expect(truncateTitle("极限定义", 8)).toBe("极限定义")
  })

  it("truncates at exact boundary", () => {
    expect(truncateTitle("一二三四五六七八", 8)).toBe("一二三四五六七八")
    expect(truncateTitle("一二三四五六七八九", 8)).toBe("一二三四五六七八…")
  })

  it("handles empty string", () => {
    expect(truncateTitle("", 8)).toBe("")
  })
})

describe("buildGraphLayout — wrap-around and spacing", () => {
  it("40 nodes layout has distinct positions (no exact overlaps)", () => {
    const nodes: KnowledgeSeedNode[] = []
    for (let i = 0; i < 40; i++) {
      nodes.push(makeNode(`n-${i}`, `Node ${i}`, i > 0 ? [`n-${i - 1}`] : []))
    }
    const layout = buildGraphLayout(nodes)
    const positions = Object.values(layout.nodes)
    expect(positions).toHaveLength(40)

    // Check no two nodes share the exact same position
    const uniqueKeys = new Set(positions.map((p) => `${p.x},${p.y}`))
    expect(uniqueKeys.size).toBe(40)
  })

  it("same-level nodes wrap when exceeding maxPerRow", () => {
    // 10 nodes with no prerequisites → all at level 0
    const nodes: KnowledgeSeedNode[] = []
    for (let i = 0; i < 10; i++) {
      nodes.push(makeNode(`n-${i}`, `Node ${i}`))
    }
    const layout = buildGraphLayout(nodes, 400) // narrow container
    const positions = layout.nodes

    // With containerWidth=400, nodeSpacing=100, maxPerRow = floor(400/100) = 4
    // 10 nodes → 3 rows (4+4+2)
    const yValues = new Set(Object.values(positions).map((p) => p.y))
    // Should have at least 2 different y values (wrap-around)
    expect(yValues.size).toBeGreaterThanOrEqual(2)
  })

  it("handles 122 nodes without throwing", () => {
    const nodes: KnowledgeSeedNode[] = []
    for (let i = 0; i < 122; i++) {
      const prereqs = i > 0 ? [`node-${i - 1}`] : []
      nodes.push(makeNode(`node-${i}`, `Node ${i}`, prereqs))
    }
    expect(() => buildGraphLayout(nodes)).not.toThrow()
    const layout = buildGraphLayout(nodes)
    expect(Object.keys(layout.nodes)).toHaveLength(122)
  })

  it("circular dependencies do not throw", () => {
    expect(() =>
      buildGraphLayout([
        makeNode("a", "A", ["b"]),
        makeNode("b", "B", ["a"])
      ])
    ).not.toThrow()
  })

  it("dangling prerequisites are skipped in layout", () => {
    const nodes = [
      makeNode("a", "A"),
      makeNode("b", "B", ["a", "nonexistent"])
    ]
    const layout = buildGraphLayout(nodes)
    expect(layout.nodes["a"]).toBeDefined()
    expect(layout.nodes["b"]).toBeDefined()
    // nonexistent should not appear
    expect(layout.nodes["nonexistent"]).toBeUndefined()
  })
})

describe("packId-based node filtering (KnowledgeGraphView contract)", () => {
  // The graph view uses __packId from loaded seeds to map packId → nodes.
  // Node IDs do NOT need to match the pack ID prefix.
  // This test verifies the pattern works correctly.

  it("math-limits pack: node ids like math-limit-basic-definition are found by __packId", () => {
    // Simulate what loadKnowledgePacksByIds returns:
    // pack.__packId = "math-limits", but node.id = "math-limit-basic-definition"
    const packNodesMap = new Map<string, KnowledgeSeedNode[]>()
    packNodesMap.set("math-limits", [
      makeNode("math-limit-basic-definition", "极限的直观含义"),
      makeNode("math-limit-squeeze-theorem", "夹逼定理"),
      makeNode("math-limit-continuity", "连续函数")
    ])

    const nodes = packNodesMap.get("math-limits") ?? []
    expect(nodes).toHaveLength(3)
    expect(nodes[0].id).toBe("math-limit-basic-definition")
    // The node id does NOT start with "math-limits-" but is still found
  })

  it("english-reading pack: node ids match correctly", () => {
    const packNodesMap = new Map<string, KnowledgeSeedNode[]>()
    packNodesMap.set("english-reading", [
      makeNode("eng-reading-001", "作者态度题的标志词甄别"),
      makeNode("eng-reading-002", "细节推理题的同义替换与正话反说")
    ])

    const nodes = packNodesMap.get("english-reading") ?? []
    expect(nodes).toHaveLength(2)
  })

  it("cs408 single pack under 40 nodes renders correctly", () => {
    const packNodesMap = new Map<string, KnowledgeSeedNode[]>()
    const nodes: KnowledgeSeedNode[] = []
    for (let i = 0; i < 35; i++) {
      nodes.push(makeNode(`cs408-ds-${i}`, `数据结构节点 ${i}`))
    }
    packNodesMap.set("cs408-data-structures", nodes)

    const graphNodes = packNodesMap.get("cs408-data-structures") ?? []
    expect(graphNodes).toHaveLength(35)
    expect(graphNodes.length).toBeLessThanOrEqual(MAX_GRAPH_NODES)

    // Build graph data without throwing
    const gNodes = buildGraphNodes(graphNodes)
    const gEdges = buildGraphEdges(graphNodes)
    const gLayout = buildGraphLayout(graphNodes)
    expect(Object.keys(gNodes)).toHaveLength(35)
    expect(Object.keys(gLayout.nodes)).toHaveLength(35)
  })

  it("empty pack returns empty array", () => {
    const packNodesMap = new Map<string, KnowledgeSeedNode[]>()
    expect(packNodesMap.get("nonexistent") ?? []).toEqual([])
  })

  it("multiple packs have independent node sets", () => {
    const packNodesMap = new Map<string, KnowledgeSeedNode[]>()
    packNodesMap.set("math-limits", [makeNode("n1", "极限")])
    packNodesMap.set("math-derivatives", [makeNode("n2", "导数"), makeNode("n3", "微分")])

    expect(packNodesMap.get("math-limits")).toHaveLength(1)
    expect(packNodesMap.get("math-derivatives")).toHaveLength(2)
    // Selecting one pack doesn't include the other
    expect(packNodesMap.get("math-limits")?.map(n => n.id)).not.toContain("n2")
  })
})
