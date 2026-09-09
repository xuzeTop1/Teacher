// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { renderMessageContent, sanitizeRenderedHtml } from "./messageRenderer"

describe("message renderer XSS hardening", () => {
  it("removes scripts, event handlers, and SVG payloads", () => {
    const cleaned = sanitizeRenderedHtml(
      '<script>alert(1)</script><svg><g onload="alert(2)"></g></svg><p onclick="alert(3)">safe</p>'
    )
    expect(cleaned).not.toMatch(/script|svg|onload|onclick/i)
    expect(cleaned).toContain("<p>safe</p>")
  })

  it("removes javascript URLs and active embedded content", () => {
    const cleaned = sanitizeRenderedHtml(
      '<a href="javascript:alert(1)">bad</a><iframe src="https://evil.test"></iframe>' +
      '<object data="https://evil.test"></object><embed src="https://evil.test">'
    )
    expect(cleaned).not.toMatch(/javascript:|iframe|object|embed/i)
    expect(cleaned).toContain(">bad</a>")
  })

  it("keeps safe markdown links and escaped code blocks", async () => {
    const rendered = await renderMessageContent(
      '[OpenAI](https://openai.com)\n\n```html\n<script>alert(1)</script>\n```'
    )
    expect(rendered).toContain('href="https://openai.com"')
    expect(rendered).not.toContain("<script>")
    expect(rendered).toContain("&lt;script&gt;")
  })

  it("keeps KaTeX output while removing active markup", async () => {
    const rendered = await renderMessageContent("$x^2 + 1$")
    expect(rendered).toContain("katex")
    expect(rendered).toContain("<math")
    expect(rendered).not.toMatch(/<script|javascript:|onerror=/i)
  })
})
