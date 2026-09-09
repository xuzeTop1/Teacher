import { describe, it, expect, beforeEach } from "vitest"
import {
  getProviderGuides,
  getApprovedProviderGuides,
  getProviderGuideById,
  applyModelPreset,
  applyBaseUrlPreset,
  matchGuideError,
  resetGuideCache,
  validateGuide,
  GuideValidationError,
} from "./providerGuideRegistry"

describe("providerGuideRegistry", () => {
  beforeEach(() => {
    resetGuideCache()
  })

  describe("schema validation", () => {
    it("loads all 3 guides successfully", () => {
      const guides = getProviderGuides()
      expect(guides).toHaveLength(3)
      expect(guides.map((g) => g.id).sort()).toEqual([
        "guide-kimi",
        "guide-ollama",
        "guide-openai-compatible",
      ])
    })

    it("all guides have required fields", () => {
      const guides = getProviderGuides()
      for (const guide of guides) {
        expect(guide.id).toBeTruthy()
        expect(guide.providerName).toBeTruthy()
        expect(guide.displayName).toBeTruthy()
        expect(guide.description).toBeTruthy()
        expect(guide.status).toBeTruthy()
        expect(guide.guideVersion).toBeTruthy()
        expect(guide.verifiedAt).toBeTruthy()
        expect(guide.officialSources.length).toBeGreaterThan(0)
      }
    })

    it("all guides have valid status", () => {
      const guides = getProviderGuides()
      for (const guide of guides) {
        expect(["approved", "draft"]).toContain(guide.status)
      }
    })

    it("no duplicate guide IDs", () => {
      const guides = getProviderGuides()
      const ids = guides.map((g) => g.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it("no duplicate model preset IDs within each guide", () => {
      const guides = getProviderGuides()
      for (const guide of guides) {
        const presetIds = guide.modelPresets.map((p) => p.id)
        expect(new Set(presetIds).size).toBe(presetIds.length)
      }
    })

    it("no duplicate commonError IDs within each guide", () => {
      const guides = getProviderGuides()
      for (const guide of guides) {
        const errorIds = guide.commonErrors.map((e) => e.id)
        expect(new Set(errorIds).size).toBe(errorIds.length)
      }
    })

    it("all officialSources have url and verifiedAt", () => {
      const guides = getProviderGuides()
      for (const guide of guides) {
        for (const source of guide.officialSources) {
          expect(source.url).toMatch(/^https?:\/\//)
          expect(source.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          expect(source.title).toBeTruthy()
        }
      }
    })
  })

  describe("approved/draft filtering", () => {
    it("all current guides are approved", () => {
      const approved = getApprovedProviderGuides()
      expect(approved).toHaveLength(3)
    })

    it("getProviderGuideById returns correct guide", () => {
      const kimi = getProviderGuideById("guide-kimi")
      expect(kimi).toBeDefined()
      expect(kimi!.providerName).toBe("kimi")
      expect(kimi!.displayName).toBe("Kimi / Moonshot")
    })

    it("getProviderGuideById returns undefined for unknown ID", () => {
      expect(getProviderGuideById("nonexistent")).toBeUndefined()
    })
  })

  describe("Kimi guide specifics", () => {
    it("has correct base URL preset", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      expect(kimi.baseUrlPresets[0].url).toBe("https://api.moonshot.cn/v1")
    })

    it("kimi-k2.6 is recommended and omitTemperature with fixedSampling", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const k26 = kimi.modelPresets.find((p) => p.id === "kimi-k2.6")!
      expect(k26.recommended).toBe(true)
      expect(k26.omitTemperature).toBe(true)
      expect(k26.fixedSampling).toBe(true)
      expect(k26.supportsVision).toBe(true)
    })

    it("kimi-k2.5 also omits temperature with fixedSampling", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const k25 = kimi.modelPresets.find((p) => p.id === "kimi-k2.5")!
      expect(k25.omitTemperature).toBe(true)
      expect(k25.fixedSampling).toBe(true)
    })

    it("has temperature error guidance", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const tempError = kimi.commonErrors.find((e) => e.id === "kimi-err-400-temperature")
      expect(tempError).toBeDefined()
      expect(tempError!.matchPatterns).toContain("invalid temperature")
    })

    it("has thinking/empty content error guidance", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const thinkingError = kimi.commonErrors.find((e) => e.id === "kimi-err-thinking-empty")
      expect(thinkingError).toBeDefined()
      expect(thinkingError!.explanation).toContain("思考过程")
    })
  })

  describe("Ollama guide specifics", () => {
    it("has correct default base URL", () => {
      const ollama = getProviderGuideById("guide-ollama")!
      expect(ollama.baseUrlPresets[0].url).toBe("http://localhost:11434/v1")
    })

    it("distinguishes chat model from embedding model", () => {
      const ollama = getProviderGuideById("guide-ollama")!
      const chatPreset = ollama.modelPresets.find((p) => p.id === "ollama-qwen3")!
      const embPreset = ollama.modelPresets.find((p) => p.id === "ollama-bge-m3")!
      expect(chatPreset.textModel).toBeTruthy()
      expect(chatPreset.supportsEmbedding).toBe(false)
      expect(embPreset.embeddingModel).toBe("bge-m3")
      expect(embPreset.textModel).toBe("")
      expect(embPreset.supportsEmbedding).toBe(true)
    })

    it("has connection error guidance", () => {
      const ollama = getProviderGuideById("guide-ollama")!
      const connError = ollama.commonErrors.find((e) => e.id === "ollama-err-connection")
      expect(connError).toBeDefined()
      expect(connError!.matchPatterns).toContain("econnrefused")
    })
  })

  describe("preset application", () => {
    it("applyModelPreset returns model fields but never API key", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const result = applyModelPreset(kimi, "kimi-k2.6")
      expect(result).not.toBeNull()
      expect(result!.model).toBe("kimi-k2.6")
      expect(result!.textModel).toBe("kimi-k2.6")
      expect(result!.visionModel).toBe("kimi-k2.6")
      expect(result!.supportsVision).toBe(true)
      expect(result!.providerName).toBe("Kimi / Moonshot")
      expect(result!.isLocal).toBe(false)
      expect(result!.baseUrl).toBe("https://api.moonshot.cn/v1")
      // Must NOT contain apiKey
      expect(result).not.toHaveProperty("apiKey")
    })

    it("applyModelPreset for Ollama returns isLocal=true and embeddingModel", () => {
      const ollama = getProviderGuideById("guide-ollama")!
      const result = applyModelPreset(ollama, "ollama-bge-m3")
      expect(result).not.toBeNull()
      expect(result!.isLocal).toBe(true)
      expect(result!.providerName).toBe("Ollama（本地模型）")
      expect(result!.embeddingModel).toBe("bge-m3")
      expect(result!.baseUrl).toBe("http://localhost:11434/v1")
      expect(result).not.toHaveProperty("apiKey")
    })

    it("applyModelPreset returns null for unknown preset", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      expect(applyModelPreset(kimi, "nonexistent")).toBeNull()
    })

    it("applyBaseUrlPreset returns baseUrl, providerName and isLocal but never API key", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const result = applyBaseUrlPreset(kimi, "kimi-default")
      expect(result).not.toBeNull()
      expect(result!.baseUrl).toBe("https://api.moonshot.cn/v1")
      expect(result!.providerName).toBe("Kimi / Moonshot")
      expect(result!.isLocal).toBe(false)
      expect(result).not.toHaveProperty("apiKey")
    })

    it("applyBaseUrlPreset for Ollama returns isLocal=true", () => {
      const ollama = getProviderGuideById("guide-ollama")!
      const result = applyBaseUrlPreset(ollama, "ollama-default")
      expect(result).not.toBeNull()
      expect(result!.baseUrl).toBe("http://localhost:11434/v1")
      expect(result!.isLocal).toBe(true)
      expect(result!.providerName).toBe("Ollama（本地模型）")
    })

    it("applyBaseUrlPreset returns null for unknown preset", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      expect(applyBaseUrlPreset(kimi, "nonexistent")).toBeNull()
    })
  })

  describe("error matching", () => {
    it("matches Kimi 401 error", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const match = matchGuideError(kimi, "HTTP 401 Unauthorized: invalid api key")
      expect(match).not.toBeNull()
      expect(match!.id).toBe("kimi-err-401")
    })

    it("matches Kimi temperature error", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const match = matchGuideError(kimi, "400 Bad Request: invalid temperature parameter")
      expect(match).not.toBeNull()
      expect(match!.id).toBe("kimi-err-400-temperature")
    })

    it("matches Ollama connection error", () => {
      const ollama = getProviderGuideById("guide-ollama")!
      const match = matchGuideError(ollama, "fetch failed: ECONNREFUSED 127.0.0.1:11434")
      expect(match).not.toBeNull()
      expect(match!.id).toBe("ollama-err-connection")
    })

    it("matches OpenAI compatible 404", () => {
      const oai = getProviderGuideById("guide-openai-compatible")!
      const match = matchGuideError(oai, "404 Not Found: model_not_found")
      expect(match).not.toBeNull()
      expect(match!.id).toBe("oai-err-404")
    })

    it("returns null for unknown error", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const match = matchGuideError(kimi, "some completely unknown error xyz")
      expect(match).toBeNull()
    })

    it("generic 400 without temperature keyword does NOT match temperature error", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const match = matchGuideError(kimi, "400 Bad Request: invalid model format")
      // Should NOT match kimi-err-400-temperature since "400" was removed from patterns
      expect(match?.id).not.toBe("kimi-err-400-temperature")
    })

    it("matching is case-insensitive", () => {
      const kimi = getProviderGuideById("guide-kimi")!
      const match = matchGuideError(kimi, "INVALID TEMPERATURE parameter")
      expect(match).not.toBeNull()
      expect(match!.id).toBe("kimi-err-400-temperature")
    })
  })

  describe("security", () => {
    it("no guide contains real API key patterns", () => {
      const guides = getProviderGuides()
      const json = JSON.stringify(guides)
      // No real API key patterns (sk- followed by 20+ chars)
      expect(json).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
    })

    it("guides are isolated from knowledge base (no packManifest import)", () => {
      // This test verifies structural isolation: providerGuideRegistry
      // does not import from packManifest, packLoader, or knowledge services
      const registrySource = require("fs").readFileSync(
        require("path").resolve(__dirname, "./providerGuideRegistry.ts"),
        "utf-8"
      )
      // Check for actual import statements, not comments
      expect(registrySource).not.toMatch(/import.*from.*packManifest/)
      expect(registrySource).not.toMatch(/import.*from.*packLoader/)
      expect(registrySource).not.toMatch(/import.*from.*knowledgeSearch/)
      expect(registrySource).not.toMatch(/import.*from.*embedding/)
      expect(registrySource).not.toMatch(/import.*from.*toolAgent/)
    })
  })

  describe("validation rejection (negative tests)", () => {
    const validBase = {
      id: "test-guide",
      providerName: "test",
      displayName: "Test",
      description: "A test guide",
      status: "approved",
      guideVersion: "1.0.0",
      verifiedAt: "2026-01-01",
      baseUrlPresets: [],
      modelPresets: [],
      capabilities: { supportsStreaming: true },
      commonErrors: [],
      fieldHelp: [],
      setupSteps: [],
      officialSources: [{ title: "Docs", url: "https://example.com", verifiedAt: "2026-01-01" }],
      securityNotices: [{ id: "sec-1", title: "Notice", description: "Test notice" }],
    }

    it("rejects missing status", () => {
      const { status, ...rest } = validBase
      expect(() => validateGuide(rest)).toThrow(GuideValidationError)
    })

    it("rejects missing capabilities", () => {
      const { capabilities, ...rest } = validBase
      expect(() => validateGuide(rest)).toThrow(GuideValidationError)
    })

    it("rejects missing securityNotices", () => {
      const { securityNotices, ...rest } = validBase
      expect(() => validateGuide(rest)).toThrow(GuideValidationError)
    })

    it("rejects missing officialSources", () => {
      const { officialSources, ...rest } = validBase
      expect(() => validateGuide(rest)).toThrow(GuideValidationError)
    })

    it("rejects invalid status value", () => {
      expect(() => validateGuide({ ...validBase, status: "published" })).toThrow(GuideValidationError)
    })

    it("rejects officialSources with invalid URL", () => {
      const bad = { ...validBase, officialSources: [{ title: "X", url: "ftp://bad.com", verifiedAt: "2026-01-01" }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects officialSources with missing verifiedAt", () => {
      const bad = { ...validBase, officialSources: [{ title: "X", url: "https://ok.com" }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects officialSources with malformed verifiedAt", () => {
      const bad = { ...validBase, officialSources: [{ title: "X", url: "https://ok.com", verifiedAt: "Jan 2026" }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects modelPreset with non-boolean fixedSampling", () => {
      const bad = { ...validBase, modelPresets: [{ id: "m1", label: "M1", fixedSampling: "yes" }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects duplicate model preset IDs", () => {
      const bad = { ...validBase, modelPresets: [{ id: "m1", label: "A" }, { id: "m1", label: "B" }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects commonError with non-string resolutionSteps element", () => {
      const bad = { ...validBase, commonErrors: [{ id: "e1", title: "E", explanation: "x", matchPatterns: ["err"], resolutionSteps: [123] }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects commonError with empty matchPatterns", () => {
      const bad = { ...validBase, commonErrors: [{ id: "e1", title: "E", explanation: "x", matchPatterns: [], resolutionSteps: [] }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects baseUrlPresets with invalid URL", () => {
      const bad = { ...validBase, baseUrlPresets: [{ id: "b1", label: "B", url: "not-a-url" }] }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })

    it("rejects non-string field in key string fields", () => {
      const bad = { ...validBase, providerName: 123 }
      expect(() => validateGuide(bad)).toThrow(GuideValidationError)
    })
  })
})
