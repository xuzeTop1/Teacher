import { TurnAbortedError } from "../llm/turnAbort"

/**
 * Non-Error sentinel stored in `terminal` when `abort()` is called with no
 * parked consumer. Prevents Node from tracking a dangling Error object as an
 * unhandled rejection. `settleTerminal` converts it to a real TurnAbortedError
 * when a late `next()` call arrives.
 */
const ABORT_SENTINEL = Symbol("queue-aborted")

type QueueEvent<T> =
  | { kind: "value"; value: T }
  | { kind: "done" }
  | { kind: "error"; error: unknown }

/**
 * Event-woken async queue used to bridge Tauri `Channel` callbacks into an async
 * iterator. Replaces the previous 10ms `setTimeout` polling loop.
 *
 * Guarantees:
 * - Consumers park on a pending promise when the buffer is empty; producers wake
 *   them synchronously on `push` / `end` / `fail`. No busy polling.
 * - Values are delivered in arrival order; every value is delivered exactly once
 *   (no dropped or duplicated chunks).
 * - `end()` completes the iterator; `fail(err)` rejects the current/next
 *   `next()`; completion/error is remembered so late `next()` calls settle
 *   deterministically instead of hanging forever.
 * - `abort()` seals the queue, drops buffered values, rejects any parked
 *   consumer with `TurnAbortedError`, and ignores all later producer events —
 *   late channel messages after cancellation are discarded.
 */
export class AsyncEventQueue<T> {
  private buffer: Array<QueueEvent<T>> = []
  private waiter: ((event: QueueEvent<T>) => void) | null = null
  private sealed = false
  private terminal: QueueEvent<T> | null = null

  /** Producer: enqueue a value. Ignored once the queue is sealed or aborted. */
  push(value: T): void {
    if (this.sealed) return
    this.deliver({ kind: "value", value })
  }

  /** Producer: signal successful completion. Idempotent. */
  end(): void {
    if (this.sealed) return
    this.sealed = true
    this.deliver({ kind: "done" })
  }

  /** Producer: signal failure. Idempotent; the first error wins. */
  fail(error: unknown): void {
    if (this.sealed) return
    this.sealed = true
    this.deliver({ kind: "error", error })
  }

  /**
   * Consumer-side cancellation: reject the parked consumer (if any) with
   * `TurnAbortedError`, drop buffered values, and seal the queue so late
   * producer events are discarded.
   */
  abort(): void {
    // A remembered terminal event means a consumer already received done/error;
    // never mask a real outcome with a late cancellation.
    if (this.terminal) return
    this.sealed = true
    this.buffer = []
    if (this.waiter) {
      const error = new TurnAbortedError()
      this.terminal = { kind: "error", error }
      const waiter = this.waiter
      this.waiter = null
      waiter(this.terminal)
    } else {
      // No parked consumer: store a non-Error sentinel so Node does not track
      // it as an unhandled rejection. Late next() calls will still reject with
      // a proper TurnAbortedError via settleTerminal.
      this.terminal = { kind: "error", error: ABORT_SENTINEL }
    }
  }

  /** Consumer: take the next value, parking until one arrives. */
  next(): Promise<IteratorResult<T, undefined>> {
    const event = this.buffer.shift()
    if (event) {
      if (event.kind === "value") {
        return Promise.resolve({ value: event.value, done: false })
      }
      this.terminal = event
      return this.settleTerminal(event)
    }

    if (this.terminal) {
      return this.settleTerminal(this.terminal)
    }

    return new Promise<IteratorResult<T, undefined>>((resolve, reject) => {
      this.waiter = (delivered) => {
        this.waiter = null
        if (delivered.kind === "value") {
          resolve({ value: delivered.value, done: false })
        } else {
          this.terminal = delivered
          if (delivered.kind === "done") {
            resolve({ value: undefined, done: true })
          } else {
            reject(delivered.error)
          }
        }
      }
    })
  }

  private deliver(event: QueueEvent<T>): void {
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter(event)
    } else {
      this.buffer.push(event)
    }
  }

  private settleTerminal(event: QueueEvent<T>): Promise<IteratorResult<T, undefined>> {
    if (event.kind === "done") {
      return Promise.resolve({ value: undefined, done: true })
    }
    if (event.kind === "error") {
      const error = event.error === ABORT_SENTINEL ? new TurnAbortedError() : event.error
      return Promise.reject(error)
    }
    // Unreachable: terminal events are never "value".
    return Promise.resolve({ value: undefined, done: true })
  }
}
