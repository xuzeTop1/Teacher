<script setup lang="ts">
import { ref } from "vue"
import type { LocalConversation } from "../../services/tauri/commands"

defineProps<{
  conversations: LocalConversation[]
  activeConversationId: string
  isSending: boolean
}>()

const emit = defineEmits<{
  create: []
  select: [conversation: LocalConversation]
  archive: [conversationId: string]
  unarchive: [conversationId: string]
  delete: [conversationId: string]
  "regenerate-title": [conversationId: string]
}>()

const activeTab = ref<"active" | "archived">("active")
const openMenuId = ref<string | null>(null)

function formatConversationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function toggleMenu(conversationId: string, event: Event) {
  event.stopPropagation()
  openMenuId.value = openMenuId.value === conversationId ? null : conversationId
}

function closeMenu() {
  openMenuId.value = null
}

function handleAction(action: string, conversationId: string) {
  closeMenu()
  switch (action) {
    case "archive":
      emit("archive", conversationId)
      break
    case "unarchive":
      emit("unarchive", conversationId)
      break
    case "delete":
      emit("delete", conversationId)
      break
    case "regenerate":
      emit("regenerate-title", conversationId)
      break
  }
}

function handleConversationKeydown(event: KeyboardEvent, conversation: LocalConversation) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    emit("select", conversation)
  }
}
</script>

<template>
  <aside class="conversation-panel" aria-label="会话历史" @mouseleave="closeMenu">
    <div class="conversation-panel-head">
      <span>会话</span>
      <button
        class="action-button action-button-primary action-button-small"
        type="button"
        aria-label="新建会话"
        @click="emit('create')"
      >
        + 新建
      </button>
    </div>

    <!-- Tab 切换 -->
    <div class="conversation-tabs">
      <button
        :class="['tab-button', { 'tab-active': activeTab === 'active' }]"
        @click="activeTab = 'active'"
      >
        活跃
      </button>
      <button
        :class="['tab-button', { 'tab-active': activeTab === 'archived' }]"
        @click="activeTab = 'archived'"
      >
        已归档
      </button>
    </div>

    <div class="conversation-list">
      <template v-if="activeTab === 'active'">
        <div
          v-for="conversation in conversations.filter(c => c.status === 'active')"
          :key="conversation.conversationId"
          class="conversation-item-wrapper"
        >
          <div
            class="conversation-item"
            :class="{ 'conversation-item-active': conversation.conversationId === activeConversationId }"
            role="button"
            tabindex="0"
            @click="emit('select', conversation)"
            @keydown="handleConversationKeydown($event, conversation)"
          >
            <div class="conversation-item-content">
              <span class="conversation-title">{{ conversation.title }}</span>
              <span class="conversation-meta">{{ formatConversationTime(conversation.updatedAt) }}</span>
            </div>
            <button
              class="menu-trigger"
              type="button"
              aria-label="更多操作"
              @click="toggleMenu(conversation.conversationId, $event)"
            >
              ⋮
            </button>
          </div>
          <!-- 下拉菜单 -->
          <div v-if="openMenuId === conversation.conversationId" class="conversation-menu">
            <button class="menu-item" @click="handleAction('regenerate', conversation.conversationId)">🔄 重新生成标题</button>
            <button class="menu-item" @click="handleAction('archive', conversation.conversationId)">📦 归档</button>
            <button class="menu-item menu-item-danger" @click="handleAction('delete', conversation.conversationId)">🗑️ 删除</button>
          </div>
        </div>
        <p v-if="!conversations.filter(c => c.status === 'active').length" class="conversation-empty">暂无活跃会话</p>
      </template>

      <template v-if="activeTab === 'archived'">
        <div
          v-for="conversation in conversations.filter(c => c.status === 'archived')"
          :key="conversation.conversationId"
          class="conversation-item-wrapper"
        >
          <div
            class="conversation-item conversation-item-archived"
            role="button"
            tabindex="0"
            @click="emit('select', conversation)"
            @keydown="handleConversationKeydown($event, conversation)"
          >
            <div class="conversation-item-content">
              <span class="conversation-title">{{ conversation.title }}</span>
              <span class="conversation-meta">{{ formatConversationTime(conversation.updatedAt) }}</span>
            </div>
            <button
              class="menu-trigger"
              type="button"
              aria-label="更多操作"
              @click="toggleMenu(conversation.conversationId, $event)"
            >
              ⋮
            </button>
          </div>
          <div v-if="openMenuId === conversation.conversationId" class="conversation-menu">
            <button class="menu-item" @click="handleAction('regenerate', conversation.conversationId)">🔄 重新生成标题</button>
            <button class="menu-item" @click="handleAction('unarchive', conversation.conversationId)">📤 取消归档</button>
            <button class="menu-item menu-item-danger" @click="handleAction('delete', conversation.conversationId)">🗑️ 删除</button>
          </div>
        </div>
        <p v-if="!conversations.filter(c => c.status === 'archived').length" class="conversation-empty">暂无归档会话</p>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.conversation-tabs {
  display: flex;
  border-bottom: 1px solid #eee;
  margin-bottom: 4px;
}

.tab-button {
  flex: 1;
  padding: 6px 8px;
  font-size: 0.8rem;
  border: none;
  background: none;
  cursor: pointer;
  color: #666;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab-button:hover {
  color: #333;
}

.tab-active {
  color: #4a90d9;
  border-bottom-color: #4a90d9;
  font-weight: 500;
}

.conversation-item-wrapper {
  position: relative;
}

.conversation-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 8px;
  cursor: pointer;
  text-align: left;
  border-radius: 6px;
  transition: background 0.15s;
  gap: 4px;
}

.conversation-item:hover {
  background: #f5f5f5;
}

.conversation-item:focus-visible {
  outline: 2px solid #4a90d9;
  outline-offset: -2px;
}

.conversation-item-active {
  background: #e3f2fd;
}

.conversation-item-archived {
  opacity: 0.7;
}

.conversation-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conversation-title {
  font-size: 0.85rem;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-meta {
  font-size: 0.7rem;
  color: #999;
}

.menu-trigger {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease, background 0.2s ease;
  cursor: pointer;
  color: #999;
  font-size: 1rem;
  border-radius: 4px;
}

.conversation-item-wrapper:hover .menu-trigger,
.conversation-item-active + .menu-trigger, 
.menu-trigger:focus-visible {
  opacity: 1;
}

.menu-trigger:hover {
  background: #e0e0e0;
  color: #333;
}

.conversation-menu {
  position: absolute;
  right: 8px;
  top: 100%;
  z-index: 10;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  min-width: 160px;
  padding: 4px 0;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-size: 0.85rem;
  color: #333;
}

.menu-item:hover {
  background: #f5f5f5;
}

.menu-item-danger {
  color: #d32f2f;
}

.menu-item-danger:hover {
  background: #fce4ec;
}

.conversation-empty {
  text-align: center;
  color: #999;
  font-size: 0.85rem;
  padding: 20px 8px;
}
</style>
