/** Return a short user-safe diagnostic from an IPC/provider error. */
export function sanitizeErrorMessage(error: unknown, fallback = "操作失败，请稍后重试。") {
  const raw = error instanceof Error ? error.message : String(error ?? "")
  if (!raw.trim()) return fallback
  return raw
    .replace(/[A-Za-z]:[\\/][^\s"'<>|*?]+/g, "[本地路径]")
    .replace(/\/(?:Users|home|tmp|var|private|opt)\/[\w./-]+/g, "[本地路径]")
    .replace(/(?:Bearer\s+|api[_-]?key[=:]\s*)[^\s,;]+/gi, "$&[已隐藏]")
    .replace(/https?:\/\/[^\s?#]+\?[^\s]+/gi, "[已隐藏的地址参数]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 360)
}

/** External search result links are data, never executable navigation. */
export function safeExternalHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined
  } catch {
    return undefined
  }
}
