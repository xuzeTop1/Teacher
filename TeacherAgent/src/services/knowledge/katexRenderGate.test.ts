/**
 * KaTeX rendering gate test for draft knowledge packs.
 *
 * Renders every $...$ formula found in the 9 audited packs using the same
 * KaTeX configuration as messageRenderer.ts (throwOnError: false, strict: "warn"),
 * but with strict elevated to "error" to catch any formula that would produce
 * a KaTeX warning or error placeholder in the actual UI.
 *
 * Gate criteria:
 * - No formula may produce a katex-error element
 * - No formula may trigger a strict-mode warning (elevated to error here)
 * - Existing latexIntegrity.test.ts regex checks remain as a separate layer
 */
import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import katex from "katex"

// Same config as messageRenderer.ts, but strict elevated to "error"
const KATEX_OPTIONS: katex.KatexOptions = {
  displayMode: false,
  throwOnError: false,
  strict: "error", // Gate: catch anything that would warn in production
  trust: false
}

const DISPLAY_OPTIONS: katex.KatexOptions = {
  ...KATEX_OPTIONS,
  displayMode: true
}

/** Extract all $...$ and $$...$$ formulas from a string */
function extractFormulas(text: string): Array<{ formula: string; display: boolean }> {
  const results: Array<{ formula: string; display: boolean }> = []
  // Match $$...$$ first (display mode)
  const displayRegex = /\$\$([^$]+?)\$\$/g
  let match: RegExpExecArray | null
  while ((match = displayRegex.exec(text)) !== null) {
    results.push({ formula: match[1].trim(), display: true })
  }
  // Then match $...$ (inline), excluding already-matched $$ regions
  const inlineRegex = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g
  while ((match = inlineRegex.exec(text)) !== null) {
    results.push({ formula: match[1].trim(), display: false })
  }
  return results
}

/** Recursively extract all string values from a JSON object */
function extractAllStrings(obj: unknown, path: string = ""): Array<{ path: string; text: string }> {
  const results: Array<{ path: string; text: string }> = []
  if (typeof obj === "string") {
    results.push({ path, text: obj })
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      results.push(...extractAllStrings(item, `${path}[${i}]`))
    })
  } else if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      results.push(...extractAllStrings(value, path ? `${path}.${key}` : key))
    }
  }
  return results
}

/** Render a formula and return any error/warning info */
function renderFormula(formula: string, display: boolean): { ok: boolean; error?: string } {
  try {
    const html = katex.renderToString(formula, display ? DISPLAY_OPTIONS : KATEX_OPTIONS)
    if (html.includes("katex-error")) {
      return { ok: false, error: `KaTeX error placeholder in output for: ${formula}` }
    }
    return { ok: true }
  } catch (e) {
    // strict: "error" throws on warnings
    return { ok: false, error: `KaTeX strict error for "${formula}": ${e instanceof Error ? e.message : String(e)}` }
  }
}

// All 51 approved knowledge packs (excluding draft civil-common-sense)
const AUDITED_PACKS = [
  "civil-common-sense-scope",
  "civil-data-analysis",
  "civil-logic",
  "civil-quant",
  "civil-shenlun-argument",
  "civil-shenlun-implementation",
  "civil-shenlun-summary",
  "civil-shenlun-writing",
  "civil-verbal",
  "cs408-computer-networks",
  "cs408-computer-organization",
  "cs408-data-structures",
  "cs408-operating-systems",
  "education-history",
  "education-pedagogy",
  "education-psychology",
  "english-cloze",
  "english-grammar",
  "english-reading",
  "english-translation",
  "lawmaster-civil",
  "lawmaster-criminal",
  "lawmaster-jurisprudence",
  "linear-algebra-basics",
  "linear-algebra-expanded",
  "management-logic",
  "management-math",
  "management-writing",
  "math-applications-of-derivatives",
  "math-definite-integrals",
  "math-derivatives",
  "math-indefinite-integrals",
  "math-integral-applications",
  "math-limits",
  "math-mean-value-theorems",
  "math-multivariable-calculus",
  "physics-electromagnetism",
  "physics-mechanics",
  "physics-modern",
  "physics-thermodynamics",
  "physics-waves-optics",
  "politics-history",
  "politics-maoism",
  "politics-marxism",
  "politics-morals",
  "probability-basics",
  "probability-distributions",
  "psychology-developmental",
  "psychology-experimental",
  "psychology-general",
  "python-basics",
]

function getPackFiles(): Array<{ packId: string; filePath: string }> {
  const dataDir = path.resolve(process.cwd(), "data")
  const files: Array<{ packId: string; filePath: string }> = []
  for (const packId of AUDITED_PACKS) {
    const kPath = path.join(dataDir, "knowledge", `${packId}.seed.json`)
    const qPath = path.join(dataDir, "questions", `${packId}.seed.json`)
    if (fs.existsSync(kPath)) files.push({ packId, filePath: kPath })
    if (fs.existsSync(qPath)) files.push({ packId, filePath: qPath })
  }
  return files
}

describe("KaTeX rendering gate", () => {
  const packFiles = getPackFiles()

  it("finds all 102 seed files (51 knowledge + 51 questions)", () => {
    expect(packFiles.length).toBe(102)
  })

  for (const { packId, filePath } of packFiles) {
    const relativePath = path.relative(process.cwd(), filePath)
    const isKnowledge = filePath.includes("knowledge")
    const label = `${packId} (${isKnowledge ? "knowledge" : "questions"})`

    it(`${label}: all formulas render without KaTeX errors or strict warnings`, () => {
      const content = fs.readFileSync(filePath, "utf-8")
      const data = JSON.parse(content)
      const allStrings = extractAllStrings(data)

      const failures: Array<{ path: string; formula: string; error: string }> = []

      for (const { path: fieldPath, text } of allStrings) {
        if (!text.includes("$")) continue
        const formulas = extractFormulas(text)
        for (const { formula, display } of formulas) {
          if (!formula) continue
          const result = renderFormula(formula, display)
          if (!result.ok) {
            failures.push({ path: fieldPath, formula, error: result.error! })
          }
        }
      }

      if (failures.length > 0) {
        const report = failures
          .slice(0, 10) // Limit output
          .map((f) => `  ${f.path}: ${f.error}`)
          .join("\n")
        const extra = failures.length > 10 ? `\n  ... and ${failures.length - 10} more` : ""
        expect.fail(
          `Found ${failures.length} KaTeX rendering failure(s) in ${relativePath}:\n${report}${extra}`
        )
      }
    })
  }
})

describe("KaTeX rendering unit tests", () => {
  it("renders simple fraction without error", () => {
    const result = renderFormula("\\frac{1}{2}", false)
    expect(result.ok).toBe(true)
  })

  it("renders derivative notation without error", () => {
    const result = renderFormula("\\frac{dy}{dx}", false)
    expect(result.ok).toBe(true)
  })

  it("renders \\min in exponent with braces without error", () => {
    const result = renderFormula("2^{\\min(i,10)}", false)
    expect(result.ok).toBe(true)
  })

  it("renders \\bar{A} without error", () => {
    const result = renderFormula("P(\\bar{A})", false)
    expect(result.ok).toBe(true)
  })

  it("renders \\% without error", () => {
    const result = renderFormula("16.7\\%", false)
    expect(result.ok).toBe(true)
  })

  it("renders \\sim without error", () => {
    const result = renderFormula("X \\sim N(0,1)", false)
    expect(result.ok).toBe(true)
  })

  it("detects broken formula with unbalanced braces", () => {
    const result = renderFormula("\\frac{1}{", false)
    expect(result.ok).toBe(false)
  })
})

// TeX commands that indicate math content which MUST be inside $...$ delimiters
const BARE_LATEX_PATTERN = /(?<!\$)\\(?:frac|sqrt|int|lim|bar|text|sum|prod|partial|infty|lambda|sigma|mu|alpha|beta|gamma|delta|theta|pi|cos|sin|tan|ln|log|exp|min|max|sim|cdot|times|left|right)(?=[^a-zA-Z]|$)/

/**
 * Check if a string contains TeX commands outside of $...$ or $$...$$ delimiters.
 * Strips all $...$ and $$...$$ regions first, then checks the remainder.
 */
function findBareLatex(text: string): string[] {
  // Remove all $$...$$ and $...$ regions
  const stripped = text.replace(/\$\$[^]*?\$\$/g, "").replace(/\$[^$\n]*?\$/g, "")
  const matches = stripped.match(BARE_LATEX_PATTERN)
  return matches || []
}

describe("Bare LaTeX detection (no $...$ delimiters)", () => {
  const packFiles = getPackFiles()

  // Only check user-visible fields: answer, content, summary, solutionSteps, hints, title, options
  const USER_VISIBLE_FIELDS = ["answer", "content", "summary", "solutionSteps", "socraticHints", "misconceptions", "keyPoints", "title", "options", "hints"]

  for (const { packId, filePath } of packFiles) {
    const relativePath = path.relative(process.cwd(), filePath)
    const isKnowledge = filePath.includes("knowledge")
    const label = `${packId} (${isKnowledge ? "knowledge" : "questions"})`

    it(`${label}: no bare LaTeX commands outside $...$ delimiters`, () => {
      const content = fs.readFileSync(filePath, "utf-8")
      const data = JSON.parse(content)

      const failures: Array<{ path: string; bareCommands: string[] }> = []

      // Recursively scan ALL strings in a subtree (no whitelist filtering)
      function scanAllStrings(obj: unknown, objPath: string) {
        if (typeof obj === "string") {
          const bare = findBareLatex(obj)
          if (bare.length > 0) {
            failures.push({ path: objPath, bareCommands: bare })
          }
        } else if (Array.isArray(obj)) {
          obj.forEach((item, i) => scanAllStrings(item, `${objPath}[${i}]`))
        } else if (obj && typeof obj === "object") {
          for (const [key, value] of Object.entries(obj)) {
            scanAllStrings(value, objPath ? `${objPath}.${key}` : key)
          }
        }
      }

      // Entry point: only enter whitelisted fields, then scan everything within
      function checkObject(obj: unknown, objPath: string) {
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const [key, value] of Object.entries(obj)) {
            if (USER_VISIBLE_FIELDS.some((f) => key === f || key.startsWith(f))) {
              scanAllStrings(value, objPath ? `${objPath}.${key}` : key)
            }
          }
        }
      }

      // Check nodes or questions
      const items = data.nodes || data.questions || []
      items.forEach((item: any, i: number) => {
        checkObject(item, `[${i}](${item.id || "unknown"})`)
      })

      if (failures.length > 0) {
        const report = failures
          .slice(0, 10)
          .map((f) => `  ${f.path}: bare [${f.bareCommands.join(", ")}]`)
          .join("\n")
        const extra = failures.length > 10 ? `\n  ... and ${failures.length - 10} more` : ""
        expect.fail(
          `Found ${failures.length} bare LaTeX command(s) outside $...$ in ${relativePath}:\n${report}${extra}`
        )
      }
    })
  }

  it("regression: bare \\frac{13\\sqrt{13}-8}{27} is detected", () => {
    const bare = findBareLatex("\\frac{13\\sqrt{13}-8}{27}")
    expect(bare.length).toBeGreaterThan(0)
    expect(bare).toContain("\\frac")
  })

  it("does not flag LaTeX properly wrapped in $...$", () => {
    const bare = findBareLatex("答案是 $\\frac{13\\sqrt{13}-8}{27}$")
    expect(bare).toHaveLength(0)
  })

  it("does not flag plain text without LaTeX", () => {
    const bare = findBareLatex("这是一个普通的中文句子，没有数学公式。")
    expect(bare).toHaveLength(0)
  })

  it("detects bare \\sqrt outside delimiters", () => {
    const bare = findBareLatex("结果为 \\sqrt{x^2+1}")
    expect(bare.length).toBeGreaterThan(0)
    expect(bare).toContain("\\sqrt")
  })

  it("regression: scans socraticHints[].text for bare LaTeX", () => {
    // Simulate a node with bare \frac inside socraticHints text
    const mockNode = {
      id: "test-node",
      title: "Test",
      summary: "ok",
      socraticHints: [
        { level: "L1", text: "提示：用 $\\frac{a}{b}$ 公式" },
        { level: "L2", text: "试试 \\frac{x+1}{x-1} 的形式" }  // BARE — no $...$
      ]
    }
    const failures: string[] = []
    for (const hint of mockNode.socraticHints) {
      const bare = findBareLatex(hint.text)
      if (bare.length > 0) failures.push(hint.text)
    }
    // L1 is wrapped in $...$ so should pass; L2 is bare so should fail
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("\\frac{x+1}{x-1}")
  })

  it("regression: scans hints[].text for bare LaTeX", () => {
    const mockQuestion = {
      id: "test-q",
      content: "ok $x^2$",
      answer: "$42$",
      hints: [
        { level: "L1", text: "想想 \\int_0^1 x dx 的值" }  // BARE — no $...$
      ]
    }
    const failures: string[] = []
    for (const hint of mockQuestion.hints) {
      const bare = findBareLatex(hint.text)
      if (bare.length > 0) failures.push(hint.text)
    }
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("\\int")
  })

  it("regression: does not flag socraticHints[].text with proper $...$", () => {
    const hints = [
      { level: "L1", text: "提示：用 $\\frac{a}{b}$ 公式" },
      { level: "L2", text: "试试 $\\frac{x+1}{x-1}$ 的形式" },
      { level: "L3", text: "答案是 $\\frac{13\\sqrt{13}-8}{27}$" }
    ]
    for (const hint of hints) {
      expect(findBareLatex(hint.text)).toHaveLength(0)
    }
  })
})
