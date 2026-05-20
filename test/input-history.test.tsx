import { describe, expect, test, beforeEach } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { mountNode } from "./harness"
import { useInputHistory, type HistEntry } from "../src/app/useInputHistory"
import type { FilePart } from "../src/app/parts"

const dir = process.env.HERM_CONFIG_DIR!
const file = join(dir, "history")

type Hook = ReturnType<typeof useInputHistory>

async function setup() {
  let hook!: Hook
  let val: HistEntry = { input: "", parts: [] }
  const Probe = () => {
    const h = useInputHistory(val.input, e => (val = e))
    hook = h
    return null
  }
  const t = await mountNode(<Probe />)
  return { t, hook: () => hook, val: () => val.input, entry: () => val }
}

describe("useInputHistory", () => {
  beforeEach(() => {
    rmSync(file, { force: true })
  })

  test("loads legacy raw-string entries from disk — ↑ recalls newest-last", async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, "old\nmid\nnew\n")
    const s = await setup()
    act(() => s.hook().up())
    expect(s.val()).toBe("new")
    act(() => s.hook().up())
    expect(s.val()).toBe("mid")
    act(() => s.hook().up())
    expect(s.val()).toBe("old")
    s.t.destroy()
  })

  test("push appends JSONL to disk and dedupes adjacent", async () => {
    const s = await setup()
    act(() => s.hook().push("a"))
    act(() => s.hook().push("a"))
    act(() => s.hook().push("b"))
    act(() => s.hook().push("a"))
    await s.t.settle()
    expect(readFileSync(file, "utf-8")).toBe(
      `{"input":"a"}\n{"input":"b"}\n{"input":"a"}\n`,
    )
    act(() => s.hook().up())
    expect(s.val()).toBe("a")
    act(() => s.hook().up())
    expect(s.val()).toBe("b")
    s.t.destroy()
  })

  test("entries with parts round-trip through disk", async () => {
    const part: FilePart = {
      type: "file",
      mime: "text/uri-list",
      filename: "@file:src/x.ts",
      source: { type: "file", path: "@file:src/x.ts", text: { start: 0, end: 14, value: "@file:src/x.ts" } },
    }
    const s = await setup()
    act(() => s.hook().push({ input: "@file:src/x.ts here", parts: [part] }))
    await s.t.settle()
    const line = readFileSync(file, "utf-8").trim()
    const parsed = JSON.parse(line)
    expect(parsed.input).toBe("@file:src/x.ts here")
    expect(parsed.parts).toHaveLength(1)
    expect(parsed.parts[0].type).toBe("file")
    act(() => s.hook().up())
    expect(s.entry().parts).toHaveLength(1)
    s.t.destroy()
  })

  test("missing file → empty history, ↑ is a no-op", async () => {
    expect(existsSync(file)).toBe(false)
    const s = await setup()
    act(() => s.hook().up())
    expect(s.val()).toBe("")
    s.t.destroy()
  })

  test("cap at 500 — rewrites file when exceeded", async () => {
    mkdirSync(dir, { recursive: true })
    const lines = Array.from({ length: 500 }, (_, i) => `m${i}`)
    writeFileSync(file, lines.join("\n") + "\n")
    const s = await setup()
    act(() => s.hook().push("over"))
    await s.t.settle()
    const out = readFileSync(file, "utf-8").split("\n").filter(Boolean).map(l => JSON.parse(l).input)
    expect(out.length).toBe(500)
    expect(out[0]).toBe("m1")
    expect(out[499]).toBe("over")
    s.t.destroy()
  })
})
