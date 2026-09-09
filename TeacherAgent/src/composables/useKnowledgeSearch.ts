import { ref } from "vue"
import { searchLocalKnowledgeLazy } from "../services/knowledge/localKnowledgeSearch"
import type { KnowledgeSearchOutput } from "../types/tool"
import { useAppStore } from "../stores/app"
import { usePackSelectionStore } from "../stores/packSelection"

export function useKnowledgeSearch() {
  const appStore = useAppStore()
  const packSelectionStore = usePackSelectionStore()

  const isSearchPanelOpen = ref(false)
  const searchQuery = ref("")
  const searchResults = ref<KnowledgeSearchOutput["results"]>([])
  const isSearching = ref(false)
  const searchError = ref<string | null>(null)

  function toggleSearchPanel() {
    isSearchPanelOpen.value = !isSearchPanelOpen.value
    if (!isSearchPanelOpen.value) {
      searchResults.value = []
      searchError.value = null
    }
  }

  async function executeKnowledgeSearch() {
    const query = searchQuery.value.trim()
    if (!query) {
      searchError.value = "请输入要搜索的知识点"
      searchResults.value = []
      return
    }

    isSearching.value = true
    searchError.value = null
    searchResults.value = []

    try {
      const result = await searchLocalKnowledgeLazy({
        query,
        subject: appStore.selectedSubject,
        enabledPackIds: packSelectionStore.getEnabledPackIds(appStore.selectedSubject),
        topK: 5,
        searchMode: "hybrid",
        includePrerequisites: false,
        includeMisconceptions: false,
        includeSocraticHints: false
      })

      if (result.ok && result.data) {
        searchResults.value = result.data.results
        if (result.data.results.length === 0) {
          searchError.value = "未找到匹配的知识点"
        }
      } else {
        searchError.value = result.error ?? "搜索失败"
      }
    } catch (error) {
      searchError.value = error instanceof Error ? error.message : "搜索失败"
    } finally {
      isSearching.value = false
    }
  }

  return {
    isSearchPanelOpen,
    searchQuery,
    searchResults,
    isSearching,
    searchError,
    toggleSearchPanel,
    executeKnowledgeSearch
  }
}
