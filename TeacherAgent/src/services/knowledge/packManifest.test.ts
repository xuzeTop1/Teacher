import { describe, it, expect } from "vitest"

import { PACK_MANIFEST } from "./packManifest"
import { loadKnowledgePack, loadQuestionPack, clearPackCache } from "./packLoader"

describe("PACK_MANIFEST expected counts match actual seed data", () => {
  // Clear cache before tests so each pack is freshly loaded
  clearPackCache()

  for (const pack of PACK_MANIFEST) {
    it(`${pack.id}: expectedNodeCount === nodes.length`, async () => {
      const seed = await loadKnowledgePack(pack.id)
      expect(seed.nodes.length).toBe(pack.expectedNodeCount)
    })

    it(`${pack.id}: expectedQuestionCount === questions.length`, async () => {
      const seed = await loadQuestionPack(pack.id)
      expect(seed.questions.length).toBe(pack.expectedQuestionCount)
    })
  }
})
