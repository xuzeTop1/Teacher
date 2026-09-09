import DOMPurify, { type Config } from "dompurify"
import MarkdownIt from "markdown-it"
import katex from "katex"
import type { HighlighterCore } from "shiki/core"

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true
})

const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "s", "blockquote", "ul", "ol", "li", "a",
    "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table",
    "thead", "tbody", "tr", "th", "td", "div", "span", "details", "summary",
    "i", "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "ms",
    "mtext", "mspace", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
    "mover", "munder", "munderover", "mtable", "mtr", "mtd", "mpadded",
    "mphantom"
  ],
  ALLOWED_ATTR: [
    "class", "href", "title", "target", "rel", "open", "style", "aria-hidden",
    "xmlns", "encoding"
  ],
  FORBID_TAGS: [
    "script", "svg", "iframe", "object", "embed", "form", "input", "button",
    "textarea", "select", "meta", "link", "base", "style", "video", "audio"
  ],
  FORBID_ATTR: ["srcdoc"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[#/]|\.{0,2}\/)/i
}

let highlighterPromise: Promise<HighlighterCore> | undefined

interface Placeholder {
  token: string
  html: string
  block: boolean
}

interface CodeBlock {
  token: string
  code: string
  lang: string
}

export async function renderMessageContent(content: string, options?: { streaming?: boolean }): Promise<string> {
  const placeholders: Placeholder[] = []
  const codeBlocks: CodeBlock[] = []
  const streaming = options?.streaming ?? false

  let prepared = content

  const hasThinkStart = prepared.includes("<think>")
  const hasThinkEnd = prepared.includes("</think>")
  if (streaming && hasThinkStart && !hasThinkEnd) {
    prepared += "\n</think>"
  }

  prepared = prepared.replace(/<think>/g, "\n\nTA_THINK_START\n\n")
  prepared = prepared.replace(/<\/think>/g, "\n\nTA_THINK_END\n\n")

  prepared = extractCodeBlocks(prepared, codeBlocks, streaming)
  prepared = extractMathBlocks(prepared, placeholders, streaming)
  prepared = extractInlineMath(prepared, placeholders)

  for (const block of codeBlocks) {
    placeholders.push({
      token: block.token,
      html: await renderCodeBlock(block.code, block.lang),
      block: true
    })
  }

  let html = markdown.render(prepared)

  for (const item of placeholders) {
    html = replacePlaceholder(html, item)
  }

  const isStreamingThink = streaming && hasThinkStart && !hasThinkEnd
  const thinkTitle = isStreamingThink ? "正在思考..." : "思考已完成"
  const thinkState = isStreamingThink ? "open" : ""
  
  const startHtml = `<div class="thinking-block-container"><details class="thinking-details" ${thinkState}><summary class="thinking-summary"><i class="mdi mdi-lightbulb-outline"></i> <span class="thinking-title-text">${thinkTitle}</span></summary><div class="thinking-content">`
  const endHtml = `</div></details></div>`

  html = html.replace(/<p>TA_THINK_START<\/p>/g, startHtml)
  html = html.replace(/TA_THINK_START/g, startHtml)
  
  html = html.replace(/<p>TA_THINK_END<\/p>/g, endHtml)
  html = html.replace(/TA_THINK_END/g, endHtml)

  return sanitizeRenderedHtml(html)
}

export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

function extractCodeBlocks(content: string, codeBlocks: CodeBlock[], streaming: boolean): string {
  let result = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang: string | undefined, code: string) => {
    const token = createToken("code", codeBlocks.length)
    codeBlocks.push({
      token,
      code,
      lang: lang || "text"
    })
    return `\n${token}\n`
  })

  if (streaming) {
    result = result.replace(/```(\w+)?\n([\s\S]+)$/g, (_match, lang: string | undefined, code: string) => {
      const token = createToken("code", codeBlocks.length)
      codeBlocks.push({
        token,
        code,
        lang: lang || "text"
      })
      return `\n${token}\n`
    })
  }

  return result
}

function extractMathBlocks(content: string, placeholders: Placeholder[], streaming: boolean): string {
  let result = content.replace(/\$\$([\s\S]+?)\$\$/g, (_match, source: string) => {
    const token = createToken("math_block", placeholders.length)
    placeholders.push({
      token,
      html: renderMath(source, true),
      block: true
    })
    return `\n${token}\n`
  })

  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_match, source: string) => {
    const token = createToken("math_block", placeholders.length)
    placeholders.push({
      token,
      html: renderMath(source, true),
      block: true
    })
    return `\n${token}\n`
  })

  if (streaming) {
    result = result.replace(/\$\$([\s\S]+)$/g, (_match, source: string) => {
      const token = createToken("math_block", placeholders.length)
      placeholders.push({
        token,
        html: renderMath(source, true),
        block: true
      })
      return `\n${token}\n`
    })
  }

  return result
}

function extractInlineMath(content: string, placeholders: Placeholder[]): string {
  let result = content.replace(/\\\((.+?)\\\)/g, (_match, source: string) => {
    const token = createToken("math_inline", placeholders.length)
    placeholders.push({
      token,
      html: renderMath(source, false),
      block: false
    })
    return token
  })

  result = result.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_match, prefix: string, source: string) => {
    const token = createToken("math_inline", placeholders.length)
    placeholders.push({
      token,
      html: renderMath(source, false),
      block: false
    })
    return `${prefix}${token}`
  })

  return result
}

function renderMath(source: string, displayMode: boolean): string {
  return katex.renderToString(source.trim(), {
    displayMode,
    throwOnError: false,
    strict: "warn",
    trust: false
  })
}

async function renderCodeBlock(code: string, lang: string): Promise<string> {
  const normalizedLang = normalizeLang(lang)

  if (!normalizedLang) {
    return `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`
  }

  try {
    const highlighter = await getHighlighter()
    return highlighter.codeToHtml(code.trimEnd(), {
      lang: normalizedLang,
      theme: "github-light"
    })
  } catch {
    return `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`
  }
}

async function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createLazyHighlighter()

  return highlighterPromise
}

async function createLazyHighlighter(): Promise<HighlighterCore> {
  const [
    { createHighlighterCore },
    { createJavaScriptRegexEngine },
    { default: githubLight },
    { default: typescript },
    { default: javascript },
    { default: python },
    { default: shellscript }
  ] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-light.mjs"),
    import("shiki/langs/typescript.mjs"),
    import("shiki/langs/javascript.mjs"),
    import("shiki/langs/python.mjs"),
    import("shiki/langs/shellscript.mjs")
  ])

  return createHighlighterCore({
    themes: [githubLight],
    langs: [typescript, javascript, python, shellscript],
    engine: createJavaScriptRegexEngine()
  })
}

function normalizeLang(lang: string): "typescript" | "javascript" | "python" | "shellscript" | null {
  const lower = lang.toLowerCase()

  if (["ts", "tsx", "typescript"].includes(lower)) return "typescript"
  if (["js", "jsx", "javascript"].includes(lower)) return "javascript"
  if (["py", "python"].includes(lower)) return "python"
  if (["sh", "shell", "bash", "zsh", "powershell", "shellscript"].includes(lower)) return "shellscript"

  return null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function createToken(kind: string, index: number): string {
  return `TA_RENDER_${kind}_${index}`
}

function replacePlaceholder(html: string, placeholder: Placeholder): string {
  if (placeholder.block) {
    html = html.replaceAll(`<p>${placeholder.token}</p>`, placeholder.html)
  }

  return html.replaceAll(placeholder.token, placeholder.html)
}
