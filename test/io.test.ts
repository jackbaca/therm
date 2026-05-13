import { describe, test, expect, afterAll } from "bun:test"
import { roots } from "../src/service/sessions-db"
import { analytics } from "../src/service/hermes-analytics"

// The sandbox state.db is seeded by analytics.test's beforeAll; bun
// test files execute in sorted order so it exists by the time this
// runs. Both inline and worker paths read HERMES_HOME from the env the
// preload set.

describe("io worker", () => {
  test("inline mode returns identical results to direct call", async () => {
    const { io } = await import("../src/io")
    const a = await io.analytics(7)
    expect(a).toEqual(analytics(7))
    const r = await io.roots(30)
    expect(r.map(x => x.id)).toEqual(roots(30).map(x => x.id))
  })

  // The staging guarantee — "a frame scheduled by setState commits
  // before the next io.* result arrives" — rests on worker onmessage
  // being a macrotask that Bun delivers after process.nextTick (which
  // is requestRender's activateFrame path). Assert that ordering
  // directly; it's what makes `await io.x()` a frame yield.
  test("worker onmessage arrives after process.nextTick", async () => {
    const w = new Worker(URL.createObjectURL(new Blob(
      ["self.onmessage=()=>postMessage(null)"], { type: "text/javascript" },
    )))
    await new Promise(r => setTimeout(r, 30))   // let it boot
    const order: string[] = []
    const done = new Promise<void>(res => {
      w.onmessage = () => { order.push("worker"); res() }
    })
    w.postMessage(null)
    queueMicrotask(() => order.push("micro"))
    process.nextTick(() => order.push("nextTick"))
    await done
    expect(order).toEqual(["micro", "nextTick", "worker"])
    w.terminate()
  })

  test("real worker round-trips against sandbox db", async () => {
    process.env.HERM_IO_INLINE = ""
    // Fresh module instance so INLINE is re-read.
    // @ts-expect-error — bun query-string specifier for cache-bust
    const fresh = await import("../src/io?worker") as typeof import("../src/io")
    const r = await fresh.io.roots(30)
    expect(Array.isArray(r)).toBe(true)
    expect(r.map(x => x.id)).toEqual(roots(30).map(x => x.id))
    fresh.close()
    process.env.HERM_IO_INLINE = "1"
  })
})

afterAll(() => { process.env.HERM_IO_INLINE = "1" })
