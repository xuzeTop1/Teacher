import { afterEach, describe, expect, it, vi } from "vitest"
import { persistAssessment } from "./assessmentPersistence"
import * as commands from "../tauri/commands"
import type { AssessmentResult } from "../../types/assessment"

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe("assessment persistence boundary", () => {
  it("skips IPC only in browser preview", async () => {
    vi.stubGlobal("isTauri", false)
    const save = vi.spyOn(commands,"saveAssessmentResult")
    expect(await persistAssessment({} as AssessmentResult)).toBe("preview")
    expect(save).not.toHaveBeenCalled()
  })
  it("propagates desktop storage failure and retries the same assessment", async () => {
    vi.stubGlobal("isTauri", true)
    const save=vi.spyOn(commands,"saveAssessmentResult").mockRejectedValueOnce(new Error("SQLITE_FULL")).mockResolvedValueOnce({} as commands.StoredAssessmentResult)
    const assessment={id:"same-id"} as AssessmentResult
    await expect(persistAssessment(assessment)).rejects.toThrow("SQLITE_FULL")
    expect(await persistAssessment(assessment)).toBe("saved")
    expect(save.mock.calls.map(([arg])=>arg.id)).toEqual(["same-id","same-id"])
  })
})
