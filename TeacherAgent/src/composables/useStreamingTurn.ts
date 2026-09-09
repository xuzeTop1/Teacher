import { ref } from "vue"

/**
 * Streaming/turn lifecycle state for ChatView.
 *
 * Cancellation contract (P0):
 * - `activateStreaming()` starts a turn: it aborts any turn still in flight
 *   (e.g. a re-send or a send in another conversation) and creates a fresh
 *   `AbortController` whose signal is passed to the orchestrator.
 * - `cancelActiveTurn()` cancels the in-flight turn (conversation switch,
 *   component unmount): the signal aborts, the orchestrator rejects with
 *   `TurnAbortedError`, and streaming UI state is reset.
 * - `resetStreamingState()` only clears UI state; it never aborts a turn.
 *
 * Note: "streaming" here means buffered guarded streaming (Strategy A) — the
 * transport streams, but visible content appears only after full guardrail
 * review. `isStreamingActive` reads as "the tutor is preparing a reply".
 */
export function useStreamingTurn() {
  const streamingTimingText = ref("")
  const streamingDraftContent = ref("")
  const isStreamingActive = ref(false)

  let activeTurnController: AbortController | null = null

  /** Signal of the in-flight turn, or undefined when no turn is active. */
  function activeTurnSignal(): AbortSignal | undefined {
    return activeTurnController?.signal
  }

  function resetStreamingState() {
    isStreamingActive.value = false
    streamingTimingText.value = ""
    streamingDraftContent.value = ""
  }

  function activateStreaming() {
    // At most one active turn: abort a previous turn that never settled.
    activeTurnController?.abort()
    activeTurnController = new AbortController()
    isStreamingActive.value = true
    streamingTimingText.value = "正在思考..."
    streamingDraftContent.value = ""
  }

  /**
   * Cancel the in-flight turn (if any) and clear streaming state.
   * Safe to call when no turn is active.
   */
  function cancelActiveTurn() {
    activeTurnController?.abort()
    activeTurnController = null
    resetStreamingState()
  }

  return {
    streamingTimingText,
    streamingDraftContent,
    isStreamingActive,
    activeTurnSignal,
    resetStreamingState,
    activateStreaming,
    cancelActiveTurn
  }
}
