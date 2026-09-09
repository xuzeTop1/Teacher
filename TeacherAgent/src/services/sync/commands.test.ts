import { describe, expect, it, vi } from "vitest"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock("@tauri-apps/api/core", () => ({ invoke }))

import { getSyncDeviceState, loadPersistedSyncDiagnosticAssessments } from "./commands"

describe("getSyncDeviceState", () => {
  it("uses the atomic device-state command with deviceId", async () => {
    const state = {
      readModel: {
        subjects: [],
        weeklyGoals: [],
        tasks: [],
        studySessions: [],
        latestLearningAnalysis: null
      },
      lastSnapshot: null
    }
    invoke.mockResolvedValue(state)

    await expect(getSyncDeviceState("device-123")).resolves.toBe(state)
    expect(invoke).toHaveBeenCalledWith("sync_get_device_state", { deviceId: "device-123" })
  })
})

describe("loadPersistedSyncDiagnosticAssessments", () => {
  it("uses the typed DB-authoritative command with candidate ids only", async () => {
    const records = [{
      assessmentId: "diag-1",
      teacherSubjectId: "cs408",
      correct: true,
      questionId: "q-1",
      alertSubjectRemoteId: "alert-cn",
      examTrackId: "408",
      examSubjectId: "408.computer-networks",
      examModuleId: null,
      createdAt: "2026-08-11T10:00:00.000Z"
    }]
    invoke.mockResolvedValue(records)

    await expect(loadPersistedSyncDiagnosticAssessments(["diag-1"])).resolves.toBe(records)
    expect(invoke).toHaveBeenCalledWith("load_persisted_sync_diagnostic_assessments", { ids: ["diag-1"] })
  })
})
