/**
 * 会话标题生成服务
 *
 * 使用 LLM 根据会话内容生成简短标题。
 * fire-and-forget 模式，失败时 fallback 到学生消息截断。
 */

import type { LlmProviderConfig } from "../llm/types"
import { createOpenAICompatibleProvider } from "../llm/openAiCompatibleProvider"

const TITLE_PROMPT = `请根据下面学习对话生成一个 8-18 个中文字符的会话标题。
只输出标题，不要引号，不要解释，不要加句号。
优先概括学生的真实问题或学习主题。
示例：导数定义练习、夹逼定理训练、矩阵求逆复习`

const DEFAULT_TITLE_RE = /默认对话|新对话|临时对话/

export interface TitleGenerationInput {
  messages: Array<{ role: string; content: string }>
  subjectCode: string
  providerConfig?: LlmProviderConfig
}

/**
 * 检查标题是否是需要自动生成的默认标题
 */
export function isDefaultTitle(title: string): boolean {
  return DEFAULT_TITLE_RE.test(title)
}

/**
 * 生成会话标题。
 * 成功返回标题字符串，失败返回 null。
 */
export async function generateConversationTitle(input: TitleGenerationInput): Promise<string | null> {
  const { messages, providerConfig } = input

  if (!providerConfig?.apiKeyRef || !providerConfig?.baseUrl) {
    return fallbackTitle(messages)
  }

  // 取最近 6 条消息作为上下文
  const recentMessages = messages
    .filter((m) => m.role === "student" || m.role === "tutor")
    .slice(-6)
    .map((m) => `${m.role === "student" ? "学生" : "导师"}：${m.content.slice(0, 200)}`)
    .join("\n")

  if (!recentMessages.trim()) {
    return fallbackTitle(messages)
  }

  try {
    const provider = createOpenAICompatibleProvider(providerConfig)
    const result = await provider.complete({
      messages: [
        { role: "system", content: TITLE_PROMPT },
        { role: "user", content: recentMessages }
      ],
      temperature: 0.3,
      maxTokens: 60
    })

    const title = cleanTitle(result.content)
    if (title && title.length >= 4 && title.length <= 30) {
      return title
    }

    return fallbackTitle(messages)
  } catch {
    return fallbackTitle(messages)
  }
}

/**
 * Fallback：取第一条学生消息截断
 */
function fallbackTitle(messages: Array<{ role: string; content: string }>): string | null {
  const firstStudentMessage = messages.find((m) => m.role === "student")
  if (!firstStudentMessage) return null

  return cleanTitle(firstStudentMessage.content).slice(0, 28) || null
}

/**
 * 清理 LLM 输出的标题
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^["'"「『【]|["'"」』】]$/g, "") // 去除引号
    .replace(/^标题[：:]?\s*/i, "") // 去除"标题："前缀
    .replace(/。$/g, "") // 去除末尾句号
    .trim()
}
