<script setup lang="ts">
import { computed, ref, watch } from "vue"

import { runCodeRunner } from "../../services/tools/codeRunner"
import type { CodeRunnerOutput } from "../../types/tool"

const emit = defineEmits<{
  close: []
}>()

const DRAFT_STORAGE_KEY = "teacher-agent-python-playground-draft"
const STDIN_STORAGE_KEY = "teacher-agent-python-playground-stdin"
const trustedRunnerAvailable =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_TRUSTED_CODE_RUNNER === "1"
const STARTER_CODE = [
  "def greet(name):",
  "    return f\"Hello, {name}!\"",
  "",
  "print(greet(\"TeacherAgent\"))"
].join("\n")

function loadDraft(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

const code = ref(loadDraft(DRAFT_STORAGE_KEY, STARTER_CODE))
const stdin = ref(loadDraft(STDIN_STORAGE_KEY, ""))
const isRunning = ref(false)
const result = ref<CodeRunnerOutput | null>(null)
const runnerError = ref("")

watch(code, (value) => {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, value)
  } catch {
    // keep the editor usable when storage is unavailable
  }
})

watch(stdin, (value) => {
  try {
    localStorage.setItem(STDIN_STORAGE_KEY, value)
  } catch {
    // keep the editor usable when storage is unavailable
  }
})

const statusLabel = computed(() => {
  if (isRunning.value) return "运行中"
  if (runnerError.value) return "执行失败"
  if (!result.value) return "等待运行"
  return result.value.exitCode === 0 ? "运行完成" : `退出码 ${result.value.exitCode}`
})

const statusTone = computed(() => {
  if (isRunning.value) return "running"
  if (runnerError.value || (result.value && result.value.exitCode !== 0)) return "error"
  if (result.value) return "success"
  return "idle"
})

const outputText = computed(() => {
  if (runnerError.value) return runnerError.value
  if (!result.value) return "点击“运行代码”后，stdout 和 stderr 会显示在这里。"

  const sections: string[] = []
  if (result.value.stdout) sections.push(result.value.stdout.trimEnd())
  if (result.value.stderr) sections.push(`[stderr]\n${result.value.stderr.trimEnd()}`)
  if (!sections.length) sections.push("（程序没有输出）")
  sections.push(`\n运行耗时：${result.value.runtimeMs} ms`)
  return sections.join("\n\n")
})

async function runCode() {
  if (!trustedRunnerAvailable) {
    runnerError.value =
      "当前环境未启用安全隔离，不能执行不受信代码。仅可在 Debug 构建中显式启用可信开发模式。"
    return
  }
  if (!code.value.trim() || isRunning.value) return

  isRunning.value = true
  result.value = null
  runnerError.value = ""

  try {
    const execution = await runCodeRunner({
      code: code.value,
      language: "python",
      stdin: stdin.value,
      timeoutMs: 5000
    })

    if (!execution.ok || !execution.data) {
      runnerError.value = execution.error ?? "Python 代码执行失败。"
      return
    }
    result.value = execution.data
  } catch (error) {
    runnerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isRunning.value = false
  }
}

function resetEditor() {
  code.value = STARTER_CODE
  stdin.value = ""
  result.value = null
  runnerError.value = ""
}

function insertIndent(event: KeyboardEvent) {
  if (event.key !== "Tab") return
  event.preventDefault()

  const textarea = event.currentTarget as HTMLTextAreaElement
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  code.value = `${code.value.slice(0, start)}    ${code.value.slice(end)}`
  requestAnimationFrame(() => {
    textarea.selectionStart = textarea.selectionEnd = start + 4
  })
}
</script>

<template>
  <section class="python-playground" aria-label="Python 练习台">
    <header class="playground-header">
      <div>
        <div class="playground-title-row">
          <v-icon icon="mdi-language-python" size="20" />
          <h2>Python 练习台</h2>
          <span class="language-badge">Python only</span>
        </div>
        <p v-if="trustedRunnerAvailable">可信开发模式已显式启用；教学护栏不是安全沙箱，禁止运行不受信代码。</p>
        <p v-else>安全隔离尚未实现，代码执行默认关闭；普通学生输入不会被执行。</p>
      </div>
      <div class="playground-actions">
        <button class="playground-button" type="button" :disabled="isRunning" @click="resetEditor">
          重置
        </button>
        <button class="playground-button playground-button-primary" type="button" :disabled="isRunning || !code.trim() || !trustedRunnerAvailable" @click="runCode">
          <v-icon :icon="isRunning ? 'mdi-loading' : 'mdi-play'" :class="{ spin: isRunning }" size="17" />
          {{ isRunning ? "运行中" : "运行代码" }}
        </button>
        <button class="playground-close" type="button" title="收起 Python 练习台" @click="emit('close')">×</button>
      </div>
    </header>

    <div class="playground-grid">
      <div class="editor-pane">
        <label for="python-code-editor">代码</label>
        <textarea
          id="python-code-editor"
          v-model="code"
          aria-label="Python 代码编辑器"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          @keydown="insertIndent"
          @keydown.ctrl.enter.prevent="runCode"
        />
        <label class="stdin-label" for="python-stdin">标准输入（可选）</label>
        <textarea
          id="python-stdin"
          v-model="stdin"
          class="stdin-editor"
          aria-label="Python 标准输入"
          placeholder="每行一项输入内容"
          spellcheck="false"
        />
      </div>

      <div class="output-pane">
        <div class="output-header">
          <span>运行结果</span>
          <span class="status-badge" :class="`status-${statusTone}`">{{ statusLabel }}</span>
        </div>
        <pre :class="{ 'output-error': statusTone === 'error' }">{{ outputText }}</pre>
      </div>
    </div>

    <footer class="playground-footer">
      <span>Ctrl + Enter 运行</span>
      <span>{{ trustedRunnerAvailable ? "超时 5 秒 · 仅可信本地代码" : "生产默认关闭 · 未提供 OS 级隔离" }}</span>
    </footer>
  </section>
</template>

<style scoped>
.python-playground {
  flex: 0 0 auto;
  width: calc(100% - 32px);
  max-width: 980px;
  margin: 14px auto 0;
  overflow: hidden;
  border: 1px solid #b9c9dd;
  border-radius: 10px;
  background: #f8fafc;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}

.playground-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 14px;
  border-bottom: 1px solid #d7e0eb;
  background: #eef4fb;
}

.playground-title-row,
.playground-actions,
.output-header,
.playground-footer {
  display: flex;
  align-items: center;
}

.playground-title-row {
  gap: 8px;
  color: #15385f;
}

.playground-title-row h2 {
  margin: 0;
  font-size: 15px;
}

.language-badge,
.status-badge {
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
}

.language-badge {
  padding: 3px 7px;
  background: #dceafe;
  color: #245a96;
}

.playground-header p {
  margin: 5px 0 0;
  color: #607086;
  font-size: 11px;
}

.playground-actions {
  flex: 0 0 auto;
  gap: 7px;
}

.playground-button,
.playground-close {
  border: 1px solid #b7c7da;
  border-radius: 7px;
  background: #fff;
  color: #29435f;
  cursor: pointer;
  font-weight: 700;
}

.playground-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 5px 10px;
  font-size: 12px;
}

.playground-button-primary {
  border-color: #2366a8;
  background: #2366a8;
  color: #fff;
}

.playground-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.playground-close {
  width: 32px;
  height: 32px;
  font-size: 18px;
}

.playground-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
  min-height: 230px;
}

.editor-pane,
.output-pane {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.editor-pane {
  padding: 10px;
  border-right: 1px solid #d7e0eb;
  background: #fff;
}

.editor-pane label,
.output-header {
  color: #455a73;
  font-size: 11px;
  font-weight: 800;
}

.editor-pane textarea,
.output-pane pre {
  margin: 6px 0 0;
  border-radius: 7px;
  background: #111827;
  color: #e5edf7;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  tab-size: 4;
}

.editor-pane textarea {
  min-height: 118px;
  padding: 10px;
  resize: vertical;
  border: 1px solid #27364a;
  outline: none;
}

.editor-pane textarea:focus {
  border-color: #5aa2ea;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.16);
}

.stdin-label {
  margin-top: 8px;
}

.editor-pane .stdin-editor {
  min-height: 42px;
  max-height: 84px;
  background: #182235;
}

.output-pane {
  padding: 10px;
  background: #f6f8fb;
}

.output-header {
  justify-content: space-between;
  min-height: 22px;
}

.status-badge {
  padding: 3px 8px;
}

.status-idle {
  background: #e5e7eb;
  color: #596579;
}

.status-running {
  background: #dbeafe;
  color: #1d5d9f;
}

.status-success {
  background: #dcfce7;
  color: #166534;
}

.status-error {
  background: #fee2e2;
  color: #991b1b;
}

.output-pane pre {
  flex: 1;
  min-height: 166px;
  max-height: 230px;
  padding: 10px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.output-pane pre.output-error {
  color: #fecaca;
}

.playground-footer {
  justify-content: space-between;
  gap: 12px;
  padding: 7px 12px;
  border-top: 1px solid #d7e0eb;
  color: #6b7789;
  font-size: 10px;
}

.spin {
  animation: playground-spin 0.9s linear infinite;
}

@keyframes playground-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .playground-header,
  .playground-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .playground-grid {
    grid-template-columns: 1fr;
  }

  .editor-pane {
    border-right: 0;
    border-bottom: 1px solid #d7e0eb;
  }
}
</style>
