<script setup lang="ts">
import { computed, onMounted, ref, watch, onActivated } from "vue"
import { useRoute } from "vue-router"
import {
  initializeDatabase,
  pingBackend,
  runLocalSmokeCheck,
  checkOllamaStatus,
  startOllamaEngine
} from "../services/tauri/commands"
import { useAppStore } from "../stores/app"
import type { SubjectCode } from "../types/learning"
import DocumentImportPanel from "../components/settings/DocumentImportPanel.vue"
import ProviderPanel from "../components/settings/ProviderPanel.vue"
import KnowledgeBasePanel from "../components/settings/KnowledgeBasePanel.vue"
import CloudPrivacyPanel from "../components/settings/CloudPrivacyPanel.vue"
import CustomSubjectBuilder from "../components/settings/CustomSubjectBuilder.vue"

const appStore = useAppStore()
const route = useRoute()

// 学科选项从 appStore.allSubjects 派生（内置 + 自建）
const subjectOptions = computed(() =>
  appStore.allSubjects.map(s => ({ title: s.name, value: s.code }))
)

const pingStatus = ref<"idle" | "success" | "error">("idle")
const pingMessage = ref("")
const databaseStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const databaseMessage = ref("")
const smokeStatus = ref<"idle" | "loading" | "success" | "error">("idle")
const smokeMessage = ref("")

// Ollama 状态
const ollamaRunning = ref(false)
const ollamaMessage = ref("检查中...")
const ollamaAction = ref<"idle" | "loading" | "error">("idle")
const ollamaError = ref("")

// Alert visibility (independent of status)
const showPingAlert = ref(true)
const showDatabaseAlert = ref(true)
const showSmokeAlert = ref(true)
const showOllamaErrorAlert = ref(true)

const ollamaActionLabel = computed(() => {
  if (ollamaAction.value === "loading") return "处理中..."
  return ollamaRunning.value ? "重启本地引擎" : "启动本地引擎"
})


onMounted(() => {
  scrollToTarget()
})

onActivated(() => {
  scrollToTarget()
})

// 如果已在 Settings 页，query 参数变化时也要滚动
watch(() => route.query.scrollTo, () => {
  scrollToTarget()
})

function scrollToTarget() {
  const scrollTo = route.query.scrollTo
  if (typeof scrollTo === "string" && scrollTo) {
    requestAnimationFrame(() => {
      const el = document.getElementById(scrollTo)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    })
  }
}

async function testIpc() {
  showPingAlert.value = true
  pingStatus.value = "idle"
  pingMessage.value = ""

  try {
    const result = await pingBackend()
    pingStatus.value = "success"
    pingMessage.value = `Tauri command 返回：${result}`
  } catch (error) {
    pingStatus.value = "error"
    pingMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function setupDatabase() {
  showDatabaseAlert.value = true
  databaseStatus.value = "loading"
  databaseMessage.value = "正在初始化本地 SQLite 数据库..."

  try {
    const status = await initializeDatabase()
    appStore.setDatabaseStatus(status)
    databaseStatus.value = "success"
    databaseMessage.value = [
      status.migrated ? "已创建并执行 migration。" : "数据库已存在，migration 已是最新。",
      `路径：${status.databasePath}`,
      `已应用：${status.appliedMigrations.join(", ") || "无"}`,
      `user_version：${status.userVersion}`
    ].join("\n")
  } catch (error) {
    databaseStatus.value = "error"
    databaseMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function runSmokeCheck() {
  showSmokeAlert.value = true
  smokeStatus.value = "loading"
  smokeMessage.value = "正在运行本地自检..."

  try {
    const result = await runLocalSmokeCheck()
    appStore.setDatabaseStatus(result.database)
    smokeStatus.value = result.messageRoundtrip && result.rollbackVerified ? "success" : "error"
    smokeMessage.value = [
      `ping：${result.ping}`,
      `数据库：${result.database.databasePath}`,
      `默认会话：${result.conversationId}`,
      `消息写读：${result.messageRoundtrip ? "通过" : "失败"}`,
      `事务回滚：${result.rollbackVerified ? "通过" : "失败"}`
    ].join("\n")
  } catch (error) {
    smokeStatus.value = "error"
    smokeMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function refreshOllamaStatus() {
  try {
    const status = await checkOllamaStatus()
    ollamaRunning.value = status.running
    ollamaMessage.value = status.message
  } catch {
    ollamaRunning.value = false
    ollamaMessage.value = "无法检查 Ollama 状态"
  }
}


async function handleOllamaAction() {
  showOllamaErrorAlert.value = true
  ollamaAction.value = "loading"
  ollamaError.value = ""

  try {
    const status = await startOllamaEngine()
    ollamaRunning.value = status.running
    ollamaMessage.value = status.message
    if (!status.running) {
      ollamaAction.value = "error"
      ollamaError.value = status.message
    } else {
      ollamaAction.value = "idle"
    }
  } catch (error) {
    ollamaAction.value = "error"
    ollamaError.value = error instanceof Error ? error.message : String(error)
    ollamaRunning.value = false
  }
}

// 启动时检查 Ollama 状态
refreshOllamaStatus()
</script>

<template>
  <main class="settings-view">
    <header class="settings-hero">
      <div class="settings-hero-main">
        <p class="eyebrow">Control Center</p>
        <h1>学习系统设置</h1>
        <p>管理模型、本地能力、知识库与私有资料，让 TeacherAgent 保持可靠、清爽、可长期使用。</p>
      </div>
      <div class="settings-hero-status">
        <div>
          <span>当前学科</span>
          <strong>{{ subjectOptions.find(o => o.value === appStore.selectedSubject)?.title }}</strong>
        </div>
        <div>
          <span>本地引擎</span>
          <strong>{{ ollamaRunning ? "运行中" : "未运行" }}</strong>
        </div>
      </div>
    </header>

    <div class="settings-console-grid">
      <section class="settings-console-primary">
        <ProviderPanel />
        <KnowledgeBasePanel />
        <CustomSubjectBuilder />
      </section>

      <aside class="settings-console-side">
        <section class="settings-panel settings-side-panel">
          <h2>教学偏好</h2>
          <label class="field-label">
            <span>当前学科</span>
            <select
              class="field-input"
              :value="appStore.selectedSubject"
              @change="appStore.setSelectedSubject(($event.target as HTMLSelectElement).value as SubjectCode)"
            >
              <option v-for="option in subjectOptions" :key="option.value" :value="option.value">
                {{ option.title }}
              </option>
            </select>
          </label>
          <p class="panel-copy">不同学科会使用不同导师风格和提示节奏。</p>
        </section>

        <section class="settings-panel settings-side-panel">
          <h2>桌面端 IPC</h2>
          <button class="action-button action-button-secondary" type="button" @click="testIpc">
            <v-icon icon="mdi-lan-check" size="20" />
            <span>测试 ping</span>
          </button>
          <v-alert
            v-if="pingStatus !== 'idle'"
            v-model="showPingAlert"
            closable
            class="mt-4"
            :type="pingStatus === 'success' ? 'success' : 'error'"
            variant="tonal"
          >
            {{ pingMessage }}
          </v-alert>
        </section>

        <section class="settings-panel settings-side-panel">
          <h2>本地数据库</h2>
          <div class="settings-actions">
            <button
              class="action-button action-button-secondary"
              type="button"
              :disabled="databaseStatus === 'loading'"
              @click="setupDatabase"
            >
              <v-icon icon="mdi-database-check-outline" size="20" />
              <span>{{ databaseStatus === "loading" ? "初始化中" : "初始化 SQLite" }}</span>
            </button>
            <button
              class="action-button action-button-secondary"
              type="button"
              :disabled="smokeStatus === 'loading'"
              @click="runSmokeCheck"
            >
              <v-icon icon="mdi-clipboard-check-outline" size="20" />
              <span>{{ smokeStatus === "loading" ? "自检中" : "运行自检" }}</span>
            </button>
          </div>
          <v-alert
            v-if="databaseStatus !== 'idle'"
            v-model="showDatabaseAlert"
            closable
            class="mt-4 db-alert"
            :type="databaseStatus === 'success' ? 'success' : databaseStatus === 'error' ? 'error' : 'info'"
            variant="tonal"
          >
            {{ databaseMessage }}
          </v-alert>
          <v-alert
            v-if="smokeStatus !== 'idle'"
            v-model="showSmokeAlert"
            closable
            class="mt-4 db-alert"
            :type="smokeStatus === 'success' ? 'success' : smokeStatus === 'error' ? 'error' : 'info'"
            variant="tonal"
          >
            {{ smokeMessage }}
          </v-alert>
        </section>

        <section class="settings-panel settings-side-panel">
          <h2>本地大模型</h2>
          <div class="ollama-status">
            <span :class="['status-indicator', ollamaRunning ? 'status-on' : 'status-off']"></span>
            <span class="status-text">{{ ollamaMessage }}</span>
          </div>
          <div class="settings-actions">
            <button
              class="action-button action-button-secondary"
              type="button"
              :disabled="ollamaAction === 'loading'"
              @click="handleOllamaAction"
            >
              <v-icon icon="mdi-server-network" size="20" />
              <span>{{ ollamaActionLabel }}</span>
            </button>
            <button
              class="action-button action-button-secondary"
              type="button"
              :disabled="ollamaAction === 'loading'"
              @click="refreshOllamaStatus"
            >
              <v-icon icon="mdi-refresh" size="20" />
              <span>刷新</span>
            </button>
          </div>
          <v-alert
            v-if="ollamaAction === 'error'"
            v-model="showOllamaErrorAlert"
            closable
            class="mt-4"
            type="error"
            variant="tonal"
          >
            {{ ollamaError }}
          </v-alert>
        </section>
      </aside>
    </div>

    <section class="settings-panel document-console-panel">
      <DocumentImportPanel />
    </section>

    <section class="settings-panel cloud-privacy-section">
      <CloudPrivacyPanel />
    </section>
  </main>
</template>

<style scoped>
.settings-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 28px;
  border: 1px solid rgba(214, 207, 193, 0.86);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(13, 50, 100, 0.08), transparent 34%),
    rgba(255, 253, 248, 0.92);
  box-shadow: 0 16px 34px rgba(44, 38, 27, 0.07);
}

.settings-hero-main h1 {
  margin: 0;
  color: var(--atlas-ink);
  font-family: Georgia, "Times New Roman", "Noto Serif SC", serif;
  font-size: 32px;
}

.settings-hero-main p:last-child {
  max-width: 620px;
  margin: 8px 0 0;
  color: var(--atlas-muted);
  line-height: 1.65;
}

.settings-hero-status {
  display: flex;
  gap: 10px;
}

.settings-hero-status div {
  display: grid;
  gap: 5px;
  min-width: 118px;
  padding: 12px;
  border: 1px solid rgba(214, 207, 193, 0.82);
  border-radius: 8px;
  background: #fffdf8;
}

.settings-hero-status span {
  color: var(--atlas-soft);
  font-size: 12px;
  font-weight: 700;
}

.settings-hero-status strong {
  color: var(--atlas-ink);
  font-size: 15px;
}

.settings-console-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
  align-items: start;
}

.settings-console-primary,
.settings-console-side {
  display: grid;
  gap: 18px;
}

.settings-console-side {
  position: sticky;
  top: 20px;
}

.settings-side-panel {
  padding: 20px;
}

.settings-side-panel h2 {
  font-size: 18px;
}

.document-console-panel {
  padding: 0;
  overflow: hidden;
}

.document-console-panel :deep(.document-import-panel) {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.ollama-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border: 1px solid rgba(214, 207, 193, 0.78);
  background: #fffdf8;
  border-radius: 8px;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-on {
  background: #4caf50;
  box-shadow: 0 0 4px rgba(76, 175, 80, 0.5);
}

.status-off {
  background: #9e9e9e;
}

.status-text {
  font-size: 0.9rem;
  color: #333;
}

@media (max-width: 1120px) {
  .settings-console-grid {
    grid-template-columns: 1fr;
  }

  .settings-console-side {
    position: static;
  }
}

@media (max-width: 760px) {
  .settings-hero,
  .settings-hero-status {
    flex-direction: column;
    align-items: stretch;
  }
}

</style>
