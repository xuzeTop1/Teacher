<script setup lang="ts">
import { onErrorCaptured, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { useAlertTimeSyncStore } from "./stores/alertTimeSync"

const unverifiedSidecarDevelopmentMode =
  import.meta.env.DEV && import.meta.env.VITE_ALLOW_UNVERIFIED_SIDECARS === "1"

const router = useRouter()
const pageError = ref<string | null>(null)
const syncStore = useAlertTimeSyncStore()

onErrorCaptured((err) => {
  console.error("[App ErrorBoundary]", err)
  pageError.value = String(err instanceof Error ? err.message : err)
  return false
})

router.afterEach(() => {
  pageError.value = null
})

function resetPageError() {
  pageError.value = null
  window.location.reload()
}

onMounted(async () => {
  try {
    await syncStore.init()
    // Starting the LAN listener requires the user's explicit settings action.
  } catch (err) {
    console.warn("[Sync] Failed to load sync status:", err)
  }
})
</script>

<template>
  <v-app>
    <div
      v-if="unverifiedSidecarDevelopmentMode"
      class="security-development-banner"
      role="alert"
    >
      开发模式：Sidecar 完整性校验已显式绕过。此构建禁止分发。
    </div>
    <div class="app-shell">
      <nav class="app-rail" aria-label="全局导航">
        <div class="rail-brand">
          <div class="brand-mark" title="TeacherAgent">T</div>
          <div class="brand-copy">
            <strong>TeacherAgent</strong>
            <span>AI 学习伙伴</span>
          </div>
        </div>

        <div class="rail-nav-group">
          <RouterLink class="rail-nav-item" to="/" title="对话辅导" aria-label="对话辅导">
            <v-icon icon="mdi-chat-processing-outline" size="24" />
            <span>对话辅导</span>
          </RouterLink>
          <RouterLink class="rail-nav-item" to="/practice" title="练习" aria-label="练习">
            <v-icon icon="mdi-pencil-ruler" size="24" />
            <span>练习</span>
          </RouterLink>
          <RouterLink class="rail-nav-item" to="/dashboard" title="仪表盘" aria-label="仪表盘">
            <v-icon icon="mdi-chart-box-outline" size="24" />
            <span>仪表盘</span>
          </RouterLink>
          <RouterLink class="rail-nav-item" to="/knowledge-graph" title="知识图谱" aria-label="知识图谱">
            <v-icon icon="mdi-graph-outline" size="24" />
            <span>知识图谱</span>
          </RouterLink>
          <RouterLink class="rail-nav-item" to="/alerttime-sync" title="AlertTime 同步" aria-label="AlertTime 同步">
            <v-icon icon="mdi-lan-connect" size="24" />
            <span>AlertTime 同步</span>
          </RouterLink>
        </div>

        <div class="rail-footer">
          <div class="rail-plan-card">
            <span>旗舰版</span>
            <strong>长期学习空间</strong>
          </div>
          <RouterLink class="rail-nav-item" to="/settings" title="设置" aria-label="设置">
            <v-icon icon="mdi-cog-outline" size="24" />
            <span>设置</span>
          </RouterLink>
        </div>
      </nav>

      <main class="app-content">
        <div v-if="pageError" class="page-error-boundary" role="alert">
          <div class="page-error-card">
            <v-icon icon="mdi-alert-circle-outline" color="#ef4444" size="48" />
            <h2>页面加载或运行出现异常</h2>
            <p class="page-error-message">{{ pageError }}</p>
            <div class="page-error-actions">
              <button class="error-action-btn primary" type="button" @click="resetPageError">
                刷新重试
              </button>
              <RouterLink class="error-action-btn secondary" to="/">
                返回对话
              </RouterLink>
            </div>
          </div>
        </div>
        <router-view v-else v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </v-app>
</template>

<style scoped>
.security-development-banner {
  padding: 7px 16px;
  border-bottom: 1px solid #b45309;
  background: #fff7ed;
  color: #9a3412;
  font-size: 12px;
  font-weight: 800;
  text-align: center;
}

.page-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px;
  background: var(--bg-surface, #fcfaf6);
}

.page-error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 480px;
  padding: 36px 32px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  border: 1px solid #fee2e2;
  text-align: center;
}

.page-error-card h2 {
  margin: 16px 0 8px;
  font-size: 1.25rem;
  font-weight: 700;
  color: #1f2937;
}

.page-error-message {
  margin-bottom: 24px;
  font-size: 0.9rem;
  color: #6b7280;
  line-height: 1.5;
  word-break: break-word;
}

.page-error-actions {
  display: flex;
  gap: 12px;
}

.error-action-btn {
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.2s ease;
}

.error-action-btn.primary {
  background: #2563eb;
  color: #ffffff;
  border: none;
}

.error-action-btn.primary:hover {
  background: #1d4ed8;
}

.error-action-btn.secondary {
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
}

.error-action-btn.secondary:hover {
  background: #e5e7eb;
}
</style>
