import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { validLocalInferences, validateLocalInference, factContainsInference } from "./localCoach"
const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../sync/protocol/fixtures/${name}.json`, import.meta.url), "utf8")).payload.learningAnalysis
describe("B1 local inference boundary", () => {
  it.each(["task1", "task2", "task3", "all", "fallback"])("accepts shared %s fixture", kind => { expect(validLocalInferences(load(`snapshot-inferences-${kind}-valid`).inferences)).toBe(true) })
  it.each(["evidence", "advice", "unexpected", "enum", "bkt-negative", "bkt-positive", "task3-fallback"])("rejects shared %s fixture", kind => { expect(validLocalInferences(load(`snapshot-inferences-${kind}-invalid`).inferences)).toBe(false) })
  it("rejects inferred values promoted into facts", () => {
    const facts = load("snapshot-inferences-facts-promotion-invalid").profile.facts
    expect(facts.some((v: { code: string; value: unknown }) => factContainsInference(v.code, v.value))).toBe(true)
  })
  it("rejects wrong fallback values and missing reasons", () => {
    const v = load("snapshot-inferences-fallback-valid").inferences[0]
    expect(validateLocalInference({ ...v, r_focus: 0.5 })).toBe(false)
    expect(validateLocalInference({ ...v, fallback_reason: "none" })).toBe(false)
    expect(validLocalInferences([v, v])).toBe(false)
  })
})
