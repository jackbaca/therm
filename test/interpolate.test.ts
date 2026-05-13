import { describe, test, expect } from "bun:test"
import { interpolate, hasInterp, INTERP_RE } from "../src/utils/interpolate"
import type { Gateway } from "../src/context/gateway"

const gw = (fn: (cmd: string) => { stdout?: string; stderr?: string } | Error): Gateway => ({
  request: async (method: string, params?: Record<string, unknown>) => {
    if (method !== "shell.exec") throw new Error("unexpected " + method)
    const r = fn((params as { command: string }).command)
    if (r instanceof Error) throw r
    return r as never
  },
} as unknown as Gateway)

describe("utils/interpolate", () => {
  test("hasInterp", () => {
    expect(hasInterp("plain text")).toBe(false)
    expect(hasInterp("branch is {!git branch}")).toBe(true)
    expect(hasInterp("{! }")).toBe(true)
    expect(hasInterp("{!}")).toBe(false) // needs at least one char
  })

  test("regex is non-greedy across spans", () => {
    const hits = [..."a {!one} b {!two} c".matchAll(INTERP_RE)].map(m => m[1])
    expect(hits).toEqual(["one", "two"])
  })

  test("single span splices stdout, trims", async () => {
    const out = await interpolate(gw(() => ({ stdout: "  main\n" })), "on {!git branch}")
    expect(out).toBe("on main")
  })

  test("multiple spans, order preserved, back-to-front splice", async () => {
    const out = await interpolate(
      gw(cmd => ({ stdout: cmd === "echo a" ? "A" : "BB" })),
      "[{!echo a}] and [{!echo b}]",
    )
    expect(out).toBe("[A] and [BB]")
  })

  test("stderr joins stdout; error → (error)", async () => {
    expect(await interpolate(
      gw(() => ({ stdout: "out", stderr: "err" })), "{!x}",
    )).toBe("out\nerr")
    expect(await interpolate(
      gw(() => new Error("boom")), "say {!fail} done",
    )).toBe("say (error) done")
  })

  test("no spans → identity, no request", async () => {
    let called = false
    const g = gw(() => { called = true; return { stdout: "x" } })
    expect(await interpolate(g, "nothing here")).toBe("nothing here")
    expect(called).toBe(false)
  })
})
