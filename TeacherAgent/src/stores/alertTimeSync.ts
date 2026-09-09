/**
 * AlertTime 同步状态与编排（Pinia）。
 *
 * 编排职责：同步服务生命周期、配对二维码、设备管理、读模型加载、周报告、
 * 学科映射、approved 题库诊断、proposal 生成。业务算法在 src/engine/sync/，
 * 传输在 src/services/sync/ 与 Rust 后端；本 store 不做端口/密钥/SQLite 操作。
 */

import { defineStore } from "pinia"
import type {
  CreateProposalInput,
  FirewallDiagnosis,
  LastSnapshotInfo,
  SubjectMapping,
  SyncDeviceInfo,
  SyncPairingInfo,
  SyncProposal,
  SyncReadModel,
  SyncServerStatus
} from "../types/sync"
import {
  createSyncProposal,
  firewallDiagnose,
  getSyncDeviceState,
  listSyncDevices,
  listSyncMappings,
  listSyncProposals,
  listSyncInterfaces,
  newSyncPairing,
  removeSyncMapping,
  revokeSyncDevice,
  setSyncMapping,
  startSyncServer,
  stopSyncServer,
  loadPersistedSyncDiagnosticAssessments,
  syncServerStatus
} from "../services/sync/commands"
import {
  bktUpdateMastery,
  loadStudentKnowledge,
  saveAssessmentResult
} from "../services/tauri/commands"
import { submitPracticeAnswer } from "../services/practice/submitPracticeAnswer"
import { searchLocalQuestionBankLazy } from "../services/questions/localQuestionBankSearch"
import { computeWeeklyReport, type WeeklyReport } from "../engine/sync/weeklyReport"
import { collectApprovedKnowledgeNodeIdsForScope } from "../services/questions/scopedKnowledgeNodeIds"
import {
  canGenerateProposal,
  planProposal,
  type DiagnosticEvidence,
  type ProposalDraft,
  type WeakNode
} from "../engine/sync/proposalPlanner"
import { proposalOutcome, type ProposalOutcome } from "../engine/sync/proposalOutcome"
import {
  buildDiagnosticEvidence,
  collectDiagnosticKnowledgeNodeIds,
  isAnswerCorrect,
  selectDiagnosticQuestions,
  summarizeDiagnostic,
  type DiagnosticAnswerRecord,
  type DiagnosticQuestion,
  type DiagnosticSavedRecord,
  type DiagnosticSummary
} from "../engine/sync/diagnostic"
import { DEFAULT_STUDENT_ID } from "../services/student/memoryService"
import { subjectLabel } from "../utils/subject"

const DIAGNOSTIC_EVIDENCE_KEY = "teacher-agent-alerttime-sync.diagnosticEvidence.v1"
const SELECTED_DEVICE_KEY = "teacher-agent-alerttime-sync.selectedDevice.v1"

export interface DiagnosticSession {
  /** AlertTime 科目 remoteId；诊断证据的主归属键。 */
  alertSubjectRemoteId: string
  teacherSubjectId: string
  /** 考试体系范围（映射到考试体系叶子时非空；出题与反馈展示用） */
  examTrackId?: string | null
  examSubjectId?: string | null
  examModuleId?: string | null
  questions: DiagnosticQuestion[]
  currentIndex: number
  records: DiagnosticAnswerRecord[]
  running: boolean
  summary: DiagnosticSummary | null
  /** 判分用的正确答案（仅内部使用，不用于展示前泄露） */
  answers: string[]
  /** 落库成功的单题记录（evidence 只统计这些题，绝不掺入未持久化答题） */
  savedRecords: DiagnosticSavedRecord[]
  /** BKT + knowledge 更新成功的题数（mastery 确实被更新过） */
  masteryUpdatedCount: number
  /** 诊断结束时是否有任何 assessment 成功持久化（null = 尚未结束） */
  persisted: boolean | null
}

export interface TeacherSubjectOption {
  id: string
  label: string
}

export const useAlertTimeSyncStore = defineStore("alertTimeSync", {
  state: () => ({
    serverStatus: {
      running: false,
      address: null,
      port: null,
      startedAtMs: null,
      certificatePin: null
    } as SyncServerStatus,
    interfaces: [] as string[],
    pairingInfo: null as SyncPairingInfo | null,
    devices: [] as SyncDeviceInfo[],
    selectedDeviceId: null as string | null,
    readModel: null as SyncReadModel | null,
    report: null as WeeklyReport | null,
    lastSnapshot: null as LastSnapshotInfo | null,
    mappings: [] as SubjectMapping[],
    proposals: [] as SyncProposal[],
    proposalOutcomes: {} as Record<string, ProposalOutcome>,
    firewallDiagnosis: null as FirewallDiagnosis | null,
    diagnosticEvidence: loadDiagnosticEvidence(),
    diagnostic: null as DiagnosticSession | null,
    busy: false,
    error: null as string | null,
    // 轮询互斥锁（非 UI 状态，仅防止并发轮询叠加）。
    _polling: false
  }),

  getters: {
    hasSelectedDevice: (state) => state.selectedDeviceId !== null,
    activeProposals: (state) => state.proposals.filter((proposal) => proposal.status === "pending"),
    /** 当前快照附带的分析；展示层仍需通过纯函数做快照 ID 校验。 */
    latestLearningAnalysis: (state) => state.readModel?.latestLearningAnalysis ?? null
  },

  actions: {
    clearError() {
      this.error = null
    },

    async init() {
      try {
        this.serverStatus = await syncServerStatus()
        this.interfaces = await listSyncInterfaces()
        this.devices = await listSyncDevices()
        const remembered = localStorage.getItem(SELECTED_DEVICE_KEY)
        if (remembered && this.devices.some((device) => device.deviceId === remembered)) {
          await this.selectDevice(remembered)
        }
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    async startServer(interfaceLabel: string, port?: number) {
      this.busy = true
      try {
        this.serverStatus = await startSyncServer(interfaceLabel, port)
        this.pairingInfo = null
      } catch (error) {
        this.error = errorMessage(error)
      } finally {
        this.busy = false
      }
    },

    async stopServer() {
      try {
        await stopSyncServer()
        this.serverStatus = {
          running: false,
          address: null,
          port: null,
          startedAtMs: null,
          certificatePin: null
        }
        this.pairingInfo = null
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    async refreshDevices() {
      try {
        this.devices = await listSyncDevices()
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    /** 生成配对二维码（一次性 token 只保存在内存与二维码中）。 */
    async refreshPairing() {
      try {
        this.pairingInfo = await newSyncPairing()
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    clearPairing() {
      // 丢弃内存中的一次性 token（不持久化到任何存储）。
      this.pairingInfo = null
    },

    async revokeDevice(deviceId: string) {
      try {
        await revokeSyncDevice(deviceId)
        await this.refreshDevices()
        if (this.selectedDeviceId === deviceId) {
          this.selectedDeviceId = null
          this.readModel = null
          this.report = null
          this.mappings = []
          this.proposals = []
          this.proposalOutcomes = {}
        }
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    async diagnoseFirewall() {
      try {
        this.firewallDiagnosis = await firewallDiagnose()
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    async selectDevice(deviceId: string) {
      this.selectedDeviceId = deviceId
      localStorage.setItem(SELECTED_DEVICE_KEY, deviceId)
      await this.loadDevice()
    },

    /**
     * 静默轮询：手机同步后数据已写入服务端读模型，但前端不会主动感知。
     * 仅在快照确实变化时才重载全部展示数据，避免无谓重算与 UI 抖动。
     */
    async pollDeviceChanges() {
      const deviceId = this.selectedDeviceId
      if (!deviceId || this._polling) return
      this._polling = true
      try {
        const { lastSnapshot } = await getSyncDeviceState(deviceId)
        if ((lastSnapshot?.snapshotId ?? null) !== (this.lastSnapshot?.snapshotId ?? null)) {
          await this.loadDevice(true)
        }
      } catch {
        // 短暂网络/服务波动时静默跳过，不打断用户；下一轮会重试。
      } finally {
        this._polling = false
      }
    },

    /** 加载设备读模型并计算周报告。silent=true 用于后台轮询，不置 busy 以避免按钮抖动。 */
    async loadDevice(silent = false) {
      const deviceId = this.selectedDeviceId
      if (!deviceId) return
      if (!silent) this.busy = true
      try {
        const [deviceState, mappings, proposals] = await Promise.all([
          getSyncDeviceState(deviceId),
          listSyncMappings(deviceId),
          listSyncProposals(deviceId)
        ])
        const { readModel: model, lastSnapshot: snapshot } = deviceState
        this.readModel = model
        this.lastSnapshot = snapshot
        this.mappings = mappings
        this.proposals = proposals
        this.proposalOutcomes = Object.fromEntries(
          proposals
            .filter((proposal) => proposal.status === "accepted")
            .map((proposal) => [proposal.proposalId, proposalOutcome(proposal, model)])
        )
        this.report = computeWeeklyReport({
          model,
          dataUpdatedAt: snapshot?.receivedAt ?? null,
          snapshotId: snapshot?.snapshotId ?? null
        })
      } catch (error) {
        this.error = errorMessage(error)
      } finally {
        if (!silent) this.busy = false
      }
    },

    /**
     * 保存科目映射。target 为考试体系叶子（examSubjectId 等）或旧平面学科（teacherSubjectId）。
     * 映射结果可解释、可编辑、可撤销（UI 提供移除入口）。
     */
    async setMapping(
      alertSubjectRemoteId: string,
      target: { teacherSubjectId: string; examTrackId?: string | null; examSubjectId?: string | null; examModuleId?: string | null }
    ) {
      const deviceId = this.selectedDeviceId
      if (!deviceId) return
      try {
        await setSyncMapping({
          deviceId,
          alertSubjectRemoteId,
          teacherSubjectId: target.teacherSubjectId,
          examTrackId: target.examTrackId ?? null,
          examSubjectId: target.examSubjectId ?? null,
          examModuleId: target.examModuleId ?? null
        })
        await this.loadDevice()
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    async removeMapping(alertSubjectRemoteId: string) {
      const deviceId = this.selectedDeviceId
      if (!deviceId) return
      try {
        await removeSyncMapping(deviceId, alertSubjectRemoteId)
        await this.loadDevice()
      } catch (error) {
        this.error = errorMessage(error)
      }
    },

    // ── 诊断（approved 题库，答题驱动掌握度） ──────────────────────

    /**
     * 启动诊断：考试体系叶子映射时严格按叶子范围出题（approved + 归属校验），
     * 旧平面学科映射保持原有行为（按学科码检索）。
     */
    async startDiagnostic(mapping: SubjectMapping) {
      const deviceId = this.selectedDeviceId
      if (!deviceId) return
      const teacherSubjectId = mapping.teacherSubjectId
      const examScope =
        mapping.examSubjectId
          ? { examTrackId: mapping.examTrackId ?? null, subjectId: mapping.examSubjectId, moduleId: mapping.examModuleId ?? null }
          : undefined
      this.busy = true
      try {
        const result = await searchLocalQuestionBankLazy({
          subject: teacherSubjectId,
          purpose: "assessment",
          topK: 8,
          excludeRecentlyUsed: false,
          examScope
        })
        if (!result.ok || !result.data || result.data.questions.length === 0) {
          this.error = examScope
            ? `「${subjectLabel(teacherSubjectId)}」没有可用的 approved 题目，无法诊断（请确认该课程题库已审核，或检查映射）`
            : `「${subjectLabel(teacherSubjectId)}」没有可用的 approved 题目，无法诊断`
          return
        }
        const questions = selectDiagnosticQuestions(result.data)
        this.diagnostic = {
          alertSubjectRemoteId: mapping.alertSubjectRemoteId,
          teacherSubjectId,
          examTrackId: examScope?.examTrackId ?? null,
          examSubjectId: examScope?.subjectId ?? null,
          examModuleId: examScope?.moduleId ?? null,
          questions,
          currentIndex: 0,
          records: [],
          running: true,
          summary: null,
          answers: questions.map((question) => {
            const found = result.data?.questions.find((item) => item.questionId === question.questionId)
            return found?.answer ?? ""
          }),
          savedRecords: [],
          masteryUpdatedCount: 0,
          persisted: null
        }
      } catch (error) {
        this.error = errorMessage(error)
      } finally {
        this.busy = false
      }
    },

    /**
     * 提交当前题的答案：判分 → 记录 → BKT + assessment 落库（复用练习链路）。
     *
     * fail-closed 规则：
     * - assessment 保存失败时不宣称掌握度已更新，不把该题计入持久化证据；
     * - 只有 assessmentSaved 才把真实 assessment id 记入 savedAssessmentIds；
     * - 任何情况下都不生成 synthetic assessmentId 充当持久化证据。
     */
    async answerDiagnostic(studentAnswer: string) {
      const session = this.diagnostic
      if (!session || !session.running) return
      const question = session.questions[session.currentIndex]
      if (!question) return

      const correct = isAnswerCorrect(studentAnswer, question, session.answers[session.currentIndex] ?? "")
      session.records.push({
        questionId: question.questionId,
        studentAnswer,
        correct,
        answeredAtMs: Date.now()
      })

      // 掌握度只由真实答题驱动：BKT + assessment_results + student_knowledge。
      try {
        // 诊断掌握度查询只能看到本次诊断题涉及的知识点；空白名单也必须保持空结果，
        // 不能退化为整个 teacherSubjectId，避免跨考试叶子污染。
        const diagnosticKnowledgeNodeIds = collectDiagnosticKnowledgeNodeIds(session.questions)
        const studentKnowledge = await loadStudentKnowledge(
          DEFAULT_STUDENT_ID,
          session.teacherSubjectId,
          50,
          diagnosticKnowledgeNodeIds
        )
        const result = await searchLocalQuestionBankLazy({
          subject: session.teacherSubjectId,
          purpose: "assessment",
          topK: 8,
          excludeRecentlyUsed: false,
          examScope:
            session.examSubjectId
              ? { examTrackId: session.examTrackId ?? null, subjectId: session.examSubjectId, moduleId: session.examModuleId ?? null }
              : undefined
        })
        const fullQuestion = result.ok
          ? result.data?.questions.find((item) => item.questionId === question.questionId)
          : undefined
        if (fullQuestion) {
          const assessmentId = `diag-${session.teacherSubjectId}-${Date.now()}-${question.questionId}`
          const saveResult = await submitPracticeAnswer({
            question: fullQuestion,
            studentAnswer,
            subjectCode: session.teacherSubjectId,
            studentId: DEFAULT_STUDENT_ID,
            revealedHintsCount: 0,
            studentKnowledge,
            conversationId: null,
            diagnosticProvenance: {
              origin: "alerttime_sync_diagnostic_v1",
              questionId: question.questionId,
              alertSubjectRemoteId: session.alertSubjectRemoteId,
              examTrackId: session.examTrackId ?? null,
              examSubjectId: session.examSubjectId ?? null,
              examModuleId: session.examModuleId ?? null
            },
            bktUpdateMastery,
            saveAssessmentResult: (resultInput: unknown) => {
              const withId = { ...(resultInput as Record<string, unknown>), id: assessmentId }
              return saveAssessmentResult(withId as never)
            }
          })
          if (saveResult.assessmentSaved) {
            // 只有真实落库成功的单题记录才能成为掌握度/建议证据。
            session.savedRecords.push({ assessmentId, questionId: question.questionId, correct })
          }
          if (saveResult.bktUpdated && saveResult.knowledgeUpdated) {
            session.masteryUpdatedCount += 1
          }
        }
      } catch {
        // 保存失败：不阻断答题流程，但该题不计入持久化证据（fail-closed）。
      }

      if (session.currentIndex + 1 >= session.questions.length) {
        session.running = false
        session.summary = summarizeDiagnostic(session.records)
        await this.finishDiagnostic(session)
      } else {
        session.currentIndex += 1
      }
    },

    /**
     * 结束诊断：只把真实持久化的证据写入 localStorage。
     * 没有任何 assessment 保存成功时，不写入任何证据（不允许用失败结果生成掌握度计划）。
     */
    async finishDiagnostic(session: DiagnosticSession) {
      if (!session.summary) return
      const evidence = buildDiagnosticEvidence(
        session.savedRecords,
        {
          alertSubjectRemoteId: session.alertSubjectRemoteId,
          teacherSubjectId: session.teacherSubjectId,
          examTrackId: session.examTrackId,
          examSubjectId: session.examSubjectId,
          examModuleId: session.examModuleId
        },
        Date.now()
      )
      if (evidence === null) {
        // 全部保存失败：明确标记未持久化，UI 显示失败。
        session.persisted = false
        return
      }
      session.persisted = true
      const list = [...this.diagnosticEvidence, evidence].slice(-50)
      this.diagnosticEvidence = list
      localStorage.setItem(DIAGNOSTIC_EVIDENCE_KEY, JSON.stringify(list))
    },

    resetDiagnostic() {
      this.diagnostic = null
    },

    // ── Proposal 生成 ───────────────────────────────────────────────

    async generateProposal() {
      const deviceId = this.selectedDeviceId
      const report = this.report
      if (!deviceId || !report) {
        this.error = "请先选择已同步的设备"
        return null
      }
      // 教学证据只认真实持久化的 assessment_results；localStorage 只是缓存。
      const persistedEvidence = await this.persistedDiagnosticEvidence()
      if (persistedEvidence === null || persistedEvidence.length === 0) {
        this.error =
          "没有可用的持久化诊断证据。请先完成一次 approved 题库诊断，且至少一题的评估结果成功写入 assessment_results 后再生成建议。"
        return null
      }
      const input = {
        report,
        mappings: this.mappings,
        weakNodesByMapping: await this.loadWeakNodesByMapping(),
        acceptedProposals: this.proposals.filter((proposal) => proposal.status === "accepted"),
        acceptedProposalOutcomes: this.proposalOutcomes,
        diagnosticEvidence: persistedEvidence,
        latestAcceptedOutcome: this.proposals
          .filter((proposal) => proposal.status === "accepted")
          .sort((left, right) => right.createdAt - left.createdAt)
          .map((proposal) => this.proposalOutcomes[proposal.proposalId])
          .find((outcome): outcome is ProposalOutcome => outcome?.traceable) ?? null,
        pendingProposals: this.proposals.filter((proposal) => proposal.status === "pending")
      }
      const gate = canGenerateProposal(input)
      if (!gate.allowed) {
        this.error = gate.reason
        return null
      }
      try {
        const draft: ProposalDraft = planProposal(input)
        const proposalInput: CreateProposalInput = {
          deviceId,
          rationale: draft.rationale,
          proposedWeeklyGoals: draft.proposedWeeklyGoals,
          proposedTasks: draft.proposedTasks,
          sourceAssessmentIds: draft.sourceAssessmentIds
        }
        const created = await createSyncProposal(proposalInput)
        await this.loadDevice()
        return created
      } catch (error) {
        this.error = errorMessage(error)
        return null
      }
    },

    /**
     * 只保留真实存在于 assessment_results 的诊断证据（localStorage 不是权威来源）。
     * 过滤后为空 → 返回 null（不允许生成掌握度计划）。
     */
    async persistedDiagnosticEvidence(): Promise<DiagnosticEvidence[] | null> {
      const candidateIds = [
        ...new Set(
          this.diagnosticEvidence.flatMap((evidence) =>
            Array.isArray(evidence.assessmentIds)
              ? evidence.assessmentIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200)
              : []
          )
        )
      ]
      if (candidateIds.length === 0) return []
      if (candidateIds.length > 200) return []

      const persisted = await loadPersistedSyncDiagnosticAssessments(candidateIds)
      const byId = new Map(
        persisted
          .filter((record) => Number.isFinite(Date.parse(record.createdAt)))
          .map((record) => [record.assessmentId, record])
      )
      const consumed = new Set<string>()
      const rebuilt: DiagnosticEvidence[] = []

      for (const cachedBatch of this.diagnosticEvidence) {
        const ids = Array.isArray(cachedBatch.assessmentIds) ? cachedBatch.assessmentIds : []
        const records = [...new Set(ids.filter((id): id is string => typeof id === "string"))]
          .filter((id): id is string => typeof id === "string")
          .map((id) => byId.get(id))
          .filter(
            (record): record is NonNullable<typeof record> =>
              record !== undefined && !consumed.has(record.assessmentId)
          )
        if (records.length === 0) continue

        const provenanceKinds = new Set(records.map((record) => record.alertSubjectRemoteId ? "new" : "legacy"))
        if (provenanceKinds.size > 1) continue

        const resolved = records.map((record) => {
          if (record.alertSubjectRemoteId) {
            const mapping = this.mappings.find((item) => item.alertSubjectRemoteId === record.alertSubjectRemoteId)
            if (!mapping || mapping.teacherSubjectId !== record.teacherSubjectId) return null
            if (
              (mapping.examTrackId ?? null) !== (record.examTrackId ?? null) ||
              (mapping.examSubjectId ?? null) !== (record.examSubjectId ?? null) ||
              (mapping.examModuleId ?? null) !== (record.examModuleId ?? null)
            ) return null
            return { record, mapping }
          }

          const matches = this.mappings.filter((item) => item.teacherSubjectId === record.teacherSubjectId)
          if (matches.length !== 1) return null
          const mapping = matches[0]
          const hasLegacyScope = [record.examTrackId, record.examSubjectId, record.examModuleId].some(
            (value) => value !== null && value !== undefined
          )
          if (
            hasLegacyScope &&
            ((mapping.examTrackId ?? null) !== (record.examTrackId ?? null) ||
              (mapping.examSubjectId ?? null) !== (record.examSubjectId ?? null) ||
              (mapping.examModuleId ?? null) !== (record.examModuleId ?? null))
          ) {
            return null
          }
          return { record, mapping }
        })
        if (resolved.some((item) => item === null)) continue

        const first = resolved[0]!
        const key = [
          first.mapping.alertSubjectRemoteId,
          first.record.teacherSubjectId,
          first.mapping.examTrackId ?? null,
          first.mapping.examSubjectId ?? null,
          first.mapping.examModuleId ?? null
        ].join("|")
        if (
          resolved.some((item) => {
            const current = item!
            return [
              current.mapping.alertSubjectRemoteId,
              current.record.teacherSubjectId,
              current.mapping.examTrackId ?? null,
              current.mapping.examSubjectId ?? null,
              current.mapping.examModuleId ?? null
            ].join("|") !== key
          })
        ) continue

        const sorted = resolved
          .map((item) => item!.record)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.assessmentId.localeCompare(right.assessmentId))
        sorted.forEach((record) => consumed.add(record.assessmentId))
        const mapping = first.mapping
        const createdAt = sorted[sorted.length - 1].createdAt
        rebuilt.push({
          assessmentId: sorted[sorted.length - 1].assessmentId,
          assessmentIds: sorted.map((record) => record.assessmentId),
          alertSubjectRemoteId: mapping.alertSubjectRemoteId,
          teacherSubjectId: first.record.teacherSubjectId,
          examTrackId: mapping.examTrackId ?? null,
          examSubjectId: mapping.examSubjectId ?? null,
          examModuleId: mapping.examModuleId ?? null,
          questionCount: sorted.length,
          correctCount: sorted.filter((record) => record.correct).length,
          atMs: Date.parse(createdAt),
          createdAt
        })
      }
      return rebuilt
    },

    /**
     * 每个 AlertTime mapping 的薄弱节点（真实作答记录 attempts ≥ 1 且掌握度 < 0.6）。
     * 考试体系映射使用 approved 叶子的知识点白名单；旧平面映射维持 legacy 查询。
     */
    async loadWeakNodesByMapping(): Promise<Record<string, WeakNode[]>> {
      const result: Record<string, WeakNode[]> = {}
      const seen = new Set<string>()
      for (const mapping of this.mappings) {
        if (!mapping.alertSubjectRemoteId || seen.has(mapping.alertSubjectRemoteId)) continue
        seen.add(mapping.alertSubjectRemoteId)
        try {
          let knowledgeNodeIds: string[] | undefined
          if (mapping.examSubjectId) {
            knowledgeNodeIds = await collectApprovedKnowledgeNodeIdsForScope({
              examTrackId: mapping.examTrackId ?? null,
              subjectId: mapping.examSubjectId,
              moduleId: mapping.examModuleId ?? null
            })
            // 空白名单是明确的空范围，不得退回整学科查询。
            if (knowledgeNodeIds.length === 0) {
              result[mapping.alertSubjectRemoteId] = []
              continue
            }
          }
          const knowledge = await loadStudentKnowledge(
            DEFAULT_STUDENT_ID,
            mapping.teacherSubjectId,
            100,
            knowledgeNodeIds
          )
          result[mapping.alertSubjectRemoteId] = knowledge
            .filter((item) => item.attemptsCount >= 1 && item.masteryProbability < 0.6)
            .map((item) => ({
              nodeId: item.knowledgeNodeId,
              title: item.title,
              mastery: item.masteryProbability
            }))
        } catch {
          result[mapping.alertSubjectRemoteId] = []
        }
      }
      return result
    }
  }
})

function loadDiagnosticEvidence(): DiagnosticEvidence[] {
  try {
    const raw = localStorage.getItem(DIAGNOSTIC_EVIDENCE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DiagnosticEvidence[]) : []
  } catch {
    return []
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
