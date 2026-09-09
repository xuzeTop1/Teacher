import { describe, expect, it } from "vitest"
import { validateKnowledgePacks } from "./packValidator"
import type { KnowledgeSeed, QuestionSeed } from "./packLoader"

// Import all knowledge seeds
import mathLimitsKnowledge from "../../../data/knowledge/math-limits.seed.json"
import linearAlgebraKnowledge from "../../../data/knowledge/linear-algebra-basics.seed.json"
import probabilityKnowledge from "../../../data/knowledge/probability-basics.seed.json"
import derivativesKnowledge from "../../../data/knowledge/math-derivatives.seed.json"
import applicationsOfDerivativesKnowledge from "../../../data/knowledge/math-applications-of-derivatives.seed.json"
import indefiniteIntegralsKnowledge from "../../../data/knowledge/math-indefinite-integrals.seed.json"
import definiteIntegralsKnowledge from "../../../data/knowledge/math-definite-integrals.seed.json"
import integralApplicationsKnowledge from "../../../data/knowledge/math-integral-applications.seed.json"
import meanValueTheoremsKnowledge from "../../../data/knowledge/math-mean-value-theorems.seed.json"
import multivariableCalculusKnowledge from "../../../data/knowledge/math-multivariable-calculus.seed.json"
import probabilityDistributionsKnowledge from "../../../data/knowledge/probability-distributions.seed.json"
import linearAlgebraExpandedKnowledge from "../../../data/knowledge/linear-algebra-expanded.seed.json"
import cs408DataStructuresKnowledge from "../../../data/knowledge/cs408-data-structures.seed.json"
import cs408ComputerOrganizationKnowledge from "../../../data/knowledge/cs408-computer-organization.seed.json"
import cs408OperatingSystemsKnowledge from "../../../data/knowledge/cs408-operating-systems.seed.json"
import cs408ComputerNetworksKnowledge from "../../../data/knowledge/cs408-computer-networks.seed.json"
import physicsMechanicsKnowledge from "../../../data/knowledge/physics-mechanics.seed.json"
import physicsElectromagnetismKnowledge from "../../../data/knowledge/physics-electromagnetism.seed.json"
import physicsThermodynamicsKnowledge from "../../../data/knowledge/physics-thermodynamics.seed.json"
import physicsWavesOpticsKnowledge from "../../../data/knowledge/physics-waves-optics.seed.json"
import physicsModernKnowledge from "../../../data/knowledge/physics-modern.seed.json"
import englishGrammarKnowledge from "../../../data/knowledge/english-grammar.seed.json"
import englishReadingKnowledge from "../../../data/knowledge/english-reading.seed.json"
import englishTranslationKnowledge from "../../../data/knowledge/english-translation.seed.json"
import englishClozeKnowledge from "../../../data/knowledge/english-cloze.seed.json"
import politicsMarxismKnowledge from "../../../data/knowledge/politics-marxism.seed.json"
import politicsMaoismKnowledge from "../../../data/knowledge/politics-maoism.seed.json"
import politicsHistoryKnowledge from "../../../data/knowledge/politics-history.seed.json"
import politicsMoralsKnowledge from "../../../data/knowledge/politics-morals.seed.json"

// Import all question seeds
import mathLimitsQuestions from "../../../data/questions/math-limits.seed.json"
import linearAlgebraQuestions from "../../../data/questions/linear-algebra-basics.seed.json"
import probabilityQuestions from "../../../data/questions/probability-basics.seed.json"
import derivativesQuestions from "../../../data/questions/math-derivatives.seed.json"
import applicationsOfDerivativesQuestions from "../../../data/questions/math-applications-of-derivatives.seed.json"
import indefiniteIntegralsQuestions from "../../../data/questions/math-indefinite-integrals.seed.json"
import definiteIntegralsQuestions from "../../../data/questions/math-definite-integrals.seed.json"
import integralApplicationsQuestions from "../../../data/questions/math-integral-applications.seed.json"
import meanValueTheoremsQuestions from "../../../data/questions/math-mean-value-theorems.seed.json"
import multivariableCalculusQuestions from "../../../data/questions/math-multivariable-calculus.seed.json"
import probabilityDistributionsQuestions from "../../../data/questions/probability-distributions.seed.json"
import linearAlgebraExpandedQuestions from "../../../data/questions/linear-algebra-expanded.seed.json"
import cs408DataStructuresQuestions from "../../../data/questions/cs408-data-structures.seed.json"
import cs408ComputerOrganizationQuestions from "../../../data/questions/cs408-computer-organization.seed.json"
import cs408OperatingSystemsQuestions from "../../../data/questions/cs408-operating-systems.seed.json"
import cs408ComputerNetworksQuestions from "../../../data/questions/cs408-computer-networks.seed.json"
import physicsMechanicsQuestions from "../../../data/questions/physics-mechanics.seed.json"
import physicsElectromagnetismQuestions from "../../../data/questions/physics-electromagnetism.seed.json"
import physicsThermodynamicsQuestions from "../../../data/questions/physics-thermodynamics.seed.json"
import physicsWavesOpticsQuestions from "../../../data/questions/physics-waves-optics.seed.json"
import physicsModernQuestions from "../../../data/questions/physics-modern.seed.json"
import englishGrammarQuestions from "../../../data/questions/english-grammar.seed.json"
import englishReadingQuestions from "../../../data/questions/english-reading.seed.json"
import englishTranslationQuestions from "../../../data/questions/english-translation.seed.json"
import englishClozeQuestions from "../../../data/questions/english-cloze.seed.json"
import politicsMarxismQuestions from "../../../data/questions/politics-marxism.seed.json"
import politicsMaoismQuestions from "../../../data/questions/politics-maoism.seed.json"
import politicsHistoryQuestions from "../../../data/questions/politics-history.seed.json"
import politicsMoralsQuestions from "../../../data/questions/politics-morals.seed.json"
import managementMathKnowledge from "../../../data/knowledge/management-math.seed.json"
import managementLogicKnowledge from "../../../data/knowledge/management-logic.seed.json"
import managementWritingKnowledge from "../../../data/knowledge/management-writing.seed.json"
import educationPedagogyKnowledge from "../../../data/knowledge/education-pedagogy.seed.json"
import educationPsychologyKnowledge from "../../../data/knowledge/education-psychology.seed.json"
import educationHistoryKnowledge from "../../../data/knowledge/education-history.seed.json"
import psychologyGeneralKnowledge from "../../../data/knowledge/psychology-general.seed.json"
import psychologyExperimentalKnowledge from "../../../data/knowledge/psychology-experimental.seed.json"
import psychologyDevelopmentalKnowledge from "../../../data/knowledge/psychology-developmental.seed.json"
import lawmasterCivilKnowledge from "../../../data/knowledge/lawmaster-civil.seed.json"
import lawmasterCriminalKnowledge from "../../../data/knowledge/lawmaster-criminal.seed.json"
import lawmasterJurisprudenceKnowledge from "../../../data/knowledge/lawmaster-jurisprudence.seed.json"

// Import all question seeds
import managementMathQuestions from "../../../data/questions/management-math.seed.json"
import managementLogicQuestions from "../../../data/questions/management-logic.seed.json"
import managementWritingQuestions from "../../../data/questions/management-writing.seed.json"
import educationPedagogyQuestions from "../../../data/questions/education-pedagogy.seed.json"
import educationPsychologyQuestions from "../../../data/questions/education-psychology.seed.json"
import educationHistoryQuestions from "../../../data/questions/education-history.seed.json"
import psychologyGeneralQuestions from "../../../data/questions/psychology-general.seed.json"
import psychologyExperimentalQuestions from "../../../data/questions/psychology-experimental.seed.json"
import psychologyDevelopmentalQuestions from "../../../data/questions/psychology-developmental.seed.json"
import lawmasterCivilQuestions from "../../../data/questions/lawmaster-civil.seed.json"
import lawmasterCriminalQuestions from "../../../data/questions/lawmaster-criminal.seed.json"
import lawmasterJurisprudenceQuestions from "../../../data/questions/lawmaster-jurisprudence.seed.json"

// Import civil service seeds
import civilVerbalKnowledge from "../../../data/knowledge/civil-verbal.seed.json"
import civilLogicKnowledge from "../../../data/knowledge/civil-logic.seed.json"
import civilDataAnalysisKnowledge from "../../../data/knowledge/civil-data-analysis.seed.json"
import civilQuantKnowledge from "../../../data/knowledge/civil-quant.seed.json"
import civilCommonSenseKnowledge from "../../../data/knowledge/civil-common-sense.seed.json"
import civilShenlunSummaryKnowledge from "../../../data/knowledge/civil-shenlun-summary.seed.json"
import civilShenlunArgumentKnowledge from "../../../data/knowledge/civil-shenlun-argument.seed.json"
import civilShenlunImplementationKnowledge from "../../../data/knowledge/civil-shenlun-implementation.seed.json"
import civilShenlunWritingKnowledge from "../../../data/knowledge/civil-shenlun-writing.seed.json"
import civilVerbalQuestions from "../../../data/questions/civil-verbal.seed.json"
import civilLogicQuestions from "../../../data/questions/civil-logic.seed.json"
import civilDataAnalysisQuestions from "../../../data/questions/civil-data-analysis.seed.json"
import civilQuantQuestions from "../../../data/questions/civil-quant.seed.json"
import civilCommonSenseQuestions from "../../../data/questions/civil-common-sense.seed.json"
import civilShenlunSummaryQuestions from "../../../data/questions/civil-shenlun-summary.seed.json"
import civilShenlunArgumentQuestions from "../../../data/questions/civil-shenlun-argument.seed.json"
import civilShenlunImplementationQuestions from "../../../data/questions/civil-shenlun-implementation.seed.json"
import civilShenlunWritingQuestions from "../../../data/questions/civil-shenlun-writing.seed.json"

// Import programming seeds
import pythonBasicsKnowledge from "../../../data/knowledge/python-basics.seed.json"
import pythonBasicsQuestions from "../../../data/questions/python-basics.seed.json"

const KNOWLEDGE_SEEDS: KnowledgeSeed[] = [
  withPackId(mathLimitsKnowledge as KnowledgeSeed, "math-limits"),
  withPackId(linearAlgebraKnowledge as KnowledgeSeed, "linear-algebra-basics"),
  withPackId(probabilityKnowledge as KnowledgeSeed, "probability-basics"),
  withPackId(derivativesKnowledge as KnowledgeSeed, "math-derivatives"),
  withPackId(applicationsOfDerivativesKnowledge as KnowledgeSeed, "math-applications-of-derivatives"),
  withPackId(indefiniteIntegralsKnowledge as KnowledgeSeed, "math-indefinite-integrals"),
  withPackId(definiteIntegralsKnowledge as KnowledgeSeed, "math-definite-integrals"),
  withPackId(integralApplicationsKnowledge as KnowledgeSeed, "math-integral-applications"),
  withPackId(meanValueTheoremsKnowledge as KnowledgeSeed, "math-mean-value-theorems"),
  withPackId(multivariableCalculusKnowledge as KnowledgeSeed, "math-multivariable-calculus"),
  withPackId(probabilityDistributionsKnowledge as KnowledgeSeed, "probability-distributions"),
  withPackId(linearAlgebraExpandedKnowledge as KnowledgeSeed, "linear-algebra-expanded"),
  withPackId(cs408DataStructuresKnowledge as KnowledgeSeed, "cs408-data-structures"),
  withPackId(cs408ComputerOrganizationKnowledge as KnowledgeSeed, "cs408-computer-organization"),
  withPackId(cs408OperatingSystemsKnowledge as KnowledgeSeed, "cs408-operating-systems"),
  withPackId(cs408ComputerNetworksKnowledge as KnowledgeSeed, "cs408-computer-networks"),
  withPackId(physicsMechanicsKnowledge as KnowledgeSeed, "physics-mechanics"),
  withPackId(physicsElectromagnetismKnowledge as KnowledgeSeed, "physics-electromagnetism"),
  withPackId(physicsThermodynamicsKnowledge as KnowledgeSeed, "physics-thermodynamics"),
  withPackId(physicsWavesOpticsKnowledge as KnowledgeSeed, "physics-waves-optics"),
  withPackId(physicsModernKnowledge as KnowledgeSeed, "physics-modern"),
  withPackId(englishGrammarKnowledge as KnowledgeSeed, "english-grammar"),
  withPackId(englishReadingKnowledge as KnowledgeSeed, "english-reading"),
  withPackId(englishTranslationKnowledge as KnowledgeSeed, "english-translation"),
  withPackId(englishClozeKnowledge as KnowledgeSeed, "english-cloze"),
  withPackId(politicsMarxismKnowledge as KnowledgeSeed, "politics-marxism"),
  withPackId(politicsMaoismKnowledge as KnowledgeSeed, "politics-maoism"),
  withPackId(politicsHistoryKnowledge as KnowledgeSeed, "politics-history"),
  withPackId(politicsMoralsKnowledge as KnowledgeSeed, "politics-morals"),
  withPackId(managementMathKnowledge as KnowledgeSeed, "management-math"),
  withPackId(managementLogicKnowledge as KnowledgeSeed, "management-logic"),
  withPackId(managementWritingKnowledge as KnowledgeSeed, "management-writing"),
  withPackId(educationPedagogyKnowledge as KnowledgeSeed, "education-pedagogy"),
  withPackId(educationPsychologyKnowledge as KnowledgeSeed, "education-psychology"),
  withPackId(educationHistoryKnowledge as KnowledgeSeed, "education-history"),
  withPackId(psychologyGeneralKnowledge as KnowledgeSeed, "psychology-general"),
  withPackId(psychologyExperimentalKnowledge as KnowledgeSeed, "psychology-experimental"),
  withPackId(psychologyDevelopmentalKnowledge as KnowledgeSeed, "psychology-developmental"),
  withPackId(lawmasterCivilKnowledge as KnowledgeSeed, "lawmaster-civil"),
  withPackId(lawmasterCriminalKnowledge as KnowledgeSeed, "lawmaster-criminal"),
  withPackId(lawmasterJurisprudenceKnowledge as KnowledgeSeed, "lawmaster-jurisprudence"),
  withPackId(civilVerbalKnowledge as KnowledgeSeed, "civil-verbal"),
  withPackId(civilLogicKnowledge as KnowledgeSeed, "civil-logic"),
  withPackId(civilDataAnalysisKnowledge as KnowledgeSeed, "civil-data-analysis"),
  withPackId(civilQuantKnowledge as KnowledgeSeed, "civil-quant"),
  withPackId(civilCommonSenseKnowledge as KnowledgeSeed, "civil-common-sense"),
  withPackId(civilShenlunSummaryKnowledge as KnowledgeSeed, "civil-shenlun-summary"),
  withPackId(civilShenlunArgumentKnowledge as KnowledgeSeed, "civil-shenlun-argument"),
  withPackId(civilShenlunImplementationKnowledge as KnowledgeSeed, "civil-shenlun-implementation"),
  withPackId(civilShenlunWritingKnowledge as KnowledgeSeed, "civil-shenlun-writing"),
  withPackId(pythonBasicsKnowledge as KnowledgeSeed, "python-basics"),
]

const QUESTION_SEEDS: QuestionSeed[] = [
  withPackId(mathLimitsQuestions as QuestionSeed, "math-limits"),
  withPackId(linearAlgebraQuestions as QuestionSeed, "linear-algebra-basics"),
  withPackId(probabilityQuestions as QuestionSeed, "probability-basics"),
  withPackId(derivativesQuestions as QuestionSeed, "math-derivatives"),
  withPackId(applicationsOfDerivativesQuestions as QuestionSeed, "math-applications-of-derivatives"),
  withPackId(indefiniteIntegralsQuestions as QuestionSeed, "math-indefinite-integrals"),
  withPackId(definiteIntegralsQuestions as QuestionSeed, "math-definite-integrals"),
  withPackId(integralApplicationsQuestions as QuestionSeed, "math-integral-applications"),
  withPackId(meanValueTheoremsQuestions as QuestionSeed, "math-mean-value-theorems"),
  withPackId(multivariableCalculusQuestions as QuestionSeed, "math-multivariable-calculus"),
  withPackId(probabilityDistributionsQuestions as QuestionSeed, "probability-distributions"),
  withPackId(linearAlgebraExpandedQuestions as QuestionSeed, "linear-algebra-expanded"),
  withPackId(cs408DataStructuresQuestions as QuestionSeed, "cs408-data-structures"),
  withPackId(cs408ComputerOrganizationQuestions as QuestionSeed, "cs408-computer-organization"),
  withPackId(cs408OperatingSystemsQuestions as QuestionSeed, "cs408-operating-systems"),
  withPackId(cs408ComputerNetworksQuestions as QuestionSeed, "cs408-computer-networks"),
  withPackId(physicsMechanicsQuestions as QuestionSeed, "physics-mechanics"),
  withPackId(physicsElectromagnetismQuestions as QuestionSeed, "physics-electromagnetism"),
  withPackId(physicsThermodynamicsQuestions as QuestionSeed, "physics-thermodynamics"),
  withPackId(physicsWavesOpticsQuestions as QuestionSeed, "physics-waves-optics"),
  withPackId(physicsModernQuestions as QuestionSeed, "physics-modern"),
  withPackId(englishGrammarQuestions as QuestionSeed, "english-grammar"),
  withPackId(englishReadingQuestions as QuestionSeed, "english-reading"),
  withPackId(englishTranslationQuestions as QuestionSeed, "english-translation"),
  withPackId(englishClozeQuestions as QuestionSeed, "english-cloze"),
  withPackId(politicsMarxismQuestions as QuestionSeed, "politics-marxism"),
  withPackId(politicsMaoismQuestions as QuestionSeed, "politics-maoism"),
  withPackId(politicsHistoryQuestions as QuestionSeed, "politics-history"),
  withPackId(politicsMoralsQuestions as QuestionSeed, "politics-morals"),
  withPackId(managementMathQuestions as QuestionSeed, "management-math"),
  withPackId(managementLogicQuestions as QuestionSeed, "management-logic"),
  withPackId(managementWritingQuestions as QuestionSeed, "management-writing"),
  withPackId(educationPedagogyQuestions as QuestionSeed, "education-pedagogy"),
  withPackId(educationPsychologyQuestions as QuestionSeed, "education-psychology"),
  withPackId(educationHistoryQuestions as QuestionSeed, "education-history"),
  withPackId(psychologyGeneralQuestions as QuestionSeed, "psychology-general"),
  withPackId(psychologyExperimentalQuestions as QuestionSeed, "psychology-experimental"),
  withPackId(psychologyDevelopmentalQuestions as QuestionSeed, "psychology-developmental"),
  withPackId(lawmasterCivilQuestions as QuestionSeed, "lawmaster-civil"),
  withPackId(lawmasterCriminalQuestions as QuestionSeed, "lawmaster-criminal"),
  withPackId(lawmasterJurisprudenceQuestions as QuestionSeed, "lawmaster-jurisprudence"),
  withPackId(civilVerbalQuestions as QuestionSeed, "civil-verbal"),
  withPackId(civilLogicQuestions as QuestionSeed, "civil-logic"),
  withPackId(civilDataAnalysisQuestions as QuestionSeed, "civil-data-analysis"),
  withPackId(civilQuantQuestions as QuestionSeed, "civil-quant"),
  withPackId(civilCommonSenseQuestions as QuestionSeed, "civil-common-sense"),
  withPackId(civilShenlunSummaryQuestions as QuestionSeed, "civil-shenlun-summary"),
  withPackId(civilShenlunArgumentQuestions as QuestionSeed, "civil-shenlun-argument"),
  withPackId(civilShenlunImplementationQuestions as QuestionSeed, "civil-shenlun-implementation"),
  withPackId(civilShenlunWritingQuestions as QuestionSeed, "civil-shenlun-writing"),
  withPackId(pythonBasicsQuestions as QuestionSeed, "python-basics"),
]

// ── Helpers ──────────────────────────────────────────────────────────────

function withPackId<T extends KnowledgeSeed | QuestionSeed>(seed: T, packId: string): T {
  return { ...seed, __packId: packId }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/** 找到 cs408-data-structures knowledge seed（chapter 与 manifest 匹配，适合做 per-pack 测试） */
function getDsKnowledgeSeed(): KnowledgeSeed {
  return deepClone(cs408DataStructuresKnowledge as KnowledgeSeed)
}

function getDsQuestionSeed(): QuestionSeed {
  return deepClone(cs408DataStructuresQuestions as QuestionSeed)
}

// ── Happy path ───────────────────────────────────────────────────────────

describe("validateKnowledgePacks — happy path", () => {
  it("current 51 packs pass validation", async () => {
    const result = await validateKnowledgePacks(KNOWLEDGE_SEEDS, QUESTION_SEEDS)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("summary: 51 packs, 776 nodes, 766 questions", async () => {
    const result = await validateKnowledgePacks(KNOWLEDGE_SEEDS, QUESTION_SEEDS)
    expect(result.summary.packCount).toBe(51)
    expect(result.summary.nodeCount).toBe(776)
    expect(result.summary.questionCount).toBe(766)
  })

  it("subjectCounts: math=122, cs408=160, physics=41, english=80, politics=80, xingce=25, shenlun=20, programming=8", async () => {
    const result = await validateKnowledgePacks(KNOWLEDGE_SEEDS, QUESTION_SEEDS)
    expect(result.summary.subjectCounts["math"]).toBe(122)
    expect(result.summary.subjectCounts["cs408"]).toBe(160)
    expect(result.summary.subjectCounts["physics"]).toBe(41)
    expect(result.summary.subjectCounts["english"]).toBe(80)
    expect(result.summary.subjectCounts["politics"]).toBe(80)
    expect(result.summary.subjectCounts["management"]).toBe(60)
    expect(result.summary.subjectCounts["education"]).toBe(60)
    expect(result.summary.subjectCounts["psychology"]).toBe(60)
    expect(result.summary.subjectCounts["lawmaster"]).toBe(60)
    expect(result.summary.subjectCounts["xingce"]).toBe(25)
    expect(result.summary.subjectCounts["shenlun"]).toBe(20)
    expect(result.summary.subjectCounts["programming"]).toBe(8)
  })
})

// ── Per-pack count mismatch ──────────────────────────────────────────────

describe("validateKnowledgePacks — per-pack count mismatch", () => {
  it("single pack expectedNodeCount mismatch reports PACK_NODE_COUNT_MISMATCH", async () => {
    // Remove one node from cs408-data-structures (expected 40, actual 39)
    const dsSeed = getDsKnowledgeSeed()
    dsSeed.nodes.pop()

    // Only pass the modified seed — other packs will get NOT_FOUND errors, that's fine
    const kSeeds = [dsSeed]
    const qSeeds = QUESTION_SEEDS

    const result = await validateKnowledgePacks(kSeeds, qSeeds)
    const nodeErrors = result.errors.filter((e) => e.code === "PACK_NODE_COUNT_MISMATCH")
    expect(nodeErrors.length).toBeGreaterThanOrEqual(1)
    expect(nodeErrors[0].message).toContain("cs408-data-structures")
    expect(nodeErrors[0].message).toContain("40")
    expect(nodeErrors[0].message).toContain("39")
  })

  it("single pack expectedQuestionCount mismatch reports PACK_QUESTION_COUNT_MISMATCH", async () => {
    // Remove one question from cs408-data-structures (expected 40, actual 39)
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions.pop()

    const kSeeds = [getDsKnowledgeSeed()]
    const qSeeds = [dsSeed]

    const result = await validateKnowledgePacks(kSeeds, qSeeds)
    const qErrors = result.errors.filter((e) => e.code === "PACK_QUESTION_COUNT_MISMATCH")
    expect(qErrors.length).toBeGreaterThanOrEqual(1)
    expect(qErrors[0].message).toContain("cs408-data-structures")
    expect(qErrors[0].message).toContain("40")
    expect(qErrors[0].message).toContain("39")
  })

  it("chapter mismatch still matches when __packId is correct", async () => {
    const seeds = KNOWLEDGE_SEEDS.map((s) => {
      if (s.__packId === "cs408-data-structures") {
        return { ...s, chapter: "cs408-data-structures-renamed" }
      }
      return s
    })
    const result = await validateKnowledgePacks(seeds, QUESTION_SEEDS)
    const notFoundErrors = result.errors.filter(
      (e) => e.code === "PACK_KNOWLEDGE_SEED_NOT_FOUND" && e.message.includes("cs408-data-structures")
    )
    const orphanWarnings = result.warnings.filter(
      (w) => w.code === "ORPHAN_KNOWLEDGE_SEED" && w.message.includes("cs408-data-structures-renamed")
    )
    expect(notFoundErrors).toEqual([])
    expect(orphanWarnings).toEqual([])
  })

  it("chapter mismatch without __packId reports missing pack seed", async () => {
    const seed = getDsKnowledgeSeed()
    seed.chapter = "cs408-data-structures-renamed"
    delete seed.__packId

    const result = await validateKnowledgePacks([seed], [getDsQuestionSeed()])
    const notFoundErrors = result.errors.filter(
      (e) => e.code === "PACK_KNOWLEDGE_SEED_NOT_FOUND" && e.message.includes("cs408-data-structures")
    )
    const orphanWarnings = result.warnings.filter(
      (w) => w.code === "ORPHAN_KNOWLEDGE_SEED" && w.message.includes("cs408-data-structures-renamed")
    )
    expect(notFoundErrors.length).toBe(1)
    expect(orphanWarnings.length).toBe(1)
  })

  it("missing pack seed reports PACK_KNOWLEDGE_SEED_NOT_FOUND error", async () => {
    // Only pass cs408-ds, all other 50 packs get NOT_FOUND
    const result = await validateKnowledgePacks([getDsKnowledgeSeed()], [getDsQuestionSeed()])
    const notFoundErrors = result.errors.filter((e) => e.code === "PACK_KNOWLEDGE_SEED_NOT_FOUND")
    // 50 packs missing knowledge seed
    expect(notFoundErrors.length).toBe(50)
  })
})

// ── Hint validation ──────────────────────────────────────────────────────

describe("validateKnowledgePacks — hint validation", () => {
  it("knowledge node missing L3 hint reports MISSING_HINTS (count < 3)", async () => {
    const dsSeed = getDsKnowledgeSeed()
    // Remove L3 hint from first node → only 2 hints remain → MISSING_HINTS
    const node = dsSeed.nodes[0]
    node.socraticHints = (node.socraticHints ?? []).filter((h) => h.level !== "L3")

    const result = await validateKnowledgePacks([dsSeed], [getDsQuestionSeed()])
    const hintErrors = result.errors.filter(
      (e) => e.code === "MISSING_HINTS" && e.message.includes(node.id)
    )
    expect(hintErrors.length).toBe(1)
  })

  it("knowledge node with 3 hints but no L3 reports INCOMPLETE_HINT_LEVELS", async () => {
    const dsSeed = getDsKnowledgeSeed()
    const node = dsSeed.nodes[0]
    // Replace hints: keep L1, L2, add duplicate L1 → 3 hints but no L3
    node.socraticHints = [
      { level: "L1", text: "hint1" },
      { level: "L2", text: "hint2" },
      { level: "L1", text: "hint3" },
    ]

    const result = await validateKnowledgePacks([dsSeed], [getDsQuestionSeed()])
    const hintErrors = result.errors.filter(
      (e) => e.code === "INCOMPLETE_HINT_LEVELS" && e.message.includes(node.id)
    )
    expect(hintErrors.length).toBe(1)
  })

  it("question missing L3 hint reports MISSING_HINTS (count < 3)", async () => {
    const dsSeed = getDsQuestionSeed()
    const question = dsSeed.questions[0]
    question.hints = (question.hints ?? []).filter((h) => h.level !== "L3")

    const result = await validateKnowledgePacks([getDsKnowledgeSeed()], [dsSeed])
    const hintErrors = result.errors.filter(
      (e) => e.code === "MISSING_HINTS" && e.message.includes(question.id)
    )
    expect(hintErrors.length).toBe(1)
  })
})

// ── Reference validation ─────────────────────────────────────────────────

describe("validateKnowledgePacks — reference validation", () => {
  it("invalid prerequisite reports INVALID_PREREQUISITE", async () => {
    const dsSeed = getDsKnowledgeSeed()
    dsSeed.nodes[0].prerequisites = ["nonexistent-node-id-xyz"]

    const result = await validateKnowledgePacks([dsSeed], [])
    const prerefErrors = result.errors.filter((e) => e.code === "INVALID_PREREQUISITE")
    expect(prerefErrors.length).toBeGreaterThanOrEqual(1)
    expect(prerefErrors[0].message).toContain("nonexistent-node-id-xyz")
  })

  it("question referencing nonexistent node reports INVALID_NODE_REFERENCE", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].knowledgeNodeIds = ["nonexistent-node-id-xyz"]

    const result = await validateKnowledgePacks([], [dsSeed])
    const refErrors = result.errors.filter((e) => e.code === "INVALID_NODE_REFERENCE")
    expect(refErrors.length).toBeGreaterThanOrEqual(1)
    expect(refErrors[0].message).toContain("nonexistent-node-id-xyz")
  })
})

// ── License validation ───────────────────────────────────────────────────

describe("validateKnowledgePacks — license validation", () => {
  it("question with forbidden license 'proprietary' reports FORBIDDEN_LICENSE", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].source.license = "proprietary"

    const result = await validateKnowledgePacks([], [dsSeed])
    const licenseErrors = result.errors.filter((e) => e.code === "FORBIDDEN_LICENSE")
    expect(licenseErrors.length).toBeGreaterThanOrEqual(1)
    expect(licenseErrors[0].message).toContain("proprietary")
  })

  it("question with missing source reports MISSING_SOURCE", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].source = { title: "", license: "" }

    const result = await validateKnowledgePacks([], [dsSeed])
    const srcErrors = result.errors.filter((e) => e.code === "MISSING_SOURCE")
    expect(srcErrors.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Difficulty validation ────────────────────────────────────────────────

describe("validateKnowledgePacks — difficulty validation", () => {
  it("question difficulty=4 reports INVALID_DIFFICULTY", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].difficulty = 4

    const result = await validateKnowledgePacks([], [dsSeed])
    const diffErrors = result.errors.filter((e) => e.code === "INVALID_DIFFICULTY")
    expect(diffErrors.length).toBeGreaterThanOrEqual(1)
    expect(diffErrors[0].message).toContain("4")
    expect(diffErrors[0].message).toContain("1/2/3")
  })

  it("question difficulty=5 reports INVALID_DIFFICULTY", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].difficulty = 5

    const result = await validateKnowledgePacks([], [dsSeed])
    const diffErrors = result.errors.filter((e) => e.code === "INVALID_DIFFICULTY")
    expect(diffErrors.length).toBeGreaterThanOrEqual(1)
  })

  it("knowledge node difficulty=4 reports INVALID_NODE_DIFFICULTY", async () => {
    const dsSeed = getDsKnowledgeSeed()
    dsSeed.nodes[0].difficulty = 4

    const result = await validateKnowledgePacks([dsSeed], [])
    const diffErrors = result.errors.filter((e) => e.code === "INVALID_NODE_DIFFICULTY")
    expect(diffErrors.length).toBeGreaterThanOrEqual(1)
    expect(diffErrors[0].message).toContain("4")
    expect(diffErrors[0].message).toContain("1/2/3")
  })

  it("knowledge node difficulty=5 reports INVALID_NODE_DIFFICULTY", async () => {
    const dsSeed = getDsKnowledgeSeed()
    dsSeed.nodes[0].difficulty = 5

    const result = await validateKnowledgePacks([dsSeed], [])
    const diffErrors = result.errors.filter((e) => e.code === "INVALID_NODE_DIFFICULTY")
    expect(diffErrors.length).toBeGreaterThanOrEqual(1)
  })

  it("knowledge node without difficulty passes validation", async () => {
    const dsSeed = getDsKnowledgeSeed()
    delete dsSeed.nodes[0].difficulty

    const result = await validateKnowledgePacks([dsSeed], [])
    const diffErrors = result.errors.filter((e) => e.code === "INVALID_NODE_DIFFICULTY")
    expect(diffErrors.length).toBe(0)
  })
})

// ── Question type validation ────────────────────────────────────────────

describe("validateKnowledgePacks — question type validation", () => {
  it("type='proof' reports INVALID_QUESTION_TYPE", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].type = "proof"

    const result = await validateKnowledgePacks([], [dsSeed])
    const typeErrors = result.errors.filter((e) => e.code === "INVALID_QUESTION_TYPE")
    expect(typeErrors.length).toBeGreaterThanOrEqual(1)
    expect(typeErrors[0].message).toContain("proof")
    expect(typeErrors[0].message).toContain("concept_check / solution / diagnostic")
  })

  it("type='single' reports INVALID_QUESTION_TYPE", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].type = "single"

    const result = await validateKnowledgePacks([], [dsSeed])
    const typeErrors = result.errors.filter((e) => e.code === "INVALID_QUESTION_TYPE")
    expect(typeErrors.length).toBeGreaterThanOrEqual(1)
  })

  it("type='multiple_choice' reports INVALID_QUESTION_TYPE", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].type = "multiple_choice"

    const result = await validateKnowledgePacks([], [dsSeed])
    const typeErrors = result.errors.filter((e) => e.code === "INVALID_QUESTION_TYPE")
    expect(typeErrors.length).toBeGreaterThanOrEqual(1)
  })

  it("missing type reports MISSING_QUESTION_TYPE", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].type = ""

    const result = await validateKnowledgePacks([], [dsSeed])
    const typeErrors = result.errors.filter((e) => e.code === "MISSING_QUESTION_TYPE")
    expect(typeErrors.length).toBeGreaterThanOrEqual(1)
  })

  it("type='concept_check' passes validation", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].type = "concept_check"

    const result = await validateKnowledgePacks([], [dsSeed])
    const typeErrors = result.errors.filter(
      (e) => e.code === "INVALID_QUESTION_TYPE" || e.code === "MISSING_QUESTION_TYPE"
    )
    expect(typeErrors.length).toBe(0)
  })

  it("type='solution' passes validation", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].type = "solution"

    const result = await validateKnowledgePacks([], [dsSeed])
    const typeErrors = result.errors.filter(
      (e) => e.code === "INVALID_QUESTION_TYPE" || e.code === "MISSING_QUESTION_TYPE"
    )
    expect(typeErrors.length).toBe(0)
  })

  it("type='diagnostic' passes validation", async () => {
    const dsSeed = getDsQuestionSeed()
    dsSeed.questions[0].type = "diagnostic"

    const result = await validateKnowledgePacks([], [dsSeed])
    const typeErrors = result.errors.filter(
      (e) => e.code === "INVALID_QUESTION_TYPE" || e.code === "MISSING_QUESTION_TYPE"
    )
    expect(typeErrors.length).toBe(0)
  })
})

// ── Status validation ───────────────────────────────────────────────────

describe("validateKnowledgePacks — status validation", () => {
  it("missing status reports MISSING_STATUS error with pack id, not '?'", async () => {
    const dsKnowledge = getDsKnowledgeSeed()
    const dsQuestions = getDsQuestionSeed()
    // Remove status from both seeds
    delete (dsKnowledge as unknown as Record<string, unknown>).status
    delete (dsQuestions as unknown as Record<string, unknown>).status

    const result = await validateKnowledgePacks([dsKnowledge], [dsQuestions])
    const statusErrors = result.errors.filter((e) => e.code === "MISSING_STATUS")
    expect(statusErrors.length).toBe(2) // one knowledge, one question

    // Each error message must contain the pack id, not "?"
    for (const e of statusErrors) {
      expect(e.message).not.toContain("?")
      // Must contain either __packId or subject/chapter
      expect(
        e.message.includes("cs408-data-structures") ||
        e.message.includes("cs408") ||
        e.message.includes("math")
      ).toBe(true)
    }
  })

  it("status='draft' passes without MISSING_STATUS warning", async () => {
    const dsKnowledge = getDsKnowledgeSeed()
    const dsQuestions = getDsQuestionSeed()
    dsKnowledge.status = "draft"
    dsQuestions.status = "draft"

    const result = await validateKnowledgePacks([dsKnowledge], [dsQuestions])
    const statusWarnings = result.warnings.filter((w) => w.code === "MISSING_STATUS")
    expect(statusWarnings.length).toBe(0)
  })

  it("status='approved' passes without MISSING_STATUS warning", async () => {
    const dsKnowledge = getDsKnowledgeSeed()
    const dsQuestions = getDsQuestionSeed()
    dsKnowledge.status = "approved"
    dsQuestions.status = "approved"

    const result = await validateKnowledgePacks([dsKnowledge], [dsQuestions])
    const statusWarnings = result.warnings.filter((w) => w.code === "MISSING_STATUS")
    expect(statusWarnings.length).toBe(0)
  })

  it("invalid status reports INVALID_STATUS error", async () => {
    const dsKnowledge = getDsKnowledgeSeed()
    dsKnowledge.status = "published"

    const result = await validateKnowledgePacks([dsKnowledge], [])
    const statusErrors = result.errors.filter((e) => e.code === "INVALID_STATUS")
    expect(statusErrors.length).toBe(1)
    expect(statusErrors[0].message).toContain("published")
    expect(statusErrors[0].message).not.toContain("?")
  })
})

// ── Approved formula-integrity gate ─────────────────────────────────────

describe("validateKnowledgePacks — approved formula integrity", () => {
  it("rejects decoded double backslashes in approved content", async () => {
    const seed = getDsKnowledgeSeed()
    seed.status = "approved"
    seed.nodes[0].summary = "损坏公式：$\\\\lim_{x\\to0}x$"

    const result = await validateKnowledgePacks([seed], [])
    expect(result.errors.some((error) =>
      error.code === "APPROVED_LATEX_DOUBLE_ESCAPE" &&
      error.message.includes(seed.nodes[0].id)
    )).toBe(true)
  })

  it("rejects digit-splitting fractions in approved content", async () => {
    const seed = getDsQuestionSeed()
    seed.status = "approved"
    seed.questions[0].answer = "$1\\frac{0}{3}2$"

    const result = await validateKnowledgePacks([], [seed])
    expect(result.errors.some((error) =>
      error.code === "APPROVED_LATEX_DIGIT_SPLIT" &&
      error.message.includes(seed.questions[0].id)
    )).toBe(true)
  })

  it("rejects unbalanced TeX braces in approved inline math", async () => {
    const seed = getDsQuestionSeed()
    seed.status = "approved"
    seed.questions[0].answer = "$\\frac{1}{2$"

    const result = await validateKnowledgePacks([], [seed])
    expect(result.errors.some((error) =>
      error.code === "APPROVED_LATEX_UNBALANCED_BRACES" &&
      error.message.includes(seed.questions[0].id)
    )).toBe(true)
  })

  it("rejects parentheses split across an approved fraction", async () => {
    const seed = getDsQuestionSeed()
    seed.status = "approved"
    seed.questions[0].answer = "$\\frac{1)}{(x}$"

    const result = await validateKnowledgePacks([], [seed])
    expect(result.errors.some((error) =>
      error.code === "APPROVED_LATEX_MALFORMED_FRACTION" &&
      error.message.includes(seed.questions[0].id)
    )).toBe(true)
  })

  it("does not apply the release-only formula gate to draft content", async () => {
    const seed = getDsQuestionSeed()
    seed.status = "draft"
    seed.questions[0].answer = "$1\\frac{0}{3}2$"

    const result = await validateKnowledgePacks([], [seed])
    expect(result.errors.some((error) =>
      error.code.startsWith("APPROVED_LATEX_")
    )).toBe(false)
  })
})
