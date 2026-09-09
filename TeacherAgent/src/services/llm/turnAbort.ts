/**
 * Canonical cancellation primitives for the tutor turn pipeline.
 *
 * Behavior contract (P0 取消契约):
 * - A turn is cancelled exclusively through an `AbortSignal` passed via
 *   `TutorTurnInput.signal`. Cancellation is a first-class outcome, not an error:
 *   callers distinguish it with `isTurnAborted` and must NOT render it as a
 *   provider failure.
 * - Once a signal is aborted, the in-flight turn must stop at the next pipeline
 *   boundary, must not emit `onStreamUpdate(_, done=true)`, and must not persist
 *   assessment / reflection / learning-memory records.
 * - The Rust-side HTTP request may run to completion (Tauri `invoke` has no
 *   native cancellation); the JS side detaches from it and discards late results.
 */

export class TurnAbortedError extends Error {
  constructor(message = "本次辅导请求已取消") {
    super(message)
    this.name = "TurnAborted"
  }
}

/** True when the error represents a user/system-initiated cancellation. */
export function isTurnAborted(error: unknown): boolean {
  if (error instanceof TurnAbortedError) return true
  // Also treat platform AbortError (DOMException) as cancellation.
  return error instanceof Error && (error.name === "TurnAborted" || error.name === "AbortError")
}

/** Throw `TurnAbortedError` synchronously when the signal is already aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TurnAbortedError()
  }
}

/**
 * Race a promise against the signal. Rejects with `TurnAbortedError` as soon as
 * the signal aborts; otherwise settles with the wrapped promise. Covers the gap
 * where a signal aborts between a `throwIfAborted` check and awaiting the next
 * asynchronous step, and makes cancellation effective even when the underlying
 * provider does not cooperate with the signal.
 */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new TurnAbortedError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new TurnAbortedError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}
