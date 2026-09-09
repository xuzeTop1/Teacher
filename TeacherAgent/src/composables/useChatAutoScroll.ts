import type { Ref } from "vue"

interface ScrollableList {
  scrollToBottom: (behavior?: ScrollBehavior) => void
  scrollToBottomIfNear: (behavior?: ScrollBehavior) => void
}

export function useChatAutoScroll(messageListRef: Ref<ScrollableList | null>) {
  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth") {
    messageListRef.value?.scrollToBottom(behavior)
  }

  function scrollMessagesToBottomIfNear(behavior: ScrollBehavior = "smooth") {
    messageListRef.value?.scrollToBottomIfNear(behavior)
  }

  return {
    scrollMessagesToBottom,
    scrollMessagesToBottomIfNear
  }
}
