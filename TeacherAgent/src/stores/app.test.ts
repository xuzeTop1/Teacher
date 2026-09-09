import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"

import { SELECTED_SUBJECT_STORAGE_KEY, useAppStore } from "./app"

describe("app store subject persistence", () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear())
    })
    setActivePinia(createPinia())
  })

  it("restores programming instead of resetting to math after refresh", () => {
    storage.set(SELECTED_SUBJECT_STORAGE_KEY, "programming")

    const store = useAppStore()

    expect(store.selectedSubject).toBe("programming")
  })

  it("persists subject changes immediately", () => {
    const store = useAppStore()

    store.setSelectedSubject("programming")

    expect(storage.get(SELECTED_SUBJECT_STORAGE_KEY)).toBe("programming")
  })

  it("falls back to math when a persisted custom subject no longer exists", () => {
    storage.set(SELECTED_SUBJECT_STORAGE_KEY, "custom-deleted")
    const store = useAppStore()

    store.setCustomSubjects([])

    expect(store.selectedSubject).toBe("math")
    expect(storage.get(SELECTED_SUBJECT_STORAGE_KEY)).toBe("math")
  })
})
