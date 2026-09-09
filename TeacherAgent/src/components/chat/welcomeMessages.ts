/**
 * Welcome messages for each subject code.
 * Extracted from ChatView.vue for testability.
 */
import type { SubjectCode } from "../../types/learning"
import type { ChatMessage } from "../../types/chat"

const GENERIC_WELCOME =
  "你好，我是 TeacherAgent，你的 AI 辅导助手。\n\n" +
  "我可以帮你学习各学科内容，支持 **Markdown** 和公式渲染。你也可以导入自己的大纲或讲义，我会优先结合你的本地资料进行引导式辅导。\n\n" +
  "试试问我：\n- 你最想复习哪个章节？\n- 给我一道练习题\n- 帮我安排今天的复习"

const WELCOME_CONTENT: Record<string, string> = {
  math:
    "你好，我是 TeacherAgent，你的 AI 辅导助手。\n\n" +
    "我可以帮你学习数学（极限、线性代数、概率统计），支持 **Markdown**、公式如 $\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$，以及代码块渲染。\n\n" +
    "试试问我：\n- 什么是极限？\n- 给我一道夹逼定理练习\n- 今天我该怎么复习？",
  cs408:
    "你好，我是 TeacherAgent，你的 AI 辅导助手。\n\n" +
    "我可以帮你备考 408（数据结构、组成原理、操作系统、计算机网络），支持 **Markdown**、代码块和公式渲染。\n\n" +
    "试试问我：\n- 什么是 B 树和 B+ 树的区别？\n- 给我一道进程调度练习\n- 今天我该怎么复习数据结构？",
  physics:
    "你好，我是 TeacherAgent，你的 AI 辅导助手。\n\n" +
    "我可以帮你学习大学物理（力学、电磁学、热学、波动光学、近代物理），支持 **Markdown**、公式如 $F=ma$，以及代码块渲染。\n\n" +
    "试试问我：\n- 什么是楞次定律？\n- 给我一道电磁感应练习\n- 今天我该怎么复习力学？",
  english:
    "你好，我是 TeacherAgent，你的 AI 辅导助手。\n\n" +
    "我可以帮你备考考研英语（长难句语法、阅读逻辑、翻译得分点、完形填空），支持 **Markdown** 渲染。\n\n" +
    "试试问我：\n- 非限制性定语从句和限制性有什么区别？\n- 给我一道长难句分析练习\n- 今天我该怎么复习阅读？",
  programming: [
    "你好，我是 TeacherAgent，你的 Python 编程辅导与调试伙伴。",
    "",
    "我可以陪你学习 Python 基础、阅读代码、分析报错、设计测试用例，并通过本机 Python 解释器运行可信练习代码。当前代码执行仅支持 **Python**；聊天区域上方提供独立的「Python 练习台」，可以直接编辑代码、填写标准输入并查看运行结果。",
    "",
    "> 代码执行使用教学护栏，不是安全沙箱。请勿运行来源不明或不可信代码；目标机器需要安装 Python 3.10+。",
    "",
    "试试问我：",
    "- 这段 Python 为什么会报错？",
    "- 带我一步步实现一个二分查找",
    "- 给我一个可以在练习台运行的 Python 小练习"
  ].join("\n"),
  politics: [
    "你好，我是 TeacherAgent，你的 AI 辅导助手。",
    "",
    "我可以帮你复习考研政治（马克思主义基本原理、毛泽东思想和中国特色社会主义理论体系概论、中国近现代史纲要、思想道德与法治），支持 **Markdown** 渲染。你也可以导入自己的大纲或讲义，我会优先结合你的本地资料进行引导式辅导。",
    "",
    "试试问我：",
    "- 马原中「矛盾的普遍性和特殊性」怎么区分？",
    "- 给我一道考研政治选择题练习",
    "- 帮我根据大纲安排今天的复习"
  ].join("\n"),
  management: [
    "你好，我是 TeacherAgent，你的 AI 辅导助手。",
    "",
    "我可以帮你备考管理类联考（逻辑推理、论证有效性分析、论说文、初等数学），支持 **Markdown** 渲染。你也可以导入自己的大纲或讲义，我会优先结合你的本地资料进行引导式辅导。",
    "",
    "试试问我：",
    "- 论证有效性分析的常见逻辑漏洞有哪些？",
    "- 给我一道逻辑推理练习",
    "- 帮我安排今天的写作训练"
  ].join("\n"),
  education: [
    "你好，我是 TeacherAgent，你的 AI 辅导助手。",
    "",
    "我可以帮你备考教育学311（教育学原理、中外教育史、教育心理学、教育研究方法），支持 **Markdown** 渲染。你也可以导入自己的大纲或讲义，我会优先结合你的本地资料进行引导式辅导。",
    "",
    "试试问我：",
    "- 赫尔巴特的「四阶段教学法」是什么？",
    "- 给我一道教育心理学练习",
    "- 帮我安排今天的写作训练"
  ].join("\n"),
  psychology: [
    "你好，我是 TeacherAgent，你的 AI 辅导助手。",
    "",
    "我可以帮你备考心理学312（普通心理学、实验心理学、发展心理学、心理统计与测量），支持 **Markdown** 渲染。你也可以导入自己的大纲或讲义，我会优先结合你的本地资料进行引导式辅导。",
    "",
    "试试问我：",
    "- 什么是经典条件反射和操作性条件反射的区别？",
    "- 给我一道实验设计练习",
    "- 帮我安排今天的统计复习"
  ].join("\n"),
  lawmaster: [
    "你好，我是 TeacherAgent，你的 AI 辅导助手。",
    "",
    "我可以帮你备考法律硕士（民法、刑法、法理学、宪法学、法制史），支持 **Markdown** 渲染。你也可以导入自己的大纲或讲义，我会优先结合你的本地资料进行引导式辅导。",
    "",
    "试试问我：",
    "- 民法中「善意取得」的构成要件是什么？",
    "- 给我一道刑法案例分析练习",
    "- 帮我安排今天的法理学复习"
  ].join("\n"),
  xingce: [
    "你好，我是 TeacherAgent，你的 AI 辅导助手。",
    "",
    "我可以陪你练行测（言语理解、判断推理、资料分析、数量关系、常识判断），支持 **Markdown** 与公式渲染。我们先讲题型、拆步骤、练技巧，而不是直接刷题。",
    "",
    "试试问我：",
    "- 言语理解的逻辑填空怎么找线索？",
    "- 给我一道判断推理的翻译推理练习",
    "- 资料分析的增长率怎么速算？"
  ].join("\n"),
  shenlun: [
    "你好，我是 TeacherAgent，你的 AI 辅导助手。",
    "",
    "我可以陪你练申论（归纳概括、综合分析、提出对策、贯彻执行、大作文），支持 **Markdown** 渲染。我们侧重材料拆解、结构辅导、段落改写与表达优化，不替你直接写完一整篇。",
    "",
    "试试问我：",
    "- 帮我拆一下这段申论材料",
    "- 给我搭一个大作文提纲",
    "- 帮我润色这段申论，去 AI 味"
  ].join("\n")
}

/**
 * Get the welcome message content for a given subject.
 * Falls back to a generic template for unknown subjects.
 */
export function getWelcomeContent(subject: SubjectCode): string {
  return WELCOME_CONTENT[subject] ?? GENERIC_WELCOME
}

/**
 * Create the initial welcome ChatMessage for a given subject.
 */
export function createWelcomeMessages(subject: SubjectCode): ChatMessage[] {
  return [
    {
      id: "welcome",
      role: "tutor" as const,
      content: getWelcomeContent(subject)
    }
  ]
}

