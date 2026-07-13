import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resetDb, roots } from "../src/service/sessions-db"
import { analytics } from "../src/service/hermes-analytics"
import { close, io } from "../src/io"
import { tmpHome } from "./fixture/home"
import { openStateDb } from "./fixtures/state-db"

let home: Awaited<ReturnType<typeof tmpHome>>
let inline: string | undefined

beforeEach(async () => {
  inline = process.env.HERM_IO_INLINE
  process.env.HERM_IO_INLINE = "1"
  home = await tmpHome()
  const db = openStateDb()
  db.run(`INSERT INTO sessions
    (id, title, source, model, started_at, message_count,
     input_tokens, output_tokens, estimated_cost_usd)
    VALUES ('io-root', 'Owned IO fixture', 'tui', 'test-model', ?, 3, 42, 8, 0.25)`,
  [Math.floor(Date.now() / 1000)])
  db.close()
  resetDb()
})

afterEach(async () => {
  close()
  resetDb()
  if (inline === undefined) delete process.env.HERM_IO_INLINE
  else process.env.HERM_IO_INLINE = inline
  await home[Symbol.asyncDispose]()
})

describe("io worker", () => {
  test("inline mode returns identical results to direct call", async () => {
    const a = await io.analytics(7)
    expect(a.total.sessions).toBe(1)
    expect(a.total.input).toBe(42)
    expect(a).toEqual(analytics(7))
    const r = await io.roots(30)
    expect(r.map(x => x.id)).toEqual(["io-root"])
    expect(r.map(x => x.id)).toEqual(roots(30).map(x => x.id))
  })


  test("real worker round-trips against sandbox db", async () => {
    process.env.HERM_IO_INLINE = ""
    // Fresh module instance so INLINE is re-read.
    // @ts-expect-error — bun query-string specifier for cache-bust
    const fresh = await import("../src/io?worker") as typeof import("../src/io")
    const r = await fresh.io.roots(30)
    expect(r.map(x => x.id)).toEqual(["io-root"])
    expect(r.map(x => x.id)).toEqual(roots(30).map(x => x.id))
    fresh.close()
  })
})
