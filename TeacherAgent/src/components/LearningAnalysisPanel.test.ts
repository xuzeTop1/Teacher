import { renderToString } from "@vue/server-renderer"
import { createSSRApp, defineComponent, h } from "vue"
import { describe, expect, it } from "vitest"
import { createVuetify } from "vuetify"
import LearningAnalysisPanel from "./LearningAnalysisPanel.vue"
import type { SyncLearningAnalysisDto } from "../types/sync"

function createSsrStub(element: string) {
  return defineComponent({
    name: `Ssr${element}`,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => h(element, attrs, slots.default ? slots.default() : [])
    }
  })
}

const testVuetify = createVuetify({
  components: {
    VAlert: createSsrStub("div"),
    VCard: createSsrStub("section"),
    VCardText: createSsrStub("div"),
    VCardTitle: createSsrStub("h2"),
    VCol: createSsrStub("div"),
    VDivider: createSsrStub("hr"),
    VIcon: createSsrStub("span"),
    VList: createSsrStub("ul"),
    VListItem: createSsrStub("li"),
    VListItemSubtitle: createSsrStub("small"),
    VListItemTitle: createSsrStub("div"),
    VRow: createSsrStub("div")
  }
})

const SNAPSHOT_ID = "snapshot-20260811-00000000"

function buildValidAnalysis(): SyncLearningAnalysisDto {
  return {
    analysisId: "analysis-20260811-00000000",
    sourceSnapshotId: SNAPSHOT_ID,
    generatedAt: 1_786_435_200_000,
    promptVersion: "learning-analysis-v1",
    generator: "android_llm",
    profile: {
      facts: [
        {
          code: "today.completed_tasks",
          label: "今日完成计划",
          value: 2,
          evidenceRefs: ["task:task-linear-algebra-01", "task:task-network-02"]
        }
      ],
      inferences: [
        {
          statement: "今天的计划执行较完整，但计算机网络仍需要复习",
          confidence: 0.85,
          evidenceRefs: ["task:task-network-02", "session:session-focus-01"]
        }
      ]
    },
    planEvaluation: {
      verdict: "needs_adjustment",
      score: 76,
      dimensions: [
        {
          code: "coverage",
          score: 72,
          summary: "计划覆盖了数学和计算机网络两个重点方向"
        }
      ],
      risks: ["计算机网络复习时间偏少"],
      suggestions: ["明天增加一次计算机网络的短时复习"]
    },
    assessmentDraft: {
      status: "draft",
      scopeSummary: "根据今日完成计划生成的概念检查题",
      questions: [
        {
          questionId: "question-network-0001",
          subjectRemoteId: "subject-cs-network-01",
          taskRemoteId: "task-network-02",
          type: "concept_check",
          prompt: "请说明 TCP 三次握手中每一步的作用。",
          rationale: "用于检查今日计算机网络计划中的核心概念",
          rubric: ["能说出三次报文交换", "能解释可靠连接建立的目的"]
        }
      ]
    },
    warnings: ["学习时长只作为执行事实，不直接代表掌握度。"]
  }
}

async function renderPanel(
  analysis: SyncLearningAnalysisDto | null,
  snapshotId: string | null
): Promise<string> {
  const app = createSSRApp({
    render: () => h(LearningAnalysisPanel, { analysis, snapshotId })
  })
  app.use(testVuetify)
  return renderToString(app)
}

describe("LearningAnalysisPanel", () => {
  it("renders the bound analysis sections and their safety disclosures", async () => {
    const html = await renderPanel(buildValidAnalysis(), SNAPSHOT_ID)

    expect(html).toContain("手机同步事实")
    expect(html).toContain("今日完成计划")
    expect(html).toContain("task:task-linear-algebra-01")
    expect(html).toContain("模型推断")
    expect(html).toContain("今天的计划执行较完整，但计算机网络仍需要复习")
    expect(html).toContain("置信度 85%")
    expect(html).toContain("计划合理性评估：计划需要调整")
    expect(html).toContain("风险：计算机网络复习时间偏少")
    expect(html).toContain("建议：明天增加一次计算机网络的短时复习")
    expect(html).toContain("自评题草稿")
    expect(html).toContain("请说明 TCP 三次握手中每一步的作用。")
    expect(html).toContain("评分标准：能说出三次报文交换；能解释可靠连接建立的目的")
    expect(html).toContain("Android LLM（手机端生成）")
    expect(html).toContain("Prompt：learning-analysis-v1")
    expect(html).toContain("不会自动修改手机计划或掌握度")
    expect(html).toContain("不计入掌握度、不写入 assessment_results、不进入 approved 题库")
  })

  it("shows an explicit warning when the validated user goal is unmodeled kaoyan math", async () => {
    const analysis = buildValidAnalysis()
    analysis.profile.facts = [
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
      }
    ]

    const html = await renderPanel(analysis, SNAPSHOT_ID)

    expect(html).toContain("尚未建模考研数学")
    expect(html).toContain("不会自动使用普通 math 题库")
  })

  it("falls back without rendering analysis content when snapshot IDs mismatch", async () => {
    const html = await renderPanel(
      { ...buildValidAnalysis(), sourceSnapshotId: "snapshot-other-00000000" },
      SNAPSHOT_ID
    )

    expect(html).toContain("当前快照没有可展示的学习分析，或分析与快照不匹配")
    expect(html).not.toContain("手机同步事实")
    expect(html).not.toContain("请说明 TCP 三次握手中每一步的作用。")
    expect(html).not.toContain("Android LLM（手机端生成）")
  })

  it("falls back without rendering analysis content when analysis is null", async () => {
    const html = await renderPanel(null, SNAPSHOT_ID)

    expect(html).toContain("当前快照没有可展示的学习分析，或分析与快照不匹配")
    expect(html).not.toContain("模型推断")
    expect(html).not.toContain("计划合理性评估")
    expect(html).not.toContain("自评题草稿")
  })
})
