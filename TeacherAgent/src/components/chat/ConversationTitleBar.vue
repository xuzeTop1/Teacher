<script setup lang="ts">
defineProps<{
  title: string
  isGenerating: boolean
}>()

const emit = defineEmits<{
  regenerate: []
}>()
</script>

<template>
  <div class="conversation-title-bar">
    <span class="conversation-title-text">{{ title || '对话' }}</span>
    <button
      class="icon-action-button"
      type="button"
      :disabled="isGenerating"
      aria-label="重新生成标题"
      title="重新生成标题"
      @click="emit('regenerate')"
    >
      <v-icon :icon="isGenerating ? 'mdi-loading mdi-spin' : 'mdi-refresh'" size="18" />
    </button>
  </div>
</template>

<style scoped>
.conversation-title-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conversation-title-text {
  font-size: 0.95rem;
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}
</style>
