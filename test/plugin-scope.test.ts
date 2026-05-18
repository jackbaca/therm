import { describe, expect, test } from "bun:test"
import { createScope } from "../src/plugins/scope"

describe("plugin scope", () => {
  test("track runs disposers in reverse on dispose()", async () => {
    const log: string[] = []
    const scope = createScope("t", () => {})
    scope.track(() => { log.push("a") })
    scope.track(() => { log.push("b") })
    scope.track(() => { log.push("c") })
    await scope.dispose()
    expect(log).toEqual(["c", "b", "a"])
  })

  test("manual disposer runs once and removes from scope", async () => {
    let n = 0
    const scope = createScope("t", () => {})
    const off = scope.track(() => { n++ })
    off()
    off()
    await scope.dispose()
    expect(n).toBe(1)
  })

  test("lifecycle.signal aborts on dispose", async () => {
    const scope = createScope("t", () => {})
    expect(scope.lifecycle.signal.aborted).toBe(false)
    await scope.dispose()
    expect(scope.lifecycle.signal.aborted).toBe(true)
  })

  test("dispose is idempotent", async () => {
    let n = 0
    const scope = createScope("t", () => {})
    scope.track(() => { n++ })
    await scope.dispose()
    await scope.dispose()
    expect(n).toBe(1)
  })

  test("onDispose canceller drops without running", async () => {
    let ran = false
    const scope = createScope("t", () => {})
    const cancel = scope.lifecycle.onDispose(() => { ran = true })
    cancel()
    await scope.dispose()
    expect(ran).toBe(false)
  })

  test("throwing disposer is reported but doesn't halt the queue", async () => {
    const log: string[] = []
    const fails: string[] = []
    const scope = createScope("t", m => { fails.push(m) })
    scope.track(() => { log.push("a") })
    scope.track(() => { throw new Error("boom") })
    scope.track(() => { log.push("c") })
    await scope.dispose()
    expect(log).toEqual(["c", "a"])
    expect(fails.length).toBe(1)
    expect(fails[0]).toContain("dispose threw")
  })
})
