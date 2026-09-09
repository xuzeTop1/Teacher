import { describe, expect, it } from "vitest"
import { buildTutorPrompt, type TutorKnowledgeContext } from "./tutorPromptBuilder"

describe("tutorPromptBuilder", () => {
  describe("formatRuntimeInstruction", () => {
    it("requires definitions and theorem conditions without adding an unsolicited concept check", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "explain",
        maxHintLevel: "L2",
        userMessage: "微分中值定理的拉格朗日定理是什么？",
        teachingStrategy: {
          strategy: "decomposition",
          shouldAskQuestion: false,
          explanationDepth: "concept",
          intent: "concept_question"
        }
      })

      const turnLayer = result.layers.find(
        (layer) => typeof layer.content === "string" && layer.content.includes("<turn_instruction>")
      )
      const content = turnLayer!.content as string

      expect(content).toContain("先直接给出核心定义/结论")
      expect(content).toContain("必须同时说明适用条件")
      expect(content).toContain("本轮不要自行追加理解检查、练习题或以问句结尾")
      expect(content).toContain("绝不能只提问而不回答")
      expect(content).not.toContain("若学生还没有尝试，优先追问一个小问题")
    })

    it("does not let material-specific summary requests fall back to generic subject knowledge when private docs are missing", () => {
      const result = buildTutorPrompt({
        subjectCode: "physics",
        mode: "explain",
        maxHintLevel: "L2",
        userMessage: "帮我总结这份资料",
        knowledgeContext: {
          retrievalPurpose: "support_tutoring",
          topic: "力学",
          confidence: "medium",
          nodes: [
            {
              id: "physics-mechanics",
              title: "力学",
              subjectCode: "physics",
              summary: "力学研究物体运动规律。",
              sourceType: "built_in_pack"
            }
          ]
        },
        teachingStrategy: {
          strategy: "direct_review",
          shouldAskQuestion: false,
          explanationDepth: "concept",
          intent: "outline_summary"
        }
      })

      const turnLayer = result.layers.find(
        (l) => typeof l.content === "string" && l.content.includes("<turn_instruction>")
      )
      const content = turnLayer!.content as string

      expect(content).toContain("没有检索到用户本地私有资料内容")
      expect(content).toContain("不要用内置知识库、通用学科框架或常识冒充这份资料")
      expect(content).toContain("点击输入框旁的附件按钮导入 PDF/DOCX/XLSX")
      expect(content).not.toContain("先用结构化列表概括要点")
    })

    it("keeps general outline requests direct when they do not refer to a specific uploaded material", () => {
      const result = buildTutorPrompt({
        subjectCode: "physics",
        mode: "explain",
        maxHintLevel: "L2",
        userMessage: "大学物理考哪些内容",
        teachingStrategy: {
          strategy: "direct_review",
          shouldAskQuestion: false,
          explanationDepth: "concept",
          intent: "outline_summary"
        }
      })

      const turnLayer = result.layers.find(
        (l) => typeof l.content === "string" && l.content.includes("<turn_instruction>")
      )
      const content = turnLayer!.content as string

      expect(content).toContain("先用结构化列表概括要点")
      expect(content).not.toContain("不要用内置知识库、通用学科框架或常识冒充这份资料")
    })

    it("uses practice-question guidance when question bank context is available", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "你给我题目",
        toolContextNotes: [
          [
            '<tool_result tool="question_bank_search">',
            "status: success",
            "purpose: practice",
            "question_1: 基础极限",
            "content: 求 lim x->2 (3x-1)",
            "</tool_result>"
          ].join("\n")
        ],
        teachingStrategy: {
          strategy: "probing_question",
          shouldAskQuestion: true,
          explanationDepth: "method",
          intent: "default_guide"
        }
      })

      const turnLayer = result.layers.find(
        (l) => typeof l.content === "string" && l.content.includes("<turn_instruction>")
      )
      const content = turnLayer!.content as string

      expect(content).toContain("直接给出一题的完整题干")
      expect(content).toContain("不要给答案或解法")
      expect(content).not.toContain("优先追问一个小问题")
    })
  })

  describe("formatKnowledgeContext with private documents", () => {
    it("includes sourceType tag for private document nodes", () => {
      const knowledgeContext: TutorKnowledgeContext = {
        retrievalPurpose: "support_tutoring",
        topic: "极限",
        confidence: "medium",
        nodes: [
          {
            id: "math-limit",
            title: "极限",
            subjectCode: "math",
            summary: "极限的定义",
            sourceType: "built_in_pack"
          },
          {
            id: "privdoc-001",
            title: "微积分笔记",
            subjectCode: "math",
            summary: "我的笔记内容",
            sourceType: "private_document",
            documentTitle: "微积分笔记",
            fileName: "calculus.pdf",
            heading: "第一章 极限"
          }
        ],
        notes: [
          "本地知识库检索结果只用于教学参考。",
          `部分检索结果来自用户本地导入的私有资料（sourceType: private_document）。引用时请使用"你的资料中提到..."等表达。`
        ]
      }

      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L3",
        userMessage: "什么是极限？",
        knowledgeContext
      })

      // 找到 knowledge_context layer
      const knowledgeLayer = result.layers.find(
        (l) => typeof l.content === "string" && l.content.includes("<knowledge_context>")
      )
      expect(knowledgeLayer).toBeDefined()
      const content = knowledgeLayer!.content as string

      // 私有资料节点应包含 [私有资料] 标记
      expect(content).toContain("[私有资料]")
      expect(content).toContain("微积分笔记")
      expect(content).toContain("第一章 极限")

      // notes 应包含私有资料引用规则
      expect(content).toContain("你的资料中提到")
      expect(content).toContain("private_document")
    })

    it("does not expose local file path in knowledge context", () => {
      const knowledgeContext: TutorKnowledgeContext = {
        retrievalPurpose: "support_tutoring",
        topic: "测试",
        confidence: "medium",
        nodes: [
          {
            id: "privdoc-002",
            title: "资料",
            subjectCode: "math",
            summary: "内容",
            sourceType: "private_document",
            documentTitle: "资料",
            fileName: "document.pdf",
            heading: null
          }
        ]
      }

      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L3",
        userMessage: "test",
        knowledgeContext
      })

      const knowledgeLayer = result.layers.find(
        (l) => typeof l.content === "string" && l.content.includes("<knowledge_context>")
      )
      const content = knowledgeLayer!.content as string

      // 不应包含本地路径
      expect(content).not.toMatch(/[A-Z]:\\/)
      expect(content).not.toMatch(/\/home\//)
      // fileName 不应出现在 knowledge_context 中（只在 source 里）
      // 但 documentTitle 可以出现
      expect(content).toContain("资料")
    })

    it("works correctly with only built-in pack nodes", () => {
      const knowledgeContext: TutorKnowledgeContext = {
        retrievalPurpose: "support_tutoring",
        topic: "极限",
        confidence: "high",
        nodes: [
          {
            id: "math-limit",
            title: "极限",
            subjectCode: "math",
            summary: "极限的定义",
            sourceType: "built_in_pack"
          }
        ]
      }

      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L3",
        userMessage: "什么是极限？",
        knowledgeContext
      })

      const knowledgeLayer = result.layers.find(
        (l) => typeof l.content === "string" && l.content.includes("<knowledge_context>")
      )
      const content = knowledgeLayer!.content as string

      // 不应包含 [私有资料] 标记
      expect(content).not.toContain("[私有资料]")
      // 不应包含私有资料相关 notes
      expect(content).not.toContain("private_document")
    })

    it("includes '不要声称无法查看' rule when private nodes are present", () => {
      const knowledgeContext: TutorKnowledgeContext = {
        retrievalPurpose: "support_tutoring",
        topic: "考研政治大纲",
        confidence: "medium",
        nodes: [
          {
            id: "privdoc-003",
            title: "考研政治大纲",
            subjectCode: "politics",
            summary: "马克思主义基本原理概论",
            sourceType: "private_document",
            documentTitle: "考研政治大纲",
            fileName: "politics.pdf",
            heading: "马原"
          }
        ],
        notes: [
          "本轮已检索到用户本地私有资料（sourceType: private_document）。",
          "不要声称无法查看用户上传的资料——你已经检索到本地私有资料内容，应基于这些内容进行辅导。"
        ]
      }

      const result = buildTutorPrompt({
        subjectCode: "politics",
        mode: "guide",
        maxHintLevel: "L3",
        userMessage: "你看到我上传的政治考研大纲吗？",
        knowledgeContext
      })

      const knowledgeLayer = result.layers.find(
        (l) => typeof l.content === "string" && l.content.includes("<knowledge_context>")
      )
      const content = knowledgeLayer!.content as string

      // 应包含 [私有资料] 标记
      expect(content).toContain("[私有资料]")
      // 应包含不要声称无法查看的规则
      expect(content).toContain("不要声称无法查看")
      // notes 应包含已检索到用户本地私有资料
      expect(content).toContain("已检索到用户本地私有资料")
    })
  })

  describe("multimodal attachments", () => {
    it("produces plain string content when no attachments", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "什么是极限？"
      })

      const userLayer = result.layers.find((l) => l.role === "user")
      expect(userLayer).toBeDefined()
      expect(typeof userLayer!.content).toBe("string")
    })

    it("produces multimodal content parts when attachments are present", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "请识别图片中的题目",
        attachments: [
          {
            id: "att-1",
            type: "image",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,abc123"
          }
        ]
      })

      const userLayer = result.layers.find((l) => l.role === "user")
      expect(userLayer).toBeDefined()
      expect(Array.isArray(userLayer!.content)).toBe(true)

      const parts = userLayer!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(parts.length).toBe(2)
      expect(parts[0].type).toBe("text")
      expect(parts[0].text).toContain("请识别图片中的题目")
      expect(parts[1].type).toBe("image_url")
      expect(parts[1].image_url?.url).toBe("data:image/png;base64,abc123")
    })

    it("includes multiple images in content parts", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "比较这两张图",
        attachments: [
          { id: "att-1", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,aaa" },
          { id: "att-2", type: "image", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,bbb" }
        ]
      })

      const userLayer = result.layers.find((l) => l.role === "user")
      const parts = userLayer!.content as Array<{ type: string }>
      expect(parts.length).toBe(3) // text + 2 images
      expect(parts.filter((p) => p.type === "image_url").length).toBe(2)
    })

    it("only the user message layer gets multimodal content", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "看图",
        attachments: [
          { id: "att-1", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" }
        ]
      })

      // System layers should still be plain strings
      const systemLayers = result.layers.filter((l) => l.role === "system")
      for (const layer of systemLayers) {
        expect(typeof layer.content).toBe("string")
      }
    })

    it("filters out attachments with empty dataUrl", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "看图",
        attachments: [
          { id: "att-1", type: "image", mimeType: "image/png", dataUrl: "" },
          { id: "att-2", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,valid" }
        ]
      })

      const userLayer = result.layers.find((l) => l.role === "user")
      const parts = userLayer!.content as Array<{ type: string }>
      // Should have text + 1 valid image (empty one filtered out)
      expect(parts.length).toBe(2)
      expect(parts[1].type).toBe("image_url")
    })

    it("falls back to string content when all attachments have empty dataUrl", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "看图",
        attachments: [
          { id: "att-1", type: "image", mimeType: "image/png", dataUrl: "" }
        ]
      })

      const userLayer = result.layers.find((l) => l.role === "user")
      expect(typeof userLayer!.content).toBe("string")
    })

    it("filters out non-image attachment types", () => {
      const result = buildTutorPrompt({
        subjectCode: "math",
        mode: "guide",
        maxHintLevel: "L2",
        userMessage: "看图",
        attachments: [
          { id: "att-1", type: "image" as const, mimeType: "image/png", dataUrl: "data:image/png;base64,abc" },
          { id: "att-2", type: "image" as const, mimeType: "image/png", dataUrl: "" }
        ]
      })

      const userLayer = result.layers.find((l) => l.role === "user")
      const parts = userLayer!.content as Array<{ type: string }>
      expect(parts.length).toBe(2) // text + 1 valid image
    })
  })
})
