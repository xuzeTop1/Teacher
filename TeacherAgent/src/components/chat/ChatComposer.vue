<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue"
import type { ChatAttachment } from "../../types/chat"
import { canSendDraft, getSendRequestAction, isSendButtonDisabled } from "./chatComposerState"

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"]

const props = defineProps<{
  modelValue: string
  isSending: boolean
  isAttaching?: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
  send: [attachments: ChatAttachment[]]
  attach: []
}>()

const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const pendingAttachments = ref<ChatAttachment[]>([])

const canSend = computed(() => canSendDraft(props.modelValue, props.isSending, pendingAttachments.value.length))
const isSendDisabled = computed(() => isSendButtonDisabled(props.isSending))

function autoResize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = el.scrollHeight + "px"
}

watch(() => props.modelValue, (newVal) => {
  if (!newVal) {
    void nextTick(autoResize)
  }
})

onMounted(() => {
  void nextTick(autoResize)
  window.addEventListener("resize", autoResize)
})

onBeforeUnmount(() => {
  window.removeEventListener("resize", autoResize)
})

function updateDraft(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit("update:modelValue", target.value)
  autoResize()
}

function requestSend() {
  const action = getSendRequestAction(props.modelValue, props.isSending, pendingAttachments.value.length)
  if (action === "blocked_sending") return
  if (action === "focus_input") {
    inputEl.value?.focus()
    return
  }
  const attachments = [...pendingAttachments.value]
  pendingAttachments.value = []
  emit("send", attachments)
}

function requestAttach() {
  if (props.isSending || props.isAttaching) return
  emit("attach")
}

function openImagePicker() {
  if (props.isSending) return
  fileInputEl.value?.click()
}

function handleImageFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    alert("不支持的图片格式，请使用 PNG、JPEG 或 WebP 格式。")
    return
  }
  if (file.size > MAX_IMAGE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
    alert(`图片文件过大（${sizeMB}MB），请压缩后重试。建议不超过 10MB。`)
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    pendingAttachments.value.push({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "image",
      mimeType: file.type,
      name: file.name || "Pasted Image",
      size: file.size,
      dataUrl
    })
  }
  reader.readAsDataURL(file)
}

function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files) return

  for (const file of Array.from(files)) {
    handleImageFile(file)
  }

  // Reset input so re-selecting the same file triggers change
  input.value = ""
}

function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return

  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile()
      if (file) {
        handleImageFile(file)
      }
    }
  }
}

function removeAttachment(id: string) {
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id)
}
</script>

<template>
  <footer class="composer">
    <!-- Thumbnail preview strip -->
    <div v-if="pendingAttachments.length" class="composer-attachments">
      <div v-for="att in pendingAttachments" :key="att.id" class="composer-attachment-thumb">
        <img :src="att.dataUrl" :alt="att.name ?? '图片'" class="composer-attachment-img" />
        <button
          type="button"
          class="composer-attachment-remove"
          title="移除图片"
          @click="removeAttachment(att.id)"
        >
          <v-icon icon="mdi-close" size="14" />
        </button>
      </div>
    </div>

    <div class="composer-input-wrapper">
      <button
        class="composer-attach-button"
        type="button"
        :disabled="isSending || isAttaching"
        :title="isAttaching ? '正在导入资料' : '导入本地资料'"
        @click="requestAttach"
      >
        <v-icon :icon="isAttaching ? 'mdi-loading' : 'mdi-plus'" size="20" :class="{ 'mdi-spin': isAttaching }" />
      </button>

      <button
        class="composer-image-button"
        type="button"
        :disabled="isSending"
        title="添加图片"
        @click="openImagePicker"
      >
        <v-icon icon="mdi-image" size="20" />
      </button>

      <input
        ref="fileInputEl"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        class="composer-file-input"
        @change="onImageSelected"
      />
      
      <textarea
        ref="inputEl"
        class="composer-input"
        :value="modelValue"
        rows="1"
        placeholder="输入学习问题或粘贴题目图片，Ctrl + Enter 发送..."
        @input="updateDraft"
        @keydown.ctrl.enter.prevent="requestSend"
        @paste="onPaste"
      />
      
      <div class="composer-actions">
        <button
          class="composer-send-button"
          :class="{ 'composer-send-button-ready': canSend }"
          type="button"
          :disabled="isSendDisabled"
          :title="canSend ? '发送消息' : '先输入学习问题'"
          @click="requestSend"
        >
          <v-icon icon="mdi-arrow-up" size="18" />
        </button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.composer-attachments {
  display: flex;
  gap: 8px;
  padding: 8px 12px 0;
  overflow-x: auto;
}

.composer-attachment-thumb {
  position: relative;
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.composer-attachment-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.composer-attachment-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
  padding: 0;
}

.composer-image-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.54);
  transition: background 0.15s;
}

.composer-image-button:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
}

.composer-image-button:disabled {
  opacity: 0.38;
  cursor: default;
}

.composer-file-input {
  display: none;
}
</style>
