<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { renderMessageContent } from "../../services/rendering/messageRenderer"

const props = withDefaults(defineProps<{
  content: string
  streaming?: boolean
}>(), {
  streaming: false
})

const rendered = ref("")
const isLoading = ref(true)

const source = computed(() => props.content)

let throttleTimer: ReturnType<typeof setTimeout> | null = null
let pendingContent: string | null = null

async function doRender(content: string) {
  if (!rendered.value) isLoading.value = true
  rendered.value = await renderMessageContent(content, { streaming: props.streaming })
  isLoading.value = false
}

watch(
  source,
  (nextContent) => {
    if (props.streaming) {
      pendingContent = nextContent
      if (!throttleTimer) {
        throttleTimer = setTimeout(async () => {
          throttleTimer = null
          if (pendingContent !== null) {
            const toRender = pendingContent
            pendingContent = null
            await doRender(toRender)
          }
        }, 100)
      }
    } else {
      void doRender(nextContent)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="isLoading" class="rendered-message rendered-message-loading">渲染中...</div>
  <div v-else class="rendered-message" v-html="rendered" />
</template>
