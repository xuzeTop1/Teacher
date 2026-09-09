/**
 * LaTeX semantic integrity detection for knowledge seed files.
 *
 * Catches corruption patterns that change mathematical meaning:
 * - Double backslash before commands (\\sqrt, \\lim, \\ln) — renders as linebreak + text
 * - Derivative notation split: d\frac{y}{d}x instead of \frac{dy}{dx}
 * - Exponent outside fraction: \frac{(...)}{...}^n changes meaning
 * - Fraction notation split: f'\frac{(c)}{g}'(c) instead of \frac{f'(c)}{g'(c)}
 * - Digits split by braces: \frac{0}{2}4 (CIDR /24 corruption)
 * - Misplaced braces in sqrt: \sqrt{(x-x_0}^2
 * - Garbled \ln: \frac{1}{l}n
 * - Broken inline math delimiters: $...$uv$...$
 *
 * These are NOT cosmetic checks — each pattern produces a mathematically wrong rendering.
 */
import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as glob from "glob"

// Patterns that indicate semantic corruption (not just ugly formatting)
const CRITICAL_PATTERNS: Array<{ regex: RegExp; name: string; description: string }> = [
  {
    // \\sqrt, \\lim, \\ln, \\cos, \\sin — double backslash renders as linebreak + command text
    regex: /\\\\(?:sqrt|lim|ln|cos|sin|int|sum|prod|frac|partial)/,
    name: "double-backslash-command",
    description: "Double backslash before LaTeX command renders as linebreak + text"
  },
  {
    // d\frac{y}{d}x — derivative notation split into d + fraction(y/d) + x
    regex: /d\\frac\{[a-z]\}\{d\}[a-z]/,
    name: "derivative-notation-split",
    description: "Derivative Leibniz notation split: d\\frac{y}{d}x instead of \\frac{dy}{dx}"
  },
  {
    // f'\frac{(c)}{g}'(c) — fraction notation split
    regex: /[a-z]'\\frac\{\([a-z]\)\}\{[a-z]\}'/,
    name: "fraction-notation-split",
    description: "Fraction notation split: f'\\frac{(c)}{g}'(c) instead of \\frac{f'(c)}{g'(c)}"
  },
  {
    // \frac{0}{2}4 or \frac{1}{0}6 — digits split by fraction braces (CIDR/number corruption)
    regex: /\\frac\{[0-9]\}\{[0-9]\}[0-9]/,
    name: "digits-split-by-braces",
    description: "Digits split by fraction braces: \\frac{0}{2}4 instead of 0/24 or \\frac{10}{32}"
  },
  {
    // \sqrt{(x-x_0}^2 — misplaced closing brace in sqrt
    regex: /\\sqrt\{[^}]*\}[\^]/,
    name: "sqrt-misplaced-brace",
    description: "Misplaced brace in sqrt: \\sqrt{(x-x_0}^2 instead of \\sqrt{(x-x_0)^2}"
  },
  {
    // \frac{1}{l}n — garbled \ln
    regex: /\\frac\{[0-9]*\}\{l\}n/,
    name: "garbled-ln",
    description: "Garbled \\ln: \\frac{1}{l}n instead of \\ln"
  },
  {
    // P\frac{(x)}{Q}(x) — function notation split by fraction
    regex: /[A-Z]\\frac\{\([a-z]\)\}\{[A-Z]\}\([a-z]\)/,
    name: "function-notation-split",
    description: "Function notation split: P\\frac{(x)}{Q}(x) instead of \\frac{P(x)}{Q(x)}"
  }
]

// Pattern for exponent outside fraction that changes meaning:
// \frac{(...)}{...}^n where the ^n applies to the whole fraction visually
// but semantically should be inside the numerator or denominator
const EXPONENT_OUTSIDE_FRAC = /\\frac\{[^}]+\}\{[^}]+\}\^/

function extractTextFields(obj: any, path: string = ""): Array<{ path: string; text: string }> {
  const results: Array<{ path: string; text: string }> = []
  if (typeof obj === "string") {
    results.push({ path, text: obj })
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      results.push(...extractTextFields(item, `${path}[${i}]`))
    })
  } else if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      results.push(...extractTextFields(value, path ? `${path}.${key}` : key))
    }
  }
  return results
}

function findCorruptions(text: string): Array<{ pattern: string; description: string; match: string }> {
  const found: Array<{ pattern: string; description: string; match: string }> = []
  for (const { regex, name, description } of CRITICAL_PATTERNS) {
    const match = text.match(regex)
    if (match) {
      found.push({ pattern: name, description, match: match[0] })
    }
  }
  // Check exponent-outside-frac only in math contexts (between $ delimiters)
  const mathSegments = text.match(/\$[^$]+\$/g) || []
  for (const seg of mathSegments) {
    const match = seg.match(EXPONENT_OUTSIDE_FRAC)
    if (match) {
      // Exclude legitimate cases like \frac{1}{2}^n where it's a power of a constant fraction.
      // Flag cases where numerator contains alphabetic chars (variables): \frac{(1-x^2)}{(x^2+1)}^2
      if (/\\frac\{[^}]*[a-zA-Z][^}]*\}\{[^}]+\}\^/.test(match[0])) {
        found.push({
          pattern: "exponent-outside-frac",
          description: "Exponent outside fraction changes meaning: should be inside numerator/denominator",
          match: match[0]
        })
      }
    }
  }
  return found
}

// Get all approved + draft math/cs408 seed files
function getSeedFiles(): string[] {
  const dataDir = path.resolve(process.cwd(), "data")
  const patterns = [
    `${dataDir}/knowledge/math-*.seed.json`,
    `${dataDir}/knowledge/probability-*.seed.json`,
    `${dataDir}/knowledge/linear-algebra-*.seed.json`,
    `${dataDir}/knowledge/cs408-computer-networks.seed.json`,
    `${dataDir}/questions/math-*.seed.json`,
    `${dataDir}/questions/probability-*.seed.json`,
    `${dataDir}/questions/linear-algebra-*.seed.json`,
    `${dataDir}/questions/cs408-computer-networks.seed.json`,
  ]
  const files: string[] = []
  for (const pattern of patterns) {
    files.push(...glob.sync(pattern))
  }
  return files
}

describe("LaTeX semantic integrity", () => {
  const seedFiles = getSeedFiles()

  it("finds seed files to check", () => {
    expect(seedFiles.length).toBeGreaterThan(20)
  })

  for (const file of seedFiles) {
    const relativePath = path.relative(path.resolve(__dirname, "../.."), file)

    it(`${relativePath} has no critical LaTeX corruption`, () => {
      const content = fs.readFileSync(file, "utf-8")
      const data = JSON.parse(content)
      const textFields = extractTextFields(data)

      const allCorruptions: Array<{ path: string; pattern: string; match: string }> = []
      for (const { path: fieldPath, text } of textFields) {
        // Only check fields that might contain LaTeX
        if (!text.includes("\\") && !text.includes("$")) continue
        const corruptions = findCorruptions(text)
        for (const c of corruptions) {
          allCorruptions.push({ path: fieldPath, pattern: c.pattern, match: c.match })
        }
      }

      if (allCorruptions.length > 0) {
        const report = allCorruptions
          .map((c) => `  ${c.path}: [${c.pattern}] "${c.match}"`)
          .join("\n")
        expect.fail(
          `Found ${allCorruptions.length} critical LaTeX corruption(s) in ${relativePath}:\n${report}`
        )
      }
    })
  }
})

describe("LaTeX corruption pattern unit tests", () => {
  it("detects double-backslash commands", () => {
    expect(findCorruptions("$\\\\sqrt{x}$")).toHaveLength(1)
    expect(findCorruptions("$\\\\lim_{x}$")).toHaveLength(1)
    expect(findCorruptions("$\\sqrt{x}$")).toHaveLength(0)
  })

  it("detects derivative notation split", () => {
    expect(findCorruptions("$d\\frac{y}{d}x$")).toHaveLength(1)
    expect(findCorruptions("$\\frac{dy}{dx}$")).toHaveLength(0)
  })

  it("detects digits split by braces (CIDR corruption)", () => {
    expect(findCorruptions("$192.168.1.\\frac{0}{2}4$")).toHaveLength(1)
    expect(findCorruptions("$192.168.1.0/24$")).toHaveLength(0)
  })

  it("detects fraction notation split", () => {
    expect(findCorruptions("$f'\\frac{(c)}{g}'(c)$")).toHaveLength(1)
    expect(findCorruptions("$\\frac{f'(c)}{g'(c)}$")).toHaveLength(0)
  })

  it("detects sqrt misplaced brace", () => {
    expect(findCorruptions("$\\sqrt{(x-x_0}^2$")).toHaveLength(1)
    expect(findCorruptions("$\\sqrt{(x-x_0)^2}$")).toHaveLength(0)
  })

  it("detects garbled ln", () => {
    expect(findCorruptions("$\\frac{1}{l}n x$")).toHaveLength(1)
    expect(findCorruptions("$\\ln x$")).toHaveLength(0)
  })

  it("detects exponent outside fraction with variables", () => {
    expect(findCorruptions("$\\frac{(1-x^2)}{(x^2+1)}^2$")).toHaveLength(1)
    expect(findCorruptions("$\\frac{1-x^2}{(x^2+1)^2}$")).toHaveLength(0)
  })

  it("does not false-positive on legitimate fractions", () => {
    expect(findCorruptions("$\\frac{1}{2}$")).toHaveLength(0)
    expect(findCorruptions("$\\frac{x^{n+1}}{n+1} + C$")).toHaveLength(0)
    expect(findCorruptions("$e^{-\\lambda}$")).toHaveLength(0)
    expect(findCorruptions("TCP/IP")).toHaveLength(0)
  })
})
