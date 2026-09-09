import { describe, expect, it } from "vitest"
import { AsyncEventQueue } from "./streamQueue"
import { TurnAbortedError, isTurnAborted } from "../llm/turnAbort"

describe("AsyncEventQueue", () => {
  it("delivers no values and completes when end() is called immediately", async () => {
    const q = new AsyncEventQueue<string>()
    q.end()

    const result = await q.next()
    expect(result.done).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it("delivers multiple values in arrival order then completes", async () => {
    const q = new AsyncEventQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    q.end()

    const r1 = await q.next()
    const r2 = await q.next()
    const r3 = await q.next()
    const r4 = await q.next()

    expect(r1).toEqual({ value: 1, done: false })
    expect(r2).toEqual({ value: 2, done: false })
    expect(r3).toEqual({ value: 3, done: false })
    expect(r4.done).toBe(true)
  })

  it("parks the consumer until a value is pushed", async () => {
    const q = new AsyncEventQueue<string>()
    const pending = q.next()

    // Push after a microtask to ensure the consumer is parked
    await Promise.resolve()
    q.push("hello")

    const result = await pending
    expect(result).toEqual({ value: "hello", done: false })
  })

  it("rejects the parked consumer on fail()", async () => {
    const q = new AsyncEventQueue<string>()
    const pending = q.next()

    await Promise.resolve()
    const err = new Error("provider exploded")
    q.fail(err)

    await expect(pending).rejects.toThrow("provider exploded")
  })

  it("remembers error terminal so late next() calls reject deterministically", async () => {
    const q = new AsyncEventQueue<string>()
    const err = new Error("boom")
    q.fail(err)

    // First next() rejects
    await expect(q.next()).rejects.toThrow("boom")
    // Second next() also rejects (terminal remembered, no hang)
    await expect(q.next()).rejects.toThrow("boom")
  })

  it("remembers done terminal so late next() calls resolve done:true", async () => {
    const q = new AsyncEventQueue<string>()
    q.push("a")
    q.end()

    expect(await q.next()).toEqual({ value: "a", done: false })
    expect((await q.next()).done).toBe(true)
    // Late call also resolves done:true (no hang)
    expect((await q.next()).done).toBe(true)
  })

  it("abort() rejects parked consumer with TurnAbortedError", async () => {
    const q = new AsyncEventQueue<string>()
    const pending = q.next()

    await Promise.resolve()
    q.abort()

    await expect(pending).rejects.toSatisfy((e: unknown) => isTurnAborted(e))
  })

  it("abort() drops buffered values and seals the queue", async () => {
    const q = new AsyncEventQueue<string>()
    q.push("a")
    q.push("b")
    q.abort()

    // Buffered values are dropped; next() rejects with TurnAbortedError
    await expect(q.next()).rejects.toSatisfy((e: unknown) => e instanceof TurnAbortedError)
  })

  it("abort() ignores late producer events", async () => {
    const q = new AsyncEventQueue<string>()
    q.abort()

    // Late push/end/fail are all ignored
    q.push("late")
    q.end()
    q.fail(new Error("late error"))

    // Still rejects with TurnAbortedError (not the late error)
    await expect(q.next()).rejects.toSatisfy((e: unknown) => e instanceof TurnAbortedError)
  })

  it("abort() is a no-op when a terminal event was already consumed", async () => {
    const q = new AsyncEventQueue<string>()
    q.push("a")
    q.end()

    // Consume the done terminal
    expect(await q.next()).toEqual({ value: "a", done: false })
    expect((await q.next()).done).toBe(true)

    // Late abort must not mask the real done outcome
    q.abort()
    expect((await q.next()).done).toBe(true)
  })

  it("end() is idempotent", async () => {
    const q = new AsyncEventQueue<string>()
    q.end()
    q.end() // second call is a no-op

    expect((await q.next()).done).toBe(true)
  })

  it("fail() is idempotent — first error wins", async () => {
    const q = new AsyncEventQueue<string>()
    q.fail(new Error("first"))
    q.fail(new Error("second")) // ignored

    await expect(q.next()).rejects.toThrow("first")
  })
})
