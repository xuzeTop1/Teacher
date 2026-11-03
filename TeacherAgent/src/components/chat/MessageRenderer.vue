<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue"
import { renderMessageContent } from "../../services/rendering/messageRenderer"

const props = withDefaults(defineProps<{
  content: string
  streaming?: boolean
}>(), {
  streaming: false
})

const rendered = ref("")
const isLoading = ref(true)

let throttleTimer: ReturnType<typeof setTimeout> | null = null
let renderVersion = 0
const renderError = ref(false)

async function doRender(content: string, streaming: boolean, version: number) {
  if (!rendered.value) isLoading.value = true
  try {
    const html = await renderMessageContent(content, { streaming })
    if (version !== renderVersion) return
    rendered.value = html
    renderError.value = false
  } catch {
    if (version !== renderVersion) return
    renderError.value = true
  } finally {
    if (version === renderVersion) isLoading.value = false
  }
}

watch(
  [() => props.content, () => props.streaming],
  ([nextContent, streaming]) => {
    // Invalidate outstanding work as soon as props change, not when it settles.
    const version = ++renderVersion
    if (throttleTimer) clearTimeout(throttleTimer)
    if (streaming) {
      throttleTimer = setTimeout(() => {
        throttleTimer = null
        void doRender(nextContent, streaming ?? false, version)
      }, 100)
    } else {
      throttleTimer = null
      void doRender(nextContent, false, version)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  ++renderVersion
  if (throttleTimer) clearTimeout(throttleTimer)
})
</script>

<template>
  <div v-if="isLoading" class="rendered-message rendered-message-loading">渲染中...</div>
  <div v-else-if="renderError" class="rendered-message">{{ content }}</div>
  <div v-else class="rendered-message" v-html="rendered" />
</template>
