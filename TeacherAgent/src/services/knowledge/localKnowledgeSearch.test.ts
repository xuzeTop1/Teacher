import { describe, expect, it } from "vitest"

import { searchLocalKnowledgeLazy, searchLocalKnowledge } from "./localKnowledgeSearch"

describe("searchLocalKnowledgeLazy", () => {
  it("returns the squeeze theorem node for a direct topic query", async () => {
    const result = await searchLocalKnowledgeLazy({
      query: "夹逼定理",
      subject: "math",
      topK: 3,
      searchMode: "hybrid",
      includePrerequisites: true,
      includeMisconceptions: true,
      includeSocraticHints: true
    })

    expect(result.ok).toBe(true)
    expect(result.data?.results.map((node) => node.knowledgeNodeId)).toContain("math-limit-squeeze-theorem")
  })

  it("can find a discontinuity concept by Chinese phrase token", async () => {
    const result = await searchLocalKnowledgeLazy({
      query: "可去间断",
      subject: "math",
      topK: 3,
      searchMode: "hybrid",
      includePrerequisites: false,
      includeMisconceptions: false,
      includeSocraticHints: false
    })

    expect(result.ok).toBe(true)
    expect(result.data?.results[0]?.knowledgeNodeId).toBe("math-discontinuity-removable")
    expect(result.data?.results[0]?.misconceptions).toEqual([])
    expect(result.data?.results[0]?.socraticHints).toEqual([])
  })
})

describe("searchLocalKnowledge (deprecated sync)", () => {
  it("returns empty results — callers must migrate to lazy version", () => {
    const result = searchLocalKnowledge({
      query: "夹逼定理",
      subject: "math",
      topK: 3,
      searchMode: "hybrid",
      includePrerequisites: false,
      includeMisconceptions: false,
      includeSocraticHints: false
    })
    expect(result.ok).toBe(true)
    expect(result.data?.results).toEqual([])
  })
})

describe("subject isolation", () => {
  it("math query does not return cs408 nodes", async () => {
    const result = await searchLocalKnowledgeLazy({
      query: "数据结构",
      subject: "math",
      topK: 5,
      searchMode: "hybrid",
      includePrerequisites: false,
      includeMisconceptions: false,
      includeSocraticHints: false
    })
    expect(result.ok).toBe(true)
    // All results should be from math subject
    for (const r of result.data?.results ?? []) {
      expect(r.subject).toBe("math")
    }
  })

  it("cs408 query does not return math nodes", async () => {
    const result = await searchLocalKnowledgeLazy({
      query: "极限",
      subject: "cs408",
      topK: 5,
      searchMode: "hybrid",
      includePrerequisites: false,
      includeMisconceptions: false,
      includeSocraticHints: false
    })
    expect(result.ok).toBe(true)
    for (const r of result.data?.results ?? []) {
      expect(r.subject).toBe("cs408")
    }
  })

  it("politics query returns only politics nodes", async () => {
    const result = await searchLocalKnowledgeLazy({
      query: "马克思主义",
      subject: "politics",
      topK: 5,
      searchMode: "hybrid",
      includePrerequisites: false,
      includeMisconceptions: false,
      includeSocraticHints: false
    })
    expect(result.ok).toBe(true)
    for (const r of result.data?.results ?? []) {
      expect(r.subject).toBe("politics")
    }
  })

  it("no subject and no enabledPackIds returns empty (no cross-subject leak)", async () => {
    const result = await searchLocalKnowledgeLazy({
      query: "极限",
      topK: 5,
      searchMode: "hybrid",
      includePrerequisites: false,
      includeMisconceptions: false,
      includeSocraticHints: false
    })
    expect(result.ok).toBe(true)
    expect(result.data?.results).toEqual([])
  })

  it("enabledPackIds subset restricts to those packs only", async () => {
    // Search with only math-limits pack enabled
    const result = await searchLocalKnowledgeLazy({
      query: "极限",
      subject: "math",
      enabledPackIds: ["math-limits"],
      topK: 5,
      searchMode: "hybrid",
      includePrerequisites: false,
      includeMisconceptions: false,
      includeSocraticHints: false
    })
    expect(result.ok).toBe(true)
    // Should find limit-related nodes
    expect(result.data?.results.length).toBeGreaterThan(0)
  })
})
