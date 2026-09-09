import { describe, expect, it } from "vitest"
import { useStreamingTurn } from "./useStreamingTurn"

describe("useStreamingTurn", () => {
  it("starts with no active signal and inactive state", () => {
    const s = useStreamingTurn()
    expect(s.activeTurnSignal()).toBeUndefined()
    expect(s.isStreamingActive.value).toBe(false)
    expect(s.streamingTimingText.value).toBe("")
  })

  it("activateStreaming creates a fresh AbortSignal and sets active state", () => {
    const s = useStreamingTurn()
    s.activateStreaming()

    const signal = s.activeTurnSignal()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal!.aborted).toBe(false)
    expect(s.isStreamingActive.value).toBe(true)
    expect(s.streamingTimingText.value).toBe("正在思考...")
  })

  it("re-activating aborts the previous turn's signal", () => {
    const s = useStreamingTurn()
    s.activateStreaming()
    const firstSignal = s.activeTurnSignal()!

    s.activateStreaming()
    const secondSignal = s.activeTurnSignal()!

    expect(firstSignal.aborted).toBe(true)
    expect(secondSignal.aborted).toBe(false)
    expect(secondSignal).not.toBe(firstSignal)
  })

  it("cancelActiveTurn aborts the signal and resets state", () => {
    const s = useStreamingTurn()
    s.activateStreaming()
    const signal = s.activeTurnSignal()!

    s.cancelActiveTurn()

    expect(signal.aborted).toBe(true)
    expect(s.activeTurnSignal()).toBeUndefined()
    expect(s.isStreamingActive.value).toBe(false)
    expect(s.streamingTimingText.value).toBe("")
    expect(s.streamingDraftContent.value).toBe("")
  })

  it("cancelActiveTurn is safe when no turn is active", () => {
    const s = useStreamingTurn()
    // Must not throw
    s.cancelActiveTurn()
    expect(s.isStreamingActive.value).toBe(false)
    expect(s.activeTurnSignal()).toBeUndefined()
  })

  it("resetStreamingState clears UI state without aborting the turn", () => {
    const s = useStreamingTurn()
    s.activateStreaming()
    const signal = s.activeTurnSignal()!
    s.streamingDraftContent.value = "partial content"

    s.resetStreamingState()

    // Signal is NOT aborted — resetStreamingState never cancels
    expect(signal.aborted).toBe(false)
    expect(s.isStreamingActive.value).toBe(false)
    expect(s.streamingDraftContent.value).toBe("")
    // Controller still exists (turn not cancelled)
    expect(s.activeTurnSignal()).toBe(signal)
  })
})
