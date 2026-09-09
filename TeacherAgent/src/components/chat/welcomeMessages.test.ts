import { describe, expect, it } from "vitest"
import { getWelcomeContent, createWelcomeMessages } from "./welcomeMessages"

describe("welcomeMessages", () => {
  describe("politics welcome", () => {
    it("contains 考研政治 keywords", () => {
      const content = getWelcomeContent("politics")
      expect(content).toContain("考研政治")
      expect(content).toContain("马克思主义")
      expect(content).toContain("毛泽东思想")
      expect(content).toContain("近现代史纲要")
      expect(content).toContain("思想道德与法治")
    })

    it("does not contain math-specific content", () => {
      const content = getWelcomeContent("politics")
      expect(content).not.toContain("极限")
      expect(content).not.toContain("夹逼定理")
      expect(content).not.toContain("线性代数")
      expect(content).not.toContain("\\lim")
      expect(content).not.toContain("\\frac")
    })

    it("mentions importing own materials", () => {
      const content = getWelcomeContent("politics")
      expect(content).toContain("导入自己的大纲或讲义")
      expect(content).toContain("本地资料")
    })
  })

  describe("math welcome", () => {
    it("contains math keywords", () => {
      const content = getWelcomeContent("math")
      expect(content).toContain("极限")
      expect(content).toContain("夹逼定理")
    })

    it("does not contain politics keywords", () => {
      const content = getWelcomeContent("math")
      expect(content).not.toContain("考研政治")
      expect(content).not.toContain("马克思主义")
    })
  })

  describe("programming welcome", () => {
    it("describes the Python tutoring and local runner capabilities", () => {
      const content = getWelcomeContent("programming")
      expect(content).toContain("Python 编程辅导")
      expect(content).toContain("Python 练习台")
      expect(content).toContain("本机 Python 解释器")
      expect(content).toContain("仅支持 **Python**")
      expect(content).toContain("不是安全沙箱")
    })

    it("does not fall back to the generic multi-subject copy", () => {
      const content = getWelcomeContent("programming")
      expect(content).not.toContain("我可以帮你学习各学科内容")
      expect(content).not.toContain("你最想复习哪个章节")
    })
  })

  describe("management welcome", () => {
    it("contains management keywords", () => {
      const content = getWelcomeContent("management")
      expect(content).toContain("管理类联考")
      expect(content).toContain("逻辑")
      expect(content).toContain("论证有效性")
      expect(content).toContain("论说文")
    })

    it("does not contain math-specific content", () => {
      const content = getWelcomeContent("management")
      expect(content).not.toContain("极限")
      expect(content).not.toContain("线性代数")
      expect(content).not.toContain("夹逼定理")
      expect(content).not.toContain("\\lim")
      expect(content).not.toContain("\\frac")
    })
  })

  describe("education welcome", () => {
    it("contains education keywords", () => {
      const content = getWelcomeContent("education")
      expect(content).toContain("教育学311")
      expect(content).toContain("教育学原理")
      expect(content).toContain("中外教育史")
      expect(content).toContain("教育心理学")
      expect(content).toContain("教育研究方法")
    })

    it("does not contain math-specific content", () => {
      const content = getWelcomeContent("education")
      expect(content).not.toContain("极限")
      expect(content).not.toContain("线性代数")
      expect(content).not.toContain("夹逼定理")
      expect(content).not.toContain("\\lim")
      expect(content).not.toContain("\\frac")
    })
  })

  describe("psychology welcome", () => {
    it("contains psychology keywords", () => {
      const content = getWelcomeContent("psychology")
      expect(content).toContain("心理学312")
      expect(content).toContain("普通心理学")
      expect(content).toContain("实验心理学")
      expect(content).toContain("发展心理学")
      expect(content).toContain("统计与测量")
    })

    it("does not contain math-specific content", () => {
      const content = getWelcomeContent("psychology")
      expect(content).not.toContain("极限")
      expect(content).not.toContain("线性代数")
      expect(content).not.toContain("夹逼定理")
      expect(content).not.toContain("\\lim")
      expect(content).not.toContain("\\frac")
    })
  })

  describe("lawmaster welcome", () => {
    it("contains lawmaster keywords", () => {
      const content = getWelcomeContent("lawmaster")
      expect(content).toContain("法律硕士")
      expect(content).toContain("民法")
      expect(content).toContain("刑法")
      expect(content).toContain("法理学")
      expect(content).toContain("案例分析")
    })

    it("does not contain math-specific content", () => {
      const content = getWelcomeContent("lawmaster")
      expect(content).not.toContain("极限")
      expect(content).not.toContain("线性代数")
      expect(content).not.toContain("夹逼定理")
      expect(content).not.toContain("\\lim")
      expect(content).not.toContain("\\frac")
    })
  })

  describe("all subjects have welcome messages", () => {
    const subjects = ["math", "cs408", "physics", "english", "programming", "politics", "management", "education", "psychology", "lawmaster", "xingce", "shenlun"] as const

    for (const subject of subjects) {
      it(`${subject} has a non-empty welcome message`, () => {
        const content = getWelcomeContent(subject)
        expect(content.length).toBeGreaterThan(50)
        expect(content).toContain("TeacherAgent")
      })
    }
  })

  describe("unknown subject fallback", () => {
    it("uses generic template instead of math for unknown subject", () => {
      const content = getWelcomeContent("unknown" as any)
      const mathContent = getWelcomeContent("math")
      expect(content).not.toBe(mathContent)
      expect(content).toContain("各学科")
      expect(content).not.toContain("极限")
      expect(content).not.toContain("线性代数")
      expect(content).not.toContain("夹逼定理")
    })

    it("generic template mentions importing materials", () => {
      const content = getWelcomeContent("unknown" as any)
      expect(content).toContain("导入自己的大纲或讲义")
    })
  })

  describe("createWelcomeMessages", () => {
    it("returns an array with one tutor message", () => {
      const messages = createWelcomeMessages("politics")
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe("tutor")
      expect(messages[0].id).toBe("welcome")
    })
  })
})
