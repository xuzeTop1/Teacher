import { isTauri } from "@tauri-apps/api/core"
import type { AssessmentResult } from "../../types/assessment"
import { saveAssessmentResult } from "../tauri/commands"

/** Preview skips IPC explicitly; desktop storage failures must reach callers. */
export async function persistAssessment(result: AssessmentResult): Promise<"saved" | "preview"> {
  if (!isTauri()) return "preview"
  await saveAssessmentResult(result)
  return "saved"
}
