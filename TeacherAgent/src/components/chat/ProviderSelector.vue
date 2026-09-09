<script setup lang="ts">
import { computed } from "vue"
import { useAppStore } from "../../stores/app"
import type { StoredProviderConfig } from "../../services/tauri/commands"

const appStore = useAppStore()

const activeConfig = computed(() => appStore.activeProviderConfig)
const providers = computed(() => appStore.providerConfigs)

const displayText = computed(() => {
  const config = activeConfig.value
  if (!config) return "未配置模型"
  return `${config.name} / ${config.model}`
})

function selectProvider(provider: StoredProviderConfig) {
  appStore.setActiveProviderId(provider.id)
}
</script>

<template>
  <div class="provider-selector">
    <div v-if="providers.length > 1" class="provider-dropdown">
      <select
        class="provider-select"
        aria-label="切换模型"
        :value="activeConfig?.id ?? ''"
        @change="selectProvider(providers.find(p => p.id === ($event.target as HTMLSelectElement).value) ?? providers[0])"
      >
        <option
          v-for="provider in providers"
          :key="provider.id"
          :value="provider.id"
        >
          {{ provider.name }} / {{ provider.model }}
        </option>
      </select>
    </div>
    <span v-else class="provider-label">{{ displayText }}</span>
  </div>
</template>

<style scoped>
.provider-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-label {
  font-size: 0.85em;
  color: #666;
}

.provider-select {
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85em;
  background: white;
  cursor: pointer;
}

.provider-select:focus {
  outline: none;
  border-color: var(--v-primary-base, #4a90d9);
}
</style>
