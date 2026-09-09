import { describe, it, expect, beforeEach, vi } from "vitest"
import { setActivePinia, createPinia } from "pinia"
import { usePackSelectionStore, AVAILABLE_SUBJECTS } from "./packSelection"
import { PACK_MANIFEST } from "../services/knowledge/packManifest"

// Mock localStorage for migration tests
const localStorageStore = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageStore.delete(key) }),
  clear: vi.fn(() => { localStorageStore.clear() }),
  get length() { return localStorageStore.size },
  key: vi.fn((index: number) => [...localStorageStore.keys()][index] ?? null)
}

// Patch both global localStorage and window.localStorage for vitest node env
vi.stubGlobal("localStorage", mockLocalStorage)
vi.stubGlobal("window", { localStorage: mockLocalStorage })

describe("packSelection store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageStore.clear()
    vi.clearAllMocks()
  })

  describe("getSubjectPacks", () => {
    it("returns math packs", () => {
      const store = usePackSelectionStore()
      const packs = store.getSubjectPacks("math")
      expect(packs.length).toBeGreaterThan(0)
      expect(packs.every((p) => p.subject === "math")).toBe(true)
    })

    it("returns cs408 packs", () => {
      const store = usePackSelectionStore()
      const packs = store.getSubjectPacks("cs408")
      expect(packs.length).toBeGreaterThan(0)
      expect(packs.every((p) => p.subject === "cs408")).toBe(true)
    })
  })

  describe("getEnabledPackIds", () => {
    it("defaults to approved math packs only (not draft)", () => {
      const store = usePackSelectionStore()
      const allPacks = store.getSubjectPacks("math")
      const approvedPacks = allPacks.filter((p) => p.status === "approved")
      const enabledIds = store.getEnabledPackIds("math")
      expect(enabledIds.length).toBe(approvedPacks.length)
      // Only approved packs should be in the default list
      for (const id of enabledIds) {
        const pack = allPacks.find((p) => p.id === id)
        expect(pack?.status).toBe("approved")
      }
    })

    it("defaults to approved cs408 packs (all draft = 0)", () => {
      const store = usePackSelectionStore()
      const allPacks = store.getSubjectPacks("cs408")
      const approvedPacks = allPacks.filter((p) => p.status === "approved")
      const enabledIds = store.getEnabledPackIds("cs408")
      expect(enabledIds.length).toBe(approvedPacks.length)
    })

    it("pack selections are independent across subjects", () => {
      const store = usePackSelectionStore()
      const target = AVAILABLE_SUBJECTS
        .map(({ code }) => ({ code, packs: store.getSubjectPacks(code) }))
        .find(({ packs }) =>
          packs.some((pack) => pack.status === "approved") &&
          packs.some((pack) => pack.status === "draft")
        )
      expect(target).toBeDefined()
      if (!target) return

      const approvedPack = target.packs.find((pack) => pack.status === "approved")!
      const draftPack = target.packs.find((pack) => pack.status === "draft")!
      const untouchedSubject = AVAILABLE_SUBJECTS.find(({ code }) => code !== target.code)!.code
      const untouchedBefore = store.getEnabledPackIds(untouchedSubject)

      // Enabling a draft first makes removing the approved pack a valid operation.
      store.enablePack(target.code, draftPack.id)
      store.disablePack(target.code, approvedPack.id)

      expect(store.getEnabledPackIds(target.code)).toContain(draftPack.id)
      expect(store.getEnabledPackIds(target.code)).not.toContain(approvedPack.id)
      expect(store.getEnabledPackIds(untouchedSubject)).toEqual(untouchedBefore)
    })
  })

  describe("getEnabledPacks", () => {
    it("returns enabled pack objects", () => {
      const store = usePackSelectionStore()
      const enabledPacks = store.getEnabledPacks("math")
      // Should return at least the approved packs
      expect(enabledPacks.length).toBeGreaterThan(0)
      expect(enabledPacks.every((p) => p.subject === "math")).toBe(true)
      // All returned packs should be approved (since only approved are enabled by default)
      expect(enabledPacks.every((p) => p.status === "approved")).toBe(true)
    })
  })

  describe("getEnabledNodeCount", () => {
    it("calculates total nodes for math approved packs", () => {
      const store = usePackSelectionStore()
      const count = store.getEnabledNodeCount("math")
      expect(count).toBeGreaterThan(0)
    })

    it("updates after disabling approved pack", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPacks = mathPacks.filter((p) => p.status === "approved")
      const draftPacks = mathPacks.filter((p) => p.status === "draft")
      if (approvedPacks.length === 0 || draftPacks.length === 0) return
      // Enable a draft pack so we can disable the approved one
      store.enablePack("math", draftPacks[0].id)
      const initialCount = store.getEnabledNodeCount("math")
      store.disablePack("math", approvedPacks[0].id)
      expect(store.getEnabledNodeCount("math")).toBe(initialCount - approvedPacks[0].expectedNodeCount)
    })
  })

  describe("getEnabledQuestionCount", () => {
    it("calculates total questions for math", () => {
      const store = usePackSelectionStore()
      const count = store.getEnabledQuestionCount("math")
      expect(count).toBeGreaterThan(0)
    })
  })

  describe("isPackEnabled", () => {
    it("returns true for approved pack", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPack = mathPacks.find((p) => p.status === "approved")
      if (!approvedPack) return
      expect(store.isPackEnabled("math", approvedPack.id)).toBe(true)
    })

    it("returns false for draft pack by default", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const draftPack = mathPacks.find((p) => p.status === "draft")
      if (!draftPack) return
      expect(store.isPackEnabled("math", draftPack.id)).toBe(false)
    })

    it("returns false after disabling an approved pack", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPack = mathPacks.find((p) => p.status === "approved")
      const draftPack = mathPacks.find((p) => p.status === "draft")
      if (!approvedPack || !draftPack) return
      // Enable a draft pack so we can disable the approved one
      store.enablePack("math", draftPack.id)
      store.disablePack("math", approvedPack.id)
      expect(store.isPackEnabled("math", approvedPack.id)).toBe(false)
    })
  })

  describe("hasEnabledPacks", () => {
    it("returns true when math has approved packs", () => {
      const store = usePackSelectionStore()
      expect(store.hasEnabledPacks("math")).toBe(true)
    })
  })

  describe("enablePack / disablePack", () => {
    it("disables an approved pack", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPack = mathPacks.find((p) => p.status === "approved")
      const draftPack = mathPacks.find((p) => p.status === "draft")
      if (!approvedPack || !draftPack) return
      // Enable a draft pack so we can disable the approved one
      store.enablePack("math", draftPack.id)
      const result = store.disablePack("math", approvedPack.id)
      expect(result).toBe(true)
      expect(store.isPackEnabled("math", approvedPack.id)).toBe(false)
    })

    it("enables a disabled approved pack", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPack = mathPacks.find((p) => p.status === "approved")
      if (!approvedPack) return
      store.disablePack("math", approvedPack.id)
      store.enablePack("math", approvedPack.id)
      expect(store.isPackEnabled("math", approvedPack.id)).toBe(true)
    })

    it("can enable a draft pack explicitly", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const draftPack = mathPacks.find((p) => p.status === "draft")
      if (!draftPack) return
      expect(store.isPackEnabled("math", draftPack.id)).toBe(false)
      store.enablePack("math", draftPack.id)
      expect(store.isPackEnabled("math", draftPack.id)).toBe(true)
    })

    it("cannot disable the last enabled pack", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const enabledIds = store.getEnabledPackIds("math")
      // Disable all but one enabled pack
      for (let i = 1; i < enabledIds.length; i++) {
        store.disablePack("math", enabledIds[i])
      }
      // Try to disable the last one
      const result = store.disablePack("math", enabledIds[0])
      expect(result).toBe(false)
      expect(store.isPackEnabled("math", enabledIds[0])).toBe(true)
    })

    it("disabling math pack does not affect cs408", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPack = mathPacks.find((p) => p.status === "approved")
      const cs408InitialEnabled = store.getEnabledPackIds("cs408").length

      if (approvedPack) {
        store.disablePack("math", approvedPack.id)
      }

      expect(store.getEnabledPackIds("cs408").length).toBe(cs408InitialEnabled)
    })
  })

  describe("togglePack", () => {
    it("toggles approved pack state", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPack = mathPacks.find((p) => p.status === "approved")
      const draftPack = mathPacks.find((p) => p.status === "draft")
      if (!approvedPack || !draftPack) return
      // Enable a draft pack so we can toggle the approved one off
      store.enablePack("math", draftPack.id)
      store.togglePack("math", approvedPack.id)
      expect(store.isPackEnabled("math", approvedPack.id)).toBe(false)
      store.togglePack("math", approvedPack.id)
      expect(store.isPackEnabled("math", approvedPack.id)).toBe(true)
    })

    it("returns false when trying to toggle last enabled pack off", () => {
      const store = usePackSelectionStore()
      const enabledIds = store.getEnabledPackIds("math")
      // Disable all but one
      for (let i = 1; i < enabledIds.length; i++) {
        store.disablePack("math", enabledIds[i])
      }
      // Try to toggle the last one off
      const result = store.togglePack("math", enabledIds[0])
      expect(result).toBe(false)
    })
  })

  describe("batch operations", () => {
    it("enableAllPacks explicitly enables approved and draft packs", () => {
      const store = usePackSelectionStore()
      // physics has 5 draft packs and 0 approved packs
      const physicsPacks = store.getSubjectPacks("physics")
      const draftPacks = physicsPacks.filter((p) => p.status === "draft")
      expect(draftPacks.length).toBeGreaterThan(0)

      store.enableAllPacks("physics")

      expect(store.getEnabledPackIds("physics")).toEqual(physicsPacks.map((pack) => pack.id))
      expect(store.getEnabledPackIds("physics").some((id) =>
        physicsPacks.find((pack) => pack.id === id)?.status === "draft"
      )).toBe(true)
    })

    it("enableAllPacks works for an all-draft subject", () => {
      const store = usePackSelectionStore()
      // shenlun is still all-draft (4 packs, 0 approved)
      const shenlunPacks = store.getSubjectPacks("shenlun")
      expect(shenlunPacks.length).toBeGreaterThan(0)
      expect(shenlunPacks.every((pack) => pack.status === "draft")).toBe(true)

      store.enableAllPacks("shenlun")

      expect(store.getEnabledPackIds("shenlun")).toEqual(shenlunPacks.map((pack) => pack.id))
    })

    it("disableAllPacks keeps one currently enabled pack", () => {
      const store = usePackSelectionStore()
      store.enableAllPacks("math")
      store.disableAllPacks("math")
      expect(store.getEnabledPackIds("math").length).toBe(1)
    })

    it("resets to default (approved only)", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPacks = mathPacks.filter((p) => p.status === "approved")
      const approvedPack = approvedPacks[0]
      if (!approvedPack) return
      store.enableAllPacks("math")
      store.disablePack("math", approvedPack.id)
      store.resetToDefault("math")
      expect(store.getEnabledPackIds("math")).toEqual(approvedPacks.map((pack) => pack.id))
    })

    it("batch operations on one subject do not affect another", () => {
      const store = usePackSelectionStore()
      const cs408InitialEnabled = store.getEnabledPackIds("cs408").length

      store.disableAllPacks("math")

      expect(store.getEnabledPackIds("cs408").length).toBe(cs408InitialEnabled)
    })
  })

  describe("AVAILABLE_SUBJECTS", () => {
    it("contains math, cs408, physics, english, politics", () => {
      const codes = AVAILABLE_SUBJECTS.map((s) => s.code)
      expect(codes).toContain("math")
      expect(codes).toContain("cs408")
      expect(codes).toContain("physics")
      expect(codes).toContain("english")
      expect(codes).toContain("politics")
    })

    it("covers every subject in PACK_MANIFEST", () => {
      const manifestSubjects = [...new Set(PACK_MANIFEST.map((p) => p.subject))]
      const availableCodes = AVAILABLE_SUBJECTS.map((s) => s.code)
      for (const subject of manifestSubjects) {
        expect(availableCodes).toContain(subject)
      }
    })

    it("includes english", () => {
      const codes = AVAILABLE_SUBJECTS.map((s) => s.code)
      expect(codes).toContain("english")
    })

    it("english label is 考研英语", () => {
      const english = AVAILABLE_SUBJECTS.find((s) => s.code === "english")
      expect(english?.label).toBe("考研英语")
    })

    it("politics label is 政治", () => {
      const politics = AVAILABLE_SUBJECTS.find((s) => s.code === "politics")
      expect(politics?.label).toBe("政治")
    })

    it("contains xingce with label 行测", () => {
      const xingce = AVAILABLE_SUBJECTS.find((s) => s.code === "xingce")
      expect(xingce).toBeDefined()
      expect(xingce?.label).toBe("行测")
    })

    it("contains shenlun with label 申论", () => {
      const shenlun = AVAILABLE_SUBJECTS.find((s) => s.code === "shenlun")
      expect(shenlun).toBeDefined()
      expect(shenlun?.label).toBe("申论")
    })
  })

  describe("english packs", () => {
    it("getSubjectPacks returns 4 english packs", () => {
      const store = usePackSelectionStore()
      const packs = store.getSubjectPacks("english")
      expect(packs.length).toBe(4)
      expect(packs.every((p) => p.subject === "english")).toBe(true)
    })

    it("defaults to approved english packs only (all draft = 0)", () => {
      const store = usePackSelectionStore()
      const allPacks = store.getSubjectPacks("english")
      const approvedPacks = allPacks.filter((p) => p.status === "approved")
      const enabledIds = store.getEnabledPackIds("english")
      expect(enabledIds.length).toBe(approvedPacks.length)
    })

    it("disabling english pack does not affect math/cs408/physics/politics", () => {
      const store = usePackSelectionStore()
      const englishPacks = store.getSubjectPacks("english")
      const mathInitial = store.getEnabledPackIds("math").length
      const cs408Initial = store.getEnabledPackIds("cs408").length
      const physicsInitial = store.getEnabledPackIds("physics").length
      const politicsInitial = store.getEnabledPackIds("politics").length

      // Enable a draft pack first, then disable it
      if (englishPacks.length > 0) {
        store.enablePack("english", englishPacks[0].id)
        store.disablePack("english", englishPacks[0].id)
      }

      expect(store.getEnabledPackIds("math").length).toBe(mathInitial)
      expect(store.getEnabledPackIds("cs408").length).toBe(cs408Initial)
      expect(store.getEnabledPackIds("physics").length).toBe(physicsInitial)
      expect(store.getEnabledPackIds("politics").length).toBe(politicsInitial)
    })
  })

  describe("politics packs", () => {
    it("getSubjectPacks returns 4 politics packs", () => {
      const store = usePackSelectionStore()
      const packs = store.getSubjectPacks("politics")
      expect(packs.length).toBe(4)
      expect(packs.every((p) => p.subject === "politics")).toBe(true)
    })

    it("defaults to approved politics packs only (all draft = 0)", () => {
      const store = usePackSelectionStore()
      const allPacks = store.getSubjectPacks("politics")
      const approvedPacks = allPacks.filter((p) => p.status === "approved")
      const enabledIds = store.getEnabledPackIds("politics")
      expect(enabledIds.length).toBe(approvedPacks.length)
    })

    it("disabling politics pack does not affect other subjects", () => {
      const store = usePackSelectionStore()
      const politicsPacks = store.getSubjectPacks("politics")
      const mathInitial = store.getEnabledPackIds("math").length
      const cs408Initial = store.getEnabledPackIds("cs408").length
      const englishInitial = store.getEnabledPackIds("english").length

      // Enable a draft pack first, then disable it
      if (politicsPacks.length > 0) {
        store.enablePack("politics", politicsPacks[0].id)
        store.disablePack("politics", politicsPacks[0].id)
      }

      expect(store.getEnabledPackIds("math").length).toBe(mathInitial)
      expect(store.getEnabledPackIds("cs408").length).toBe(cs408Initial)
      expect(store.getEnabledPackIds("english").length).toBe(englishInitial)
    })

    it("politics pack ids do not appear in math enabledPackIds", () => {
      const store = usePackSelectionStore()
      const politicsPacks = store.getSubjectPacks("politics")
      const mathEnabled = store.getEnabledPackIds("math")
      for (const pack of politicsPacks) {
        expect(mathEnabled).not.toContain(pack.id)
      }
    })
  })

  describe("store does not maintain selectedSubject", () => {
    it("has no selectedSubject property", () => {
      const store = usePackSelectionStore()
      expect(store).not.toHaveProperty("selectedSubject")
    })

    it("all methods require subject parameter", () => {
      const store = usePackSelectionStore()
      // These should work with explicit subject
      expect(store.getSubjectPacks("math")).toBeDefined()
      expect(store.getEnabledPackIds("math")).toBeDefined()
      expect(store.getEnabledPacks("math")).toBeDefined()
      expect(store.getEnabledNodeCount("math")).toBeDefined()
      expect(store.getEnabledQuestionCount("math")).toBeDefined()
      expect(store.isPackEnabled("math", "test")).toBeDefined()
      expect(store.hasEnabledPacks("math")).toBeDefined()
    })
  })

  describe("search integration", () => {
    it("getEnabledPackIds returns only approved ids for filtering", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const enabledIds = store.getEnabledPackIds("math")
      const approvedPacks = mathPacks.filter((p) => p.status === "approved")

      // Should contain all approved math pack ids
      for (const pack of approvedPacks) {
        expect(enabledIds).toContain(pack.id)
      }

      // Should not contain draft math pack ids
      const draftPacks = mathPacks.filter((p) => p.status === "draft")
      for (const pack of draftPacks) {
        expect(enabledIds).not.toContain(pack.id)
      }

      // Should not contain cs408 pack ids
      const cs408Packs = store.getSubjectPacks("cs408")
      for (const pack of cs408Packs) {
        expect(enabledIds).not.toContain(pack.id)
      }
    })

    it("disabled pack id is excluded from getEnabledPackIds", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const approvedPack = mathPacks.find((p) => p.status === "approved")
      const draftPack = mathPacks.find((p) => p.status === "draft")
      if (!approvedPack || !draftPack) return
      // Enable a draft pack so we can disable the approved one
      store.enablePack("math", draftPack.id)
      store.disablePack("math", approvedPack.id)

      const enabledIds = store.getEnabledPackIds("math")
      expect(enabledIds).not.toContain(approvedPack.id)
    })
  })

  describe("status contract", () => {
    it("every pack in manifest has a status field", () => {
      for (const pack of PACK_MANIFEST) {
        expect(pack.status).toBeDefined()
        expect(["approved", "draft"]).toContain(pack.status)
      }
    })

    it("draft packs are not in default enabled list", () => {
      const store = usePackSelectionStore()
      const allPacks = store.getSubjectPacks("math")
      const enabledIds = store.getEnabledPackIds("math")
      for (const pack of allPacks) {
        if (pack.status === "draft") {
          expect(enabledIds).not.toContain(pack.id)
        }
      }
    })

    it("approved packs are in default enabled list", () => {
      const store = usePackSelectionStore()
      const allPacks = store.getSubjectPacks("math")
      const enabledIds = store.getEnabledPackIds("math")
      for (const pack of allPacks) {
        if (pack.status === "approved") {
          expect(enabledIds).toContain(pack.id)
        }
      }
    })

    it("user can explicitly enable draft pack", () => {
      const store = usePackSelectionStore()
      const mathPacks = store.getSubjectPacks("math")
      const draftPack = mathPacks.find((p) => p.status === "draft")
      if (!draftPack) return
      store.enablePack("math", draftPack.id)
      expect(store.isPackEnabled("math", draftPack.id)).toBe(true)
    })
  })

  describe("localStorage migration", () => {
    it("migrates v1 data containing all packs to only approved", () => {
      // Simulate v1 data: all pack IDs enabled for math
      const allMathPackIds = PACK_MANIFEST
        .filter((p) => p.subject === "math")
        .map((p) => p.id)
      const v1Data: Record<string, string[]> = { math: allMathPackIds }

      // Write v1 format to localStorage
      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v1Data))

      // Create a new store instance — it should migrate on load
      const store = usePackSelectionStore()
      const enabledIds = store.getEnabledPackIds("math")

      // Only approved packs should be retained
      const approvedMathPacks = PACK_MANIFEST.filter(
        (p) => p.subject === "math" && p.status === "approved"
      )
      expect(enabledIds.length).toBe(approvedMathPacks.length)
      for (const id of enabledIds) {
        const pack = PACK_MANIFEST.find((p) => p.id === id)
        expect(pack?.status).toBe("approved")
      }
    })

    it("migrates all-draft subject to empty default", () => {
      // xingce has all draft packs (5 packs, 0 approved)
      const allXingcePackIds = PACK_MANIFEST
        .filter((p) => p.subject === "xingce")
        .map((p) => p.id)
      const v1Data: Record<string, string[]> = { xingce: allXingcePackIds }

      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v1Data))

      const store = usePackSelectionStore()
      const enabledIds = store.getEnabledPackIds("xingce")

      // All xingce packs are draft, so migration should result in empty list
      expect(enabledIds.length).toBe(0)
    })

    it("v2 format is preserved correctly", () => {
      const v2Data = {
        version: 2,
        packs: { math: ["math-limits"] }
      }

      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v2Data))

      const store = usePackSelectionStore()
      expect(store.getEnabledPackIds("math")).toEqual(["math-limits"])
    })

    it("unknown version is discarded", () => {
      const badData = { version: 99, packs: { math: ["math-limits"] } }

      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(badData))

      const store = usePackSelectionStore()
      // Should fall back to approved-only defaults
      const enabledIds = store.getEnabledPackIds("math")
      expect(enabledIds).toContain("math-limits")
    })

    it("malformed data is safely ignored", () => {
      localStorage.setItem("teacher-agent-enabled-packs", "not-json{")

      const store = usePackSelectionStore()
      // Should fall back to approved-only defaults
      const enabledIds = store.getEnabledPackIds("math")
      expect(enabledIds.length).toBeGreaterThan(0)
    })

    it("unknown pack IDs are silently dropped during migration", () => {
      const v1Data = {
        math: ["math-limits", "nonexistent-pack", "also-fake"]
      }

      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v1Data))

      const store = usePackSelectionStore()
      const enabledIds = store.getEnabledPackIds("math")
      expect(enabledIds).toEqual(["math-limits"])
    })

    it("saves in v2 format after migration", () => {
      const v1Data = { math: ["math-limits"] }
      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v1Data))

      const store = usePackSelectionStore()
      // Trigger a write by enabling a draft pack (physics still has draft packs)
      const draftPack = PACK_MANIFEST.find(
        (p) => p.subject === "physics" && p.status === "draft"
      )
      if (draftPack) {
        store.enablePack("physics", draftPack.id)
      }

      const saved = JSON.parse(localStorage.getItem("teacher-agent-enabled-packs") ?? "{}")
      expect(saved.version).toBe(2)
      expect(saved.packs).toBeDefined()
    })

    it("user can explicitly enable draft after migration", () => {
      const store = usePackSelectionStore()
      const draftPack = PACK_MANIFEST.find(
        (p) => p.subject === "math" && p.status === "draft"
      )
      if (!draftPack) return

      store.enablePack("math", draftPack.id)
      expect(store.isPackEnabled("math", draftPack.id)).toBe(true)

      // Verify it persists in v2 format
      const saved = JSON.parse(localStorage.getItem("teacher-agent-enabled-packs") ?? "{}")
      expect(saved.version).toBe(2)
      expect(saved.packs.math).toContain(draftPack.id)
    })

    it("v2 draft explicit authorization persists across store rebuild", () => {
      const draftPack = PACK_MANIFEST.find(
        (p) => p.subject === "math" && p.status === "draft"
      )
      if (!draftPack) return

      // Step 1: Create store, explicitly enable draft
      const store1 = usePackSelectionStore()
      store1.enablePack("math", draftPack.id)
      expect(store1.isPackEnabled("math", draftPack.id)).toBe(true)

      // Step 2: Verify v2 format written
      const saved = JSON.parse(localStorage.getItem("teacher-agent-enabled-packs") ?? "{}")
      expect(saved.version).toBe(2)
      expect(saved.packs.math).toContain(draftPack.id)

      // Step 3: Create new Pinia + new store (simulates app restart)
      setActivePinia(createPinia())
      const store2 = usePackSelectionStore()

      // Step 4: Draft should still be enabled
      expect(store2.isPackEnabled("math", draftPack.id)).toBe(true)
      expect(store2.getEnabledPackIds("math")).toContain(draftPack.id)
    })

    it("v1 draft IDs are discarded even if same ID exists in v2", () => {
      const draftPack = PACK_MANIFEST.find(
        (p) => p.subject === "math" && p.status === "draft"
      )
      if (!draftPack) return

      // Write v1 data that includes a draft pack ID
      const v1Data = { math: ["math-limits", draftPack.id] }
      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v1Data))

      // Create store — v1 migration should discard the draft ID
      const store = usePackSelectionStore()
      const enabledIds = store.getEnabledPackIds("math")

      // Only approved pack should be retained
      expect(enabledIds).toContain("math-limits")
      expect(enabledIds).not.toContain(draftPack.id)
    })

    it("v2 preserves draft ID for correct subject", () => {
      const draftPack = PACK_MANIFEST.find(
        (p) => p.subject === "math" && p.status === "draft"
      )
      if (!draftPack) return

      // Write v2 data with a draft pack
      const v2Data = {
        version: 2,
        packs: { math: ["math-limits", draftPack.id] }
      }
      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v2Data))

      const store = usePackSelectionStore()
      const enabledIds = store.getEnabledPackIds("math")

      // Both approved and draft should be retained in v2
      expect(enabledIds).toContain("math-limits")
      expect(enabledIds).toContain(draftPack.id)
    })

    it("v2 drops draft ID if pack does not belong to subject", () => {
      // Write v2 data with a cross-subject draft ID
      const v2Data = {
        version: 2,
        packs: { math: ["math-limits", "cs408-data-structures"] }
      }
      localStorage.setItem("teacher-agent-enabled-packs", JSON.stringify(v2Data))

      const store = usePackSelectionStore()
      const enabledIds = store.getEnabledPackIds("math")

      // Cross-subject ID should be dropped
      expect(enabledIds).toContain("math-limits")
      expect(enabledIds).not.toContain("cs408-data-structures")
    })
  })
})
