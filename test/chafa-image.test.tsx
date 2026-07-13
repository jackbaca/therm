import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { act, useState } from "react"
import { ChafaImage } from "../src/ui/ChafaImage"
import type { Rendered } from "../src/utils/chafa"
import { mountNode, until } from "./harness"

describe("ChafaImage fallback", () => {
  test("conversion failure falls back to the owned media chip without leaking the error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "herm-chafa-failure-"))
    const path = join(dir, "fallback-owned.png")
    const err = "CHAFA_FAILURE_SENTINEL_91"
    const calls: Array<[string, number]> = []
    await Bun.write(path, "fixture")
    try {
      await using t = await mountNode(
        <ChafaImage path={path} width={40} chafa load={async (file, width) => {
          calls.push([file, width])
          throw new Error(err)
        }} />,
        { width: 80, height: 10 },
      )
      await until(t, () => calls.length === 1 && t.frame().includes("fallback-owned.png"))
      expect(calls).toEqual([[path, 40]])
      expect(t.frame()).not.toContain(err)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test("ChafaImage paints a chip before asynchronous conversion completes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herm-chafa-pending-"))
  const path = join(dir, "preview-owned.png")
  let release!: (value: Rendered) => void
  const gate = new Promise<Rendered>(resolve => { release = resolve })
  const load = () => gate
  await Bun.write(path, "fixture")
  try {
    await using t = await mountNode(<ChafaImage path={path} chafa load={load} bare />)
    expect(t.frame()).toContain("preview-owned.png")
    expect(t.frame()).not.toContain("RENDERED_CELL_SENTINEL")

    await act(async () => {
      release({ rows: [[{ ch: "RENDERED_CELL_SENTINEL", fg: null, bg: null }]] })
      await gate
    })
    await until(t, () => t.frame().includes("RENDERED_CELL_SENTINEL"))
    expect(t.frame()).not.toContain("preview-owned.png")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("stale ChafaImage completion cannot replace the latest path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herm-chafa-race-"))
  const a = join(dir, "race-a.png")
  const b = join(dir, "race-b.png")
  const pending = new Map<string, (value: Rendered) => void>()
  const load = (path: string) => new Promise<Rendered>(resolve => { pending.set(path, resolve) })
  const out: { swap?: () => void } = {}
  const Host = () => {
    const [path, setPath] = useState(a)
    out.swap = () => setPath(b)
    return <ChafaImage path={path} chafa load={load} bare />
  }
  await Bun.write(a, "fixture-a")
  await Bun.write(b, "fixture-b")
  try {
    await using t = await mountNode(<Host />)
    await until(t, () => pending.has(a))

    act(() => out.swap!())
    await until(t, () => pending.has(b))
    await act(async () => {
      pending.get(b)!({ rows: [[{ ch: "LATEST_B_CELL", fg: null, bg: null }]] })
      await Promise.resolve()
    })
    await until(t, () => t.frame().includes("LATEST_B_CELL"))

    await act(async () => {
      pending.get(a)!({ rows: [[{ ch: "STALE_A_CELL", fg: null, bg: null }]] })
      await Promise.resolve()
    })
    await t.settle()
    expect(t.frame()).toContain("LATEST_B_CELL")
    expect(t.frame()).not.toContain("STALE_A_CELL")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
