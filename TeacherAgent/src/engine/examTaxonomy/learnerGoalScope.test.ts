import { describe, expect, it } from "vitest"
import { isUnmodeledKaoyanMath, resolveLearnerGoalScope } from "./learnerGoalScope"

describe("learnerGoalScope", () => {
  it("识别考研数学二为未建模目标", () => {
    const result = resolveLearnerGoalScope({
      facts: [
        {
          code: "exam_name",
          label: "考试/项目",
          value: "考研",
          evidenceRefs: ["user_setting:examName"]
        },
        {
          code: "focus_subjects",
          label: "考试科目",
          value: ["数学二"],
          evidenceRefs: ["user_setting:focusSubjects"]
        },
        {
          code: "user_setting:targetDate",
          label: "目标日期",
          value: "2026-12-20",
          evidenceRefs: ["user_setting:targetDate"]
        }
      ]
    })

    expect(result.status).toBe("unmodeled")
    expect(result.examName).toBe("考研")
    expect(result.focusSubjects).toEqual(["数学二"])
    expect(result.message).toContain("尚未建模")
    expect(result.evidenceRefs).toEqual(["user_setting:examName", "user_setting:focusSubjects"])
  })

  it.each(["考研数学", "考研数学一", "数学三"])('%s 直接声明时识别为未建模', (value) => {
    expect(isUnmodeledKaoyanMath(value, [])).toBe(true)
  })

  it("忽略未授权 fact code 和目标日期，不把普通数学误判为考研数学", () => {
    const result = resolveLearnerGoalScope({
      facts: [
        { code: "user_setting:purpose", label: "学习目的", value: "数学复习", evidenceRefs: [] },
        { code: "user_setting:targetDate", label: "目标日期", value: "2026-12-20", evidenceRefs: [] },
        {
          code: "focus_subjects",
          label: "考试科目",
          value: ["数学"],
          evidenceRefs: ["user_setting:focusSubjects"]
        }
      ]
    })

    expect(result.status).toBe("provided")
    expect(result.examName).toBeNull()
    expect(result.focusSubjects).toEqual(["数学"])
    expect(result.message).toContain("出题范围仍以")
  })

  it("无分析、旧快照或无目标时保持兼容", () => {
    expect(resolveLearnerGoalScope(null)).toEqual({
      status: "none",
      examName: null,
      focusSubjects: [],
      message: null,
      evidenceRefs: []
    })
    expect(resolveLearnerGoalScope({ facts: [] }).status).toBe("none")
  })

  it("其它考试目标只作为声明，不自动映射题库", () => {
    const result = resolveLearnerGoalScope({
      facts: [
        {
          code: "exam_name",
          label: "考试/项目",
          value: "考研",
          evidenceRefs: ["user_setting:examName"]
        },
        {
          code: "focus_subjects",
          label: "考试科目",
          value: ["英语", "政治"],
          evidenceRefs: ["user_setting:focusSubjects"]
        }
      ]
    })

    expect(result.status).toBe("provided")
    expect(result.message).toContain("显式选择")
  })

  it.each([
    {
      name: "正确 code 但缺少 evidenceRef",
      exam: { code: "exam_name", value: "考研", evidenceRefs: [] },
      focus: { code: "focus_subjects", value: ["数学二"], evidenceRefs: [] }
    },
    {
      name: "正确 code 但 evidenceRef 错误",
      exam: { code: "exam_name", value: "考研", evidenceRefs: ["user_setting:purpose"] },
      focus: { code: "focus_subjects", value: ["数学二"], evidenceRefs: ["user_setting:examName"] }
    }
  ])("$name 时不采信用户目标", ({ exam, focus }) => {
    const result = resolveLearnerGoalScope({ facts: [exam, focus] })

    expect(result.status).toBe("none")
    expect(result.examName).toBeNull()
    expect(result.focusSubjects).toEqual([])
  })

  it("不把 user_setting:* 作为 fact code 采信", () => {
    const result = resolveLearnerGoalScope({
      facts: [
        {
          code: "user_setting:examName",
          label: "考试/项目",
          value: "考研数学",
          evidenceRefs: ["user_setting:examName"]
        },
        {
          code: "user_setting:focusSubjects",
          label: "考试科目",
          value: ["数学二"],
          evidenceRefs: ["user_setting:focusSubjects"]
        }
      ]
    })

    expect(result.status).toBe("none")
  })
})
