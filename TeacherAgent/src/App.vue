<script setup lang="ts">
const unverifiedSidecarDevelopmentMode =
  import.meta.env.DEV && import.meta.env.VITE_ALLOW_UNVERIFIED_SIDECARS === "1"
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
        <router-view v-slot="{ Component }">
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
</style>
