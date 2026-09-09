import { describe, expect, it } from "vitest"

import type { TutorTurnResult } from "../../engine/agents/tutorOrchestrator"
import {
  createGuardrailSummaryJson,
  createKnowledgeRefsJson,
  createTutorTurnToolRefsJson,
  parsePlannerResultFromToolRefs,
  restoreChatMessagesFromStoredMessages,
  serializeChatMessageToolRefs
} from "./chatMessageMetadata"

describe("parsePlannerResultFromToolRefs", () => {
  it("restores planner result metadata from message tool refs", () => {
    const result = parsePlannerResultFromToolRefs(
      JSON.stringify({
        plannerResult: {
          trigger: "user_requested_schedule",
          subjectCode: "math",
          summary: "今天先复习极限基础，再做一道夹逼定理练习。",
          nextTasks: [
            {
              id: "task-1",
              type: "review",
              title: "复习夹逼定理",
              rationale: "最近请求了复习计划。",
              estimatedMinutes: 12,
              priority: "high"
            }
          ],
          reviewFocus: ["夹逼定理"],
          masterySignals: ["math-limit-squeeze-theorem: 0.46"],
          prerequisiteSignals: ["先补等价无穷小"],
          reviewDueSignals: ["已间隔 4 天未复习"],
          planningHorizon: "today",
          confidence: 0.82
        }
      })
    )

    expect(result?.subjectCode).toBe("math")
    expect(result?.planningHorizon).toBe("today")
    expect(result?.nextTasks).toHaveLength(1)
    expect(result?.reviewFocus).toContain("夹逼定理")
    expect(result?.masterySignals).toContain("math-limit-squeeze-theorem: 0.46")
    expect(result?.confidence).toBe(0.82)
  })

  it("defaults optional signal arrays and confidence for older metadata", () => {
    const result = parsePlannerResultFromToolRefs(
      JSON.stringify({
        plannerResult: {
          trigger: "user_requested_next_step",
          subjectCode: "math",
          summary: "继续学极限。",
          nextTasks: [],
          planningHorizon: "next_turn"
        }
      })
    )

    expect(result?.reviewFocus).toEqual([])
    expect(result?.masterySignals).toEqual([])
    expect(result?.prerequisiteSignals).toEqual([])
    expect(result?.reviewDueSignals).toEqual([])
    expect(result?.confidence).toBe(0)
  })

  it("ignores malformed or non-planner tool refs", () => {
    expect(parsePlannerResultFromToolRefs("[]")).toBeUndefined()
    expect(parsePlannerResultFromToolRefs("{not-json")).toBeUndefined()
    expect(parsePlannerResultFromToolRefs(JSON.stringify({ plannerResult: { nextTasks: "bad" } }))).toBeUndefined()
  })

  it("restores stored student and tutor messages with planner metadata", () => {
    const messages = restoreChatMessagesFromStoredMessages([
      {
        id: "student-1",
        role: "student",
        content: "今天我该怎么复习极限？",
        knowledgeRefsJson: "[]",
        toolRefsJson: "[]",
        guardrailJson: "{}"
      },
      {
        id: "tool-1",
        role: "tool",
        content: "internal tool output",
        knowledgeRefsJson: "[]",
        toolRefsJson: "[]",
        guardrailJson: "{}"
      },
      {
        id: "tutor-1",
        role: "tutor",
        content: "今天先复习夹逼定理。",
        knowledgeRefsJson: JSON.stringify([{ id: "math-limit-squeeze-theorem" }]),
        toolRefsJson: JSON.stringify({
          plannerResult: {
            trigger: "user_requested_schedule",
            subjectCode: "math",
            summary: "今天先复习夹逼定理。",
            nextTasks: [
              {
                id: "task-1",
                type: "review",
                title: "复习夹逼定理",
                rationale: "用户请求今天的复习安排。",
                estimatedMinutes: 10,
                priority: "high"
              }
            ],
            reviewFocus: ["夹逼定理"],
            planningHorizon: "today",
            confidence: 0.76
          }
        }),
        guardrailJson: JSON.stringify({ allowed: true })
      }
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      id: "student-1",
      role: "student",
      content: "今天我该怎么复习极限？"
    })
    expect(messages[1]?.plannerResult?.summary).toBe("今天先复习夹逼定理。")
    expect(messages[1]?.plannerResult?.reviewFocus).toContain("夹逼定理")
    expect(messages[1]?.knowledgeRefsJson).toContain("math-limit-squeeze-theorem")
    expect(messages[1]?.guardrailJson).toContain("allowed")
  })

  it("serializes planner metadata for message persistence", () => {
    const toolRefsJson = serializeChatMessageToolRefs({
      plannerResult: {
        trigger: "user_requested_schedule",
        subjectCode: "math",
        summary: "今天先复习极限定义。",
        nextTasks: [
          {
            id: "task-1",
            type: "review",
            title: "复习极限定义",
            rationale: "用户请求今日复习安排。",
            estimatedMinutes: 8,
            priority: "medium"
          }
        ],
        reviewFocus: ["极限定义"],
        masterySignals: [],
        prerequisiteSignals: [],
        reviewDueSignals: [],
        chapterSignals: [],
        planningHorizon: "today",
        confidence: 0.71
      }
    })

    const restored = parsePlannerResultFromToolRefs(toolRefsJson)

    expect(restored?.summary).toBe("今天先复习极限定义。")
    expect(restored?.nextTasks[0]?.title).toBe("复习极限定义")
    expect(restored?.confidence).toBe(0.71)
  })

  it("preserves existing tool refs and uses an empty array for messages without metadata", () => {
    const existing = JSON.stringify({ provider: { name: "Fake Provider" } })

    expect(serializeChatMessageToolRefs({ toolRefsJson: existing })).toBe(existing)
    expect(serializeChatMessageToolRefs({})).toBe("[]")
  })

  it("stores only structured tutor turn metadata without raw drafts or internal tool labels", () => {
    const toolRefsJson = createTutorTurnToolRefsJson(
      {},
      {
        content: "我们先复盘关键判断：哪一项有界？",
        rawDraft: "answer_for_internal_review_only: 0\nsolution_steps_for_internal_review_only: 内部步骤",
        mode: "review",
        maxHintLevel: "L4",
        guardrailReview: {
          allowed: true,
          maxHintLevelDetected: "L2",
          violations: [],
          rewriteRequired: false,
          source: "rule",
          rewriteAttempts: 0
        },
        promptVersion: "tutor-system-v1",
        providerName: "Fake Provider",
        model: "fake-model",
        socraticDecision: {
          mode: "review",
          maxHintLevel: "L4",
          strategy: "direct_review",
          shouldAskQuestion: false,
          explanationDepth: "full_review",
          rationale: "学生请求复盘。",
          intent: "review",
          riskSignals: []
        },
        toolAgentResult: {
          questionBankSearch: {
            ok: true,
            data: {
              questions: [
                {
                  questionId: "question-1",
                  title: "夹逼定理复盘题",
                  content: "设 x -> 0，求 x sin(1/x) 的极限。",
                  type: "solution",
                  difficulty: 2,
                  knowledgeNodeIds: ["math-limit-squeeze-theorem"],
                  hints: [{ level: "L1", text: "先判断 sin(1/x) 是否有界。" }],
                  answer: "0",
                  solutionSteps: ["answer_for_internal_review_only: 0"],
                  source: {
                    id: "teacher-agent-original",
                    title: "TeacherAgent 原创题库",
                    license: "CC-BY-4.0"
                  },
                  score: 9
                }
              ]
            }
          },
          toolContextNotes: [
            "answer_for_internal_review_only: 0\nsolution_steps_for_internal_review_only: 内部步骤"
          ]
        }
      } as TutorTurnResult
    )

    const metadata = JSON.parse(toolRefsJson)

    expect(metadata.provider).toEqual({
      name: "Fake Provider",
      model: "fake-model",
      promptVersion: "tutor-system-v1"
    })
    expect(metadata.tools.questionBankSearch).toEqual({
      ok: true,
      resultCount: 1,
      questionIds: ["question-1"]
    })
    expect(toolRefsJson).not.toContain("rawDraft")
    expect(toolRefsJson).not.toContain("answer_for_internal_review_only")
    expect(toolRefsJson).not.toContain("solution_steps_for_internal_review_only")
    expect(toolRefsJson).not.toContain("内部步骤")
  })

  it("stores only guardrail review summary without rewrite prompts or fallback text", () => {
    const guardrailJson = createGuardrailSummaryJson({
      guardrailReview: {
        allowed: false,
        source: "merged",
        maxHintLevelDetected: "L4",
        violations: ["internal_leak"],
        rewriteRequired: true,
        rewriteAttempts: 1,
        rewriteInstruction:
          "去掉 answer_for_internal_review_only 和 solution_steps_for_internal_review_only，只保留引导问题。",
        fallbackReply: "我先不直接给完整答案。我们从最小的一步开始。"
      }
    })
    const summary = JSON.parse(guardrailJson)

    expect(summary).toEqual({
      allowed: false,
      source: "merged",
      maxHintLevelDetected: "L4",
      violations: ["internal_leak"],
      rewriteRequired: true,
      rewriteAttempts: 1
    })
    expect(guardrailJson).not.toContain("rewriteInstruction")
    expect(guardrailJson).not.toContain("fallbackReply")
    expect(guardrailJson).not.toContain("answer_for_internal_review_only")
    expect(guardrailJson).not.toContain("完整答案")
  })

  it("stores only knowledge references without full RAG context", () => {
    const knowledgeRefsJson = createKnowledgeRefsJson({
      toolAgentResult: {
        knowledgeContext: {
          retrievalPurpose: "support_tutoring",
          topic: "夹逼定理",
          confidence: "high",
          notes: ["内部检索说明，不应落库到 knowledge_refs_json"],
          nodes: [
            {
              id: "math-limit-squeeze-theorem",
              title: "夹逼定理",
              subjectCode: "math",
              summary: "若目标函数被两个同极限的函数夹住，则目标函数同极限。",
              misconceptions: ["把有界和趋近于 0 混为一谈"],
              socraticHints: [{ level: "L1", text: "先找上下界。" }]
            }
          ]
        },
        toolContextNotes: []
      }
    })

    expect(JSON.parse(knowledgeRefsJson)).toEqual([
      {
        id: "math-limit-squeeze-theorem",
        title: "夹逼定理",
        subjectCode: "math"
      }
    ])
    expect(knowledgeRefsJson).not.toContain("summary")
    expect(knowledgeRefsJson).not.toContain("misconceptions")
    expect(knowledgeRefsJson).not.toContain("socraticHints")
    expect(knowledgeRefsJson).not.toContain("内部检索说明")
    expect(createKnowledgeRefsJson({ toolAgentResult: { toolContextNotes: [] } })).toBe("[]")
  })
})
