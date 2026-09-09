<script setup lang="ts">
/**
 * AlertTime 同步页面：局域网同步服务、配对、设备数据周报告、学科映射、
 * approved 题库诊断与计划建议稿生成。
 *
 * 安全边界：本页面只通过 Tauri command 交互；不监听端口、不直连 SQLite、
 * 不保存配对 token、不接触证书私钥。配对 token 只存在于内存与二维码中。
 */
import { computed, onMounted, onUnmounted, ref } from "vue"
import QRCode from "qrcode"
import { useAlertTimeSyncStore } from "../stores/alertTimeSync"
import { useAppStore } from "../stores/app"
import { subjectLabel } from "../utils/subject"
import { isBuiltInSubject } from "../types/learning"
import { listCustomSubjects } from "../services/tauri/commands"
import type { CustomSubjectDescriptor } from "../types/learning"
import type { SubjectMapping, SyncProposal, SyncSubject } from "../types/sync"
import type { ProposalOutcome } from "../engine/sync/proposalOutcome"
import { formatEffectiveSeconds } from "../engine/sync/weeklyReport"
import { aiUsageSourceLabel } from "../types/sync"
import LearningAnalysisPanel from "../components/LearningAnalysisPanel.vue"

function aiSourceLabel(source: string | null | undefined): string {
  return aiUsageSourceLabel(source)
}
import {
  getDescendantLeaves,
  getExamNode,
  getExamPath,
  getExamTracks,
  resolveByPhoneName
} from "../engine/examTaxonomy/registry"

const store = useAlertTimeSyncStore()
const appStore = useAppStore()

const POLL_INTERVAL_MS = 5000
const pollTimer = ref<number | null>(null)

const interfaceLabel = ref("")
const port = ref<number | null>(null)
const qrDataUrl = ref("")
const selectedTeacherSubject = ref<Record<string, string>>({})
const customSubjects = ref<CustomSubjectDescriptor[]>([])
const diagnosticAnswer = ref("")
const diagnosticSubjectId = ref("")
const generatedProposal = ref<SyncProposal | null>(null)

/** 考试体系叶子映射选项（value 使用 "exam:<stableId>" 前缀，与旧平面学科码区分）。 */
const EXAM_OPTION_PREFIX = "exam:"

const examLeafOptions = computed(() => {
  const options: Array<{ title: string; value: string }> = []
  for (const track of getExamTracks()) {
    for (const leaf of getDescendantLeaves(track.stableId)) {
      options.push({
        title: `${track.code ? `${track.code} · ` : ""}${track.displayName} / ${leaf.displayName}`,
        value: `${EXAM_OPTION_PREFIX}${leaf.stableId}`
      })
    }
  }
  return options
})

/** 旧平面学科 + 自定义学科选项（非考试体系叶子）。 */
const teacherSubjectOptions = computed(() => {
  const builtIn = appStore.allSubjects
    .filter((subject) => isBuiltInSubject(subject.code))
    .map((subject) => ({ title: subject.name, value: subject.code }))
  const custom = customSubjects.value.map((subject) => ({
    title: subject.name,
    value: subject.id
  }))
  return [...examLeafOptions.value, ...builtIn, ...custom]
})

/** 某手机科目的映射状态（已映射 / 待确认 / 未映射）与建议映射。 */
function mappingStatusOf(subject: { remoteId: string; name: string }): {
  status: "mapped" | "pending-confirm" | "unmapped"
  label: string
  suggestedStableId: string | null
  suggestedLabel: string | null
} {
  const mapping = store.mappings.find((m) => m.alertSubjectRemoteId === subject.remoteId)
  if (mapping) {
    const leaf = mapping.examSubjectId ? getExamNode(mapping.examSubjectId) : null
    if (leaf) {
      return {
        status: "mapped",
        label: `已映射：${formatExamPathShort(leaf.stableId)}`,
        suggestedStableId: null,
        suggestedLabel: null
      }
    }
    return { status: "mapped", label: `已映射：${subjectLabel(mapping.teacherSubjectId)}`, suggestedStableId: null, suggestedLabel: null }
  }
  // 未映射：按名称精确别名匹配给「待确认」建议（唯一叶子命中时）。
  const hits = resolveByPhoneName(subject.name)
  const leafHit = hits.find((node) => node.nodeType !== "EXAM_TRACK")
  if (leafHit) {
    return {
      status: "pending-confirm",
      label: "待用户确认",
      suggestedStableId: leafHit.stableId,
      suggestedLabel: formatExamPathShort(leafHit.stableId)
    }
  }
  return { status: "unmapped", label: "未映射", suggestedStableId: null, suggestedLabel: null }
}

function formatExamPathShort(stableId: string): string {
  const path = getExamPath(stableId)
  return path.map((node) => node.displayName).join(" / ")
}

/** 解析映射选项值为保存参数。 */
function parseMappingValue(value: string | null): {
  teacherSubjectId: string
  examTrackId: string | null
  examSubjectId: string | null
  examModuleId: string | null
} | null {
  if (!value) return null
  if (value.startsWith(EXAM_OPTION_PREFIX)) {
    const stableId = value.slice(EXAM_OPTION_PREFIX.length)
    const node = getExamNode(stableId)
    if (!node) return null
    return {
      teacherSubjectId: node.legacySubjectCode ?? "cs408",
      examTrackId: getExamPath(stableId)[0]?.stableId ?? null,
      examSubjectId: stableId,
      examModuleId: null
    }
  }
  return { teacherSubjectId: value, examTrackId: null, examSubjectId: null, examModuleId: null }
}

/** 映射选项回显值：考试体系叶子优先。 */
function mappingDisplayValue(mapping: SubjectMapping): string {
  if (mapping.examSubjectId) return `${EXAM_OPTION_PREFIX}${mapping.examSubjectId}`
  return mapping.teacherSubjectId
}

const serverAddress = computed(() => {
  if (!store.serverStatus.running || !store.serverStatus.address || !store.serverStatus.port) return null
  return `${store.serverStatus.address}:${store.serverStatus.port}`
})

const pairingExpiresText = computed(() => {
  if (!store.pairingInfo) return ""
  const expires = new Date(store.pairingInfo.expiresAtMs)
  return expires.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
})

const mappingOf = computed(() => {
  const map = new Map<string, string>()
  for (const mapping of store.mappings) {
    map.set(mapping.alertSubjectRemoteId, mapping.teacherSubjectId)
  }
  return map
})

const diagnosticQuestion = computed(() => {
  const session = store.diagnostic
  if (!session) return null
  return session.questions[session.currentIndex] ?? null
})

const diagnosticProgress = computed(() => {
  const session = store.diagnostic
  if (!session) return "0/0"
  return `${session.currentIndex + (session.running ? 1 : 0)}/${session.questions.length}`
})

onMounted(async () => {
  await store.init()
  await loadCustomSubjects()
  if (store.interfaces.length > 0 && !interfaceLabel.value) {
    interfaceLabel.value = store.interfaces[0]
  }
  pollTimer.value = window.setInterval(() => {
    void store.pollDeviceChanges()
  }, POLL_INTERVAL_MS)
})

onUnmounted(() => {
  if (pollTimer.value !== null) {
    window.clearInterval(pollTimer.value)
    pollTimer.value = null
  }
})

async function loadCustomSubjects() {
  try {
    customSubjects.value = await listCustomSubjects()
  } catch {
    customSubjects.value = []
  }
}

async function startServer() {
  if (!interfaceLabel.value) return
  await store.startServer(interfaceLabel.value, port.value ?? undefined)
}

async function stopServer() {
  await store.stopServer()
  qrDataUrl.value = ""
}

async function refreshPairing() {
  qrDataUrl.value = ""
  await store.refreshPairing()
  if (store.pairingInfo) {
    try {
      qrDataUrl.value = await QRCode.toDataURL(store.pairingInfo.qrText, { width: 220, margin: 1 })
    } catch {
      qrDataUrl.value = ""
    }
  }
}

async function selectDevice(deviceId: string) {
  await store.selectDevice(deviceId)
  // 刷新已选科目的映射下拉框初值（考试体系叶子优先回显）。
  const next: Record<string, string> = {}
  for (const mapping of store.mappings) {
    next[mapping.alertSubjectRemoteId] = mappingDisplayValue(mapping)
  }
  selectedTeacherSubject.value = next
}

async function saveMapping(subjectRemoteId: string) {
  const raw = selectedTeacherSubject.value[subjectRemoteId]
  const target = parseMappingValue(raw ?? null)
  if (!target) return
  await store.setMapping(subjectRemoteId, target)
}

async function removeMapping(subjectRemoteId: string) {
  await store.removeMapping(subjectRemoteId)
  delete selectedTeacherSubject.value[subjectRemoteId]
}

function startDiagnostic(mapping: SubjectMapping) {
  diagnosticSubjectId.value = mapping.teacherSubjectId
  diagnosticAnswer.value = ""
  store.startDiagnostic(mapping)
}

async function submitDiagnosticAnswer() {
  const answer = diagnosticAnswer.value.trim()
  if (!answer) return
  diagnosticAnswer.value = ""
  await store.answerDiagnostic(answer)
}

function resetDiagnostic() {
  store.resetDiagnostic()
  diagnosticSubjectId.value = ""
  diagnosticAnswer.value = ""
}

async function generateProposal() {
  generatedProposal.value = await store.generateProposal()
}

function proposalStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "待处理",
    accepted: "已采纳",
    rejected: "已拒绝",
    superseded: "已被新建议取代"
  }
  return labels[status] ?? status
}

function proposalStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: "primary",
    accepted: "success",
    rejected: "error",
    superseded: "grey"
  }
  return colors[status] ?? "grey"
}

function proposalOutcomeOf(proposal: SyncProposal): ProposalOutcome | null {
  return store.proposalOutcomes[proposal.proposalId] ?? null
}

function outcomeSummaryLabel(label: string, summary: ProposalOutcome["totalSummary"]): string {
  if (summary.expected === 0) return `${label}：无建议项`
  const rate = summary.completionRate === null ? "—" : `${Math.round(summary.completionRate * 100)}%`
  return `${label}：已完成 ${summary.completed}/${summary.expected}，待完成 ${summary.pending}，已关闭 ${summary.closed}，已删除 ${summary.deleted}，无法追踪 ${summary.missing}（完成率 ${rate}）`
}

function outcomeDetailLabel(label: string, summary: ProposalOutcome["tasksSummary"]): string {
  if (summary.expected === 0) return `${label}：无建议项`
  return `${label}：已完成 ${summary.completed}/${summary.expected}，待完成 ${summary.pending}，已关闭 ${summary.closed}，已删除 ${summary.deleted}，无法追踪 ${summary.missing}`
}

function outcomeIsTraceable(proposal: SyncProposal): boolean {
  return proposalOutcomeOf(proposal)?.traceable === true
}

function outcomeTasksLabel(proposal: SyncProposal): string {
  const outcome = proposalOutcomeOf(proposal)
  return outcome ? outcomeDetailLabel("任务", outcome.tasksSummary) : "任务：无可追踪数据"
}

function outcomeGoalsLabel(proposal: SyncProposal): string {
  const outcome = proposalOutcomeOf(proposal)
  return outcome ? outcomeDetailLabel("周目标", outcome.weeklyGoalsSummary) : "周目标：无可追踪数据"
}

function outcomeTotalLabel(proposal: SyncProposal): string {
  const outcome = proposalOutcomeOf(proposal)
  return outcome ? outcomeSummaryLabel("合计", outcome.totalSummary) : "合计：无可追踪数据"
}

function outcomeUpdateLabel(): string {
  return store.lastSnapshot?.receivedAt
    ? `数据更新时间：${formatDateLabel(store.lastSnapshot.receivedAt)}`
    : "暂无数据更新时间"
}

function mappingLabel(mapping: SubjectMapping): string {
  return store.report?.activeSubjects.find((subject) => subject.remoteId === mapping.alertSubjectRemoteId)?.name ??
    mapping.alertSubjectRemoteId
}

function formatDateLabel(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("zh-CN", { hour12: false })
}
</script>

<template>
  <div class="alerttime-sync-view">
    <header class="page-header">
      <h1>AlertTime 同步</h1>
      <p class="subtitle">
        在家庭 WiFi 或手机热点下，把手机端 AlertTime 的执行数据同步到桌面端，并接收计划建议稿。
        本功能默认关闭，仅在私有局域网内使用。
      </p>
    </header>

    <v-alert
      v-if="store.error"
      type="error"
      variant="tonal"
      class="mb-4"
      closable
      @update:model-value="store.clearError()"
    >
      {{ store.error }}
    </v-alert>

    <!-- ── 服务与配对 ─────────────────────────────────────────────── -->
    <v-card class="mb-4 sync-card" rounded="lg">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-lan-connect</v-icon> 同步服务
      </v-card-title>
      <v-card-text>
        <div class="d-flex align-center ga-4 mb-3">
          <v-switch
            :model-value="store.serverStatus.running"
            label="开启局域网同步服务"
            color="primary"
            hide-details
            @update:model-value="(value: boolean | null) => value ? startServer() : stopServer()"
          />
          <v-chip
            v-if="store.serverStatus.running"
            color="success"
            variant="tonal"
            size="small"
          >
            服务运行中：{{ serverAddress }}
          </v-chip>
          <v-chip v-else color="grey" variant="tonal" size="small">已关闭</v-chip>
        </div>

        <v-row v-if="!store.serverStatus.running" dense>
          <v-col cols="8">
            <v-select
              v-model="interfaceLabel"
              :items="store.interfaces"
              label="选择局域网 IPv4"
              density="compact"
              hide-details
              variant="outlined"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="port"
              label="端口"
              type="number"
              density="compact"
              hide-details
              variant="outlined"
              :placeholder="'8787'"
            />
          </v-col>
        </v-row>

        <v-btn
          v-if="store.serverStatus.running"
          color="secondary"
          variant="tonal"
          size="small"
          class="mt-2"
          @click="store.diagnoseFirewall()"
        >
          防火墙与网络诊断
        </v-btn>

        <v-alert
          v-if="store.firewallDiagnosis"
          :type="store.firewallDiagnosis.selfTestOk ? 'success' : 'warning'"
          variant="tonal"
          class="mt-3"
        >
          <div class="text-body-2">{{ store.firewallDiagnosis.selfTestMessage }}</div>
          <div class="text-body-2 mt-1">{{ store.firewallDiagnosis.guidance }}</div>
        </v-alert>

        <v-alert type="info" variant="tonal" class="mt-3">
          <strong>网络限制说明：</strong>学校、公司和公共 WiFi 可能存在 AP isolation、VLAN 或防火墙限制。
          局域网同步只能在家庭 WiFi 或手机热点等同一私有局域网内使用，不能保证任意网络下可用。
        </v-alert>
      </v-card-text>
    </v-card>

    <v-card class="mb-4 sync-card" rounded="lg">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-qrcode-scan</v-icon> 配对手机
      </v-card-title>
      <v-card-text>
        <template v-if="store.serverStatus.running">
          <v-btn
            v-if="!store.pairingInfo"
            color="primary"
            variant="tonal"
            :loading="store.busy"
            @click="refreshPairing()"
          >
            生成配对二维码
          </v-btn>
          <div v-else class="d-flex align-start ga-4">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="配对二维码" class="qr-image" />
            <div>
              <p class="text-body-2 mb-2">
                用 AlertTime 的「Teacher 同步 → 扫描二维码」扫描。二维码包含 HTTPS 地址、端口、
                证书指纹、一次性配对 token 与过期时间；token 有效期至
                <strong>{{ pairingExpiresText }}</strong>，只能使用一次。
              </p>
              <v-btn size="small" variant="tonal" @click="refreshPairing()">重新生成</v-btn>
              <v-btn size="small" variant="text" @click="store.clearPairing(); qrDataUrl = ''">
                清除
              </v-btn>
            </div>
          </div>
        </template>
        <v-alert v-else type="info" variant="tonal">
          请先开启同步服务，再生成配对二维码。
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- ── 已配对设备 ─────────────────────────────────────────────── -->
    <v-card class="mb-4 sync-card" rounded="lg">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-cellphone</v-icon> 已配对设备
        <v-spacer />
        <v-btn size="small" variant="text" @click="store.refreshDevices()">刷新</v-btn>
      </v-card-title>
      <v-card-text>
        <v-table v-if="store.devices.length > 0" density="compact">
          <thead>
            <tr>
              <th>设备</th>
              <th>配对时间</th>
              <th>最后同步</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="device in store.devices" :key="device.deviceId">
              <td>{{ device.displayName }}</td>
              <td class="text-body-2">{{ formatDateLabel(device.pairedAt) }}</td>
              <td class="text-body-2">{{ formatDateLabel(device.lastSyncAt) }}</td>
              <td>
                <v-chip :color="device.revoked ? 'grey' : 'success'" size="x-small" variant="tonal">
                  {{ device.revoked ? "已撤销" : "已连接" }}
                </v-chip>
              </td>
              <td class="text-end">
                <v-btn
                  v-if="!device.revoked"
                  size="x-small"
                  color="error"
                  variant="tonal"
                  @click="store.revokeDevice(device.deviceId)"
                >
                  撤销
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-alert v-else type="info" variant="tonal">
          暂无已配对设备。开启服务后生成二维码，用手机扫码配对。
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- ── 周报告 ─────────────────────────────────────────────────── -->
    <v-card class="mb-4 sync-card" rounded="lg">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-chart-line</v-icon> AlertTime 周报告
      </v-card-title>
      <v-card-text>
        <v-select
          v-if="store.devices.length > 0"
          :model-value="store.selectedDeviceId"
          :items="store.devices.filter((device) => !device.revoked).map((device) => ({ title: device.displayName, value: device.deviceId }))"
          label="选择设备查看数据"
          density="compact"
          variant="outlined"
          class="mb-3"
          @update:model-value="selectDevice(String($event))"
        />

        <template v-if="store.report">
          <v-alert
            v-if="store.report.missing.noSnapshot"
            type="warning"
            variant="tonal"
            class="mb-3"
          >
            尚未收到手机数据。请在手机上点击「立即同步」后重试。
          </v-alert>
          <v-alert v-if="store.lastSnapshot" type="info" variant="tonal" class="mb-3">
            数据更新时间：{{ formatDateLabel(store.lastSnapshot.receivedAt) }}
            （科目 {{ store.lastSnapshot.subjectCount }} / 周目标 {{ store.lastSnapshot.goalCount }} /
            计划 {{ store.lastSnapshot.taskCount }} / 会话 {{ store.lastSnapshot.sessionCount }}）
          </v-alert>

          <v-row>
            <v-col cols="6" md="3">
              <v-card variant="tonal" class="metric-card">
                <v-card-text class="text-center">
                  <div class="metric-value">{{ store.report.goals.completionRate === null ? "—" : Math.round(store.report.goals.completionRate * 100) + "%" }}</div>
                  <div class="metric-label">周目标完成率</div>
                  <div class="metric-sub">完成 {{ store.report.goals.done }} / 延期 {{ store.report.goals.deferred }} / 取消 {{ store.report.goals.canceled }}</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="6" md="3">
              <v-card variant="tonal" class="metric-card">
                <v-card-text class="text-center">
                  <div class="metric-value">{{ store.report.plans.completionRate === null ? "—" : Math.round(store.report.plans.completionRate * 100) + "%" }}</div>
                  <div class="metric-label">计划完成率</div>
                  <div class="metric-sub">完成 {{ store.report.plans.done }} / {{ store.report.plans.total }}</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="6" md="3">
              <v-card variant="tonal" class="metric-card">
                <v-card-text class="text-center">
                  <div class="metric-value">{{ store.report.studyDays }} 天</div>
                  <div class="metric-label">学习天数</div>
                  <div class="metric-sub">日均 {{ formatEffectiveSeconds(store.report.dailyAverageSeconds) }}</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="6" md="3">
              <v-card variant="tonal" class="metric-card">
                <v-card-text class="text-center">
                  <div class="metric-value">{{ formatEffectiveSeconds(store.report.effectiveSeconds) }}</div>
                  <div class="metric-label">有效学习时长</div>
                  <v-chip
                    :color="store.report.engagement === 'high' ? 'success' : store.report.engagement === 'medium' ? 'warning' : 'grey'"
                    size="x-small"
                    variant="tonal"
                  >
                    投入度：{{ store.report.engagement === "high" ? "高" : store.report.engagement === "medium" ? "中" : "低" }}
                  </v-chip>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>

          <v-alert
            v-if="store.report.missing.noGoals || store.report.missing.noPlans || store.report.missing.noSessions"
            type="info"
            variant="tonal"
            class="mt-3"
          >
            <template v-if="store.report.missing.noGoals">本周还没有周目标；</template>
            <template v-if="store.report.missing.noPlans">本周还没有执行计划；</template>
            <template v-if="store.report.missing.noSessions">本周还没有学习会话。</template>
            这些数据只反映本周执行情况，不影响已同步历史。
          </v-alert>

          <LearningAnalysisPanel
            :analysis="store.latestLearningAnalysis"
            :snapshot-id="store.lastSnapshot?.snapshotId"
          />

          <v-card variant="outlined" class="pa-3 mt-3">
            <h3 class="text-subtitle-2 mb-2">AI 使用时间（与有效专注时间分开统计）</h3>
            <v-row>
              <v-col cols="6" md="3">
                <div class="text-body-2">AlertTime AI 求助</div>
                <div class="metric-value">
                  {{ store.report.aiHelpSeconds > 0 ? formatEffectiveSeconds(store.report.aiHelpSeconds) : (store.report.aiUsagePartiallyUnknown ? "未记录" : "0 分钟") }}
                </div>
                <div class="metric-sub">共 {{ store.report.aiHelpCount }} 次</div>
              </v-col>
              <v-col cols="6" md="3">
                <div class="text-body-2">外部 AI App</div>
                <div class="metric-value">
                  {{
                    store.report.externalAiAppSeconds === null
                      ? "未记录"
                      : formatEffectiveSeconds(store.report.externalAiAppSeconds)
                  }}
                </div>
                <div class="metric-sub">
                  {{ store.report.aiUsageSources.length > 0 ? "来源：" + store.report.aiUsageSources.map(aiSourceLabel).join("、") : "无" }}
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <v-alert
                  v-if="store.report.aiUsagePartiallyUnknown"
                  type="info"
                  variant="tonal"
                  density="compact"
                  class="mb-0"
                >
                  部分会话的 AI 时长手机端未记录（旧客户端未上报，或未授权使用情况访问权限）。
                  显示「未记录」，不会推断为「没有使用 AI」。
                </v-alert>
              </v-col>
            </v-row>
            <v-divider class="my-2" />
            <h3 class="text-subtitle-2 mb-2">会话明细（专注 / AI / 外部 AI）</h3>
            <v-table density="compact" v-if="store.report.sessionDetails.length > 0">
              <thead>
                <tr>
                  <th>会话</th>
                  <th>有效专注</th>
                  <th>AI 求助</th>
                  <th>外部 AI App</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="detail in store.report.sessionDetails.slice(0, 20)" :key="detail.remoteId">
                  <td class="text-body-2">{{ detail.title ?? "专注学习" }}</td>
                  <td class="text-body-2">{{ formatEffectiveSeconds(detail.durationSeconds) }}</td>
                  <td class="text-body-2">
                    {{ detail.aiUnknown ? "未记录" : formatEffectiveSeconds(detail.aiHelpSeconds) }}
                  </td>
                  <td class="text-body-2">
                    {{ detail.externalAiAppSeconds === null ? "未记录" : formatEffectiveSeconds(detail.externalAiAppSeconds) }}
                  </td>
                  <td class="text-body-2">{{ aiSourceLabel(detail.aiUsageSource) }}</td>
                </tr>
              </tbody>
            </v-table>
            <v-alert v-else type="info" variant="tonal" density="compact">本周暂无已完成会话</v-alert>
          </v-card>

          <v-row class="mt-2">
            <v-col cols="12" md="6">
              <v-card variant="outlined" class="pa-3">
                <h3 class="text-subtitle-2 mb-2">科目分布（本周有效时长）</h3>
                <div v-if="store.report.subjectDistribution.length > 0">
                  <div v-for="item in store.report.subjectDistribution" :key="item.subjectRemoteId ?? 'none'" class="mb-1">
                    <div class="d-flex justify-space-between text-body-2">
                      <span>{{ item.displayName }}</span>
                      <span>{{ formatEffectiveSeconds(item.durationSeconds) }}（{{ Math.round(item.ratio * 100) }}%）</span>
                    </div>
                    <v-progress-linear :model-value="item.ratio * 100" color="primary" height="6" rounded />
                  </div>
                </div>
                <v-alert v-else type="info" variant="tonal" density="compact">本周暂无已完成会话</v-alert>
              </v-card>
            </v-col>
            <v-col cols="12" md="6">
              <v-card variant="outlined" class="pa-3">
                <h3 class="text-subtitle-2 mb-2">未完成计划（本周）</h3>
                <div v-if="store.report.plans.unfinished.length > 0">
                  <div v-for="task in store.report.plans.unfinished" :key="task.remoteId" class="text-body-2 mb-1">
                    · {{ task.title }}
                  </div>
                </div>
                <v-alert v-else type="success" variant="tonal" density="compact">本周计划已全部完成或暂无计划</v-alert>
                <h3 class="text-subtitle-2 mt-3 mb-2">进行中会话</h3>
                <div v-if="store.report.runningSessions.length > 0">
                  <div v-for="session in store.report.runningSessions" :key="session.remoteId" class="text-body-2 mb-1">
                    · {{ session.title ?? "专注学习" }}（已累计 {{ formatEffectiveSeconds(session.durationSeconds) }}，进行中不计入完成统计）
                  </div>
                </div>
                <v-alert v-else type="info" variant="tonal" density="compact">暂无进行中会话</v-alert>
              </v-card>
            </v-col>
          </v-row>
        </template>
        <v-alert v-else type="info" variant="tonal">
          选择一台已配对设备后，这里会展示它的周完成情况与学习投入度。
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- ── 学科映射 ───────────────────────────────────────────────── -->
    <v-card class="mb-4 sync-card" rounded="lg">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-map-marker</v-icon> 学科映射
      </v-card-title>
      <v-card-text>
        <v-alert type="info" variant="tonal" class="mb-3">
          手机上的自定义科目<b>不会</b>被静默映射到知识节点。请为每个科目明确选择对应的
          TeacherAgent 学科；无映射的科目只参与执行分析，不参与掌握度更新。
        </v-alert>
        <template v-if="store.report && store.report.activeSubjects.length > 0">
          <v-row
            v-for="subject in store.report.activeSubjects"
            :key="subject.remoteId"
            align="center"
            class="mb-2"
            dense
          >
            <v-col cols="4">
              <span class="text-body-2">{{ subject.name }}</span>
              <div class="text-caption mt-1">
                <v-chip
                  :color="mappingStatusOf(subject).status === 'mapped' ? 'success' : mappingStatusOf(subject).status === 'pending-confirm' ? 'warning' : 'grey'"
                  size="x-small"
                  variant="tonal"
                >
                  {{ mappingStatusOf(subject).label }}
                </v-chip>
                <v-btn
                  v-if="mappingStatusOf(subject).status === 'pending-confirm' && mappingStatusOf(subject).suggestedStableId"
                  size="x-small"
                  variant="text"
                  class="ml-1"
                  @click="selectedTeacherSubject[subject.remoteId] = EXAM_OPTION_PREFIX + mappingStatusOf(subject).suggestedStableId"
                >
                  建议：{{ mappingStatusOf(subject).suggestedLabel }}
                </v-btn>
              </div>
            </v-col>
            <v-col cols="6">
              <v-select
                :model-value="mappingOf.has(subject.remoteId) ? mappingDisplayValue(store.mappings.find((m) => m.alertSubjectRemoteId === subject.remoteId)!) : selectedTeacherSubject[subject.remoteId] ?? null"
                :items="teacherSubjectOptions"
                label="映射到考试体系 / TeacherAgent 学科"
                density="compact"
                hide-details
                variant="outlined"
                @update:model-value="selectedTeacherSubject[subject.remoteId] = String($event ?? '')"
              />
            </v-col>
            <v-col cols="2" class="text-end">
              <v-btn
                v-if="mappingOf.has(subject.remoteId)"
                size="small"
                color="error"
                variant="text"
                @click="removeMapping(subject.remoteId)"
              >
                移除
              </v-btn>
              <v-btn
                v-else
                size="small"
                color="primary"
                variant="tonal"
                :disabled="!selectedTeacherSubject[subject.remoteId]"
                @click="saveMapping(subject.remoteId)"
              >
                映射
              </v-btn>
            </v-col>
          </v-row>
        </template>
        <v-alert v-else type="info" variant="tonal">
          选择已配对设备并完成同步后，这里会列出手机上的科目。
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- ── 诊断 ───────────────────────────────────────────────────── -->
    <v-card class="mb-4 sync-card" rounded="lg">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-head-question-outline</v-icon> 学科诊断（approved 题库）
      </v-card-title>
      <v-card-text>
        <v-alert type="info" variant="tonal" class="mb-3">
          只使用已审核（approved）题库出题；掌握度只由真实答题结果驱动，学习时长不影响掌握度。
        </v-alert>

        <template v-if="store.diagnostic && store.diagnostic.running">
          <v-alert type="info" variant="tonal" class="mb-2">
            正在诊断「{{ subjectLabel(store.diagnostic.teacherSubjectId) }}」：第
            {{ diagnosticProgress }} 题
          </v-alert>
          <v-alert
            v-if="store.diagnostic.examSubjectId"
            type="info"
            variant="tonal"
            class="mb-2"
          >
            <strong>本题属于：</strong>{{ formatExamPathShort(store.diagnostic.examSubjectId) }}
            <template v-if="diagnosticQuestion?.subjectId">
              ；本题实际范围：{{ formatExamPathShort(diagnosticQuestion.subjectId) }}
            </template>
            <div class="text-caption mt-1">推荐依据：学科映射（approved 题库，按叶子范围出题）</div>
          </v-alert>
          <v-card variant="outlined" class="pa-3 mb-3">
            <p class="text-body-1">{{ diagnosticQuestion?.content }}</p>
          </v-card>
          <v-text-field
            v-model="diagnosticAnswer"
            label="你的答案"
            density="compact"
            variant="outlined"
            @keyup.enter="submitDiagnosticAnswer()"
          />
          <v-btn color="primary" variant="tonal" :disabled="!diagnosticAnswer.trim()" @click="submitDiagnosticAnswer()">
            提交答案
          </v-btn>
          <v-btn variant="text" size="small" class="ml-2" @click="resetDiagnostic()">放弃诊断</v-btn>
        </template>

        <template v-else-if="store.diagnostic && !store.diagnostic.running && store.diagnostic.summary">
          <!-- 答题完成 ≠ 评估已持久化 ≠ 掌握度已更新：分状态展示。 -->
          <v-alert
            v-if="store.diagnostic.persisted === false"
            type="error"
            variant="tonal"
          >
            诊断已作答 {{ store.diagnostic.summary.questionCount }} 题，但评估结果<b>保存失败</b>，
            未更新掌握度，也未生成教学证据。请重试诊断（可先检查 TeacherAgent 数据库状态）。
          </v-alert>
          <v-alert
            v-else-if="store.diagnostic.savedRecords.length < store.diagnostic.summary.questionCount"
            type="warning"
            variant="tonal"
          >
            诊断完成：{{ store.diagnostic.summary.questionCount }} 题，答对
            {{ store.diagnostic.summary.correctCount }} 题。其中
            {{ store.diagnostic.savedRecords.length }} 题评估已持久化
            {{ store.diagnostic.masteryUpdatedCount > 0 ? `，${store.diagnostic.masteryUpdatedCount} 题掌握度已更新` : "，但掌握度未更新" }}；
            保存失败的题目不计入掌握度与教学证据。
          </v-alert>
          <v-alert v-else type="success" variant="tonal">
            诊断完成：{{ store.diagnostic.summary.questionCount }} 题，答对
            {{ store.diagnostic.summary.correctCount }} 题（正确率
            {{ Math.round(store.diagnostic.summary.correctRate * 100) }}%）。
            评估结果已全部持久化{{ store.diagnostic.masteryUpdatedCount > 0 ? "，掌握度已更新" : "，掌握度未更新" }}。
          </v-alert>
          <v-btn size="small" variant="text" class="mt-2" @click="resetDiagnostic()">关闭</v-btn>
        </template>

        <template v-else>
          <div v-if="store.mappings.length > 0">
            <v-btn
              v-for="mapping in store.mappings"
              :key="mapping.alertSubjectRemoteId"
              class="mr-2 mb-2"
              color="primary"
              variant="tonal"
              :disabled="store.busy"
              @click="startDiagnostic(mapping)"
            >
              诊断「{{ mappingLabel(mapping) }}」（{{ subjectLabel(mapping.teacherSubjectId) }}）
            </v-btn>
          </div>
          <v-alert v-else type="info" variant="tonal">
            请先完成学科映射，才能用 approved 题库诊断。
          </v-alert>
        </template>
      </v-card-text>
    </v-card>

    <!-- ── 计划建议稿 ─────────────────────────────────────────────── -->
    <v-card class="mb-4 sync-card" rounded="lg">
      <v-card-title class="d-flex align-center">
        <v-icon start color="primary">mdi-clipboard-text-outline</v-icon> 计划建议稿（proposal）
      </v-card-title>
      <v-card-text>
        <v-alert type="info" variant="tonal" class="mb-3">
          TeacherAgent 只生成<b>建议稿</b>，不会直接修改手机计划。手机端用户明确点击「采纳」后，
          才会创建周目标与计划；采纳/拒绝结果会同步回桌面端。
        </v-alert>
        <v-btn
          color="primary"
          variant="tonal"
          :disabled="!store.hasSelectedDevice || store.busy"
          :loading="store.busy"
          @click="generateProposal()"
        >
          生成下一周计划建议
        </v-btn>

        <v-card v-if="generatedProposal" variant="outlined" class="mt-3 pa-3">
          <h3 class="text-subtitle-2 mb-1">建议已生成（{{ proposalStatusLabel(generatedProposal.status) }}）</h3>
          <p class="text-body-2">{{ generatedProposal.rationale }}</p>
          <div class="text-body-2">
            <div v-for="goal in generatedProposal.proposedWeeklyGoals" :key="goal.weekStart">
              · 周目标：{{ goal.title }}{{ goal.successCriteria ? `（${goal.successCriteria}）` : "" }}
            </div>
            <div v-for="task in generatedProposal.proposedTasks" :key="task.title">
              · 计划：{{ task.title }}{{ task.targetDurationSeconds ? `（${formatEffectiveSeconds(task.targetDurationSeconds)}）` : "" }}
            </div>
          </div>
        </v-card>

        <v-divider class="my-3" />
        <h3 class="text-subtitle-2 mb-2">建议列表（手机端处理后状态会同步回来）</h3>
        <v-table v-if="store.proposals.length > 0" density="compact">
          <thead>
            <tr>
              <th>生成时间</th>
              <th>状态</th>
              <th>依据</th>
              <th>周目标 / 计划</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="proposal in store.proposals" :key="proposal.proposalId">
              <tr>
                <td class="text-body-2">{{ formatDateLabel(new Date(proposal.createdAt).toISOString()) }}</td>
                <td>
                  <v-chip :color="proposalStatusColor(proposal.status)" size="x-small" variant="tonal">
                    {{ proposalStatusLabel(proposal.status) }}
                  </v-chip>
                </td>
                <td class="text-body-2 proposal-rationale">{{ proposal.rationale }}</td>
                <td class="text-body-2">
                  {{ proposal.proposedWeeklyGoals.length }} / {{ proposal.proposedTasks.length }}
                </td>
              </tr>
              <tr v-if="proposal.status === 'accepted'">
                <td colspan="4" class="pa-2">
                  <v-card variant="tonal" color="success" class="pa-3">
                    <div class="text-subtitle-2 mb-1">采纳后执行情况</div>
                    <template v-if="outcomeIsTraceable(proposal)">
                      <div class="text-body-2">
                        {{ outcomeTasksLabel(proposal) }}
                      </div>
                      <div class="text-body-2">
                        {{ outcomeGoalsLabel(proposal) }}
                      </div>
                      <div class="text-caption mt-1">
                        {{ outcomeTotalLabel(proposal) }}；{{ outcomeUpdateLabel() }}
                      </div>
                    </template>
                    <div v-else class="text-body-2">
                      <strong>已采纳，等待下一次手机同步确认。</strong>
                      当前快照没有可追踪的 sourceProposalId 执行数据；旧版手机端可能已创建同名计划，
                      但不能据此推断为本建议执行结果。{{ outcomeUpdateLabel() }}
                    </div>
                  </v-card>
                </td>
              </tr>
            </template>
          </tbody>
        </v-table>
        <v-alert v-else type="info" variant="tonal">暂无建议稿。完成学科映射与诊断后可以生成。</v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.alerttime-sync-view {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 28px 48px;
}

.page-header h1 {
  font-size: 24px;
  margin: 0 0 6px;
}

.page-header .subtitle {
  color: rgba(0, 0, 0, 0.6);
  margin: 0 0 18px;
  font-size: 14px;
}

.qr-image {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  width: 220px;
  height: 220px;
}

.metric-card {
  height: 100%;
}

.metric-value {
  font-size: 20px;
  font-weight: 600;
}

.metric-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.6);
  margin: 2px 0;
}

.metric-sub {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.proposal-rationale {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
