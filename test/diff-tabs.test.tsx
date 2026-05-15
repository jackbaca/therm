import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { DiffTabs } from "../src/components/chat/DiffTabs"
import type { ToolPart } from "../src/types/message"

const udiff = (path: string, body: string) => [
  `--- a/${path}`,
  `+++ b/${path}`,
  "@@ -1,3 +1,3 @@",
  ` keep`,
  `-old ${body}`,
  `+new ${body}`,
].join("\n")

const tool = (id: string, preview: string, body: string): ToolPart => ({
  type: "tool", id, name: "patch", args: "",
  preview, status: "done", duration: 5, diff: udiff(preview, body),
})

describe("DiffTabs", () => {
  test("renders nothing when no diff-bearing tools", async () => {
    const t = await mountNode(<DiffTabs tools={[]} />, { width: 80, height: 8 })
    await t.settle()
    const f = t.frame()
    // No left bar, no panel chrome, no @@ hunk markers.
    expect(f).not.toContain("┃")
    expect(f).not.toContain("@@")
    t.destroy()
  })

  test("single diff: tab label is basename, +1/-1 row, body present", async () => {
    const t = await mountNode(
      <DiffTabs tools={[tool("a", "src/foo.ts", "thing")]} />,
      { width: 80, height: 16 },
    )
    await until(t, () => t.frame().includes("foo.ts"))
    const f = t.frame()
    expect(f).toContain("foo.ts")
    // Tab label uses basename — find the row showing "foo.ts" without the "src/" prefix.
    const tabRow = f.split("\n").find(l => /foo\.ts/.test(l) && !/src\/foo\.ts/.test(l))
    expect(tabRow).toBeDefined()
    expect(f).toContain("+1")
    expect(f).toContain("-1")
    expect(f).toContain("+new thing")
    t.destroy()
  })

  test("three diffs: ribbon shows all, click swaps body", async () => {
    const tools = [
      tool("a", "alpha.ts", "alpha"),
      tool("b", "beta.ts", "beta"),
      tool("c", "gamma.ts", "gamma"),
    ]
    const t = await mountNode(<DiffTabs tools={tools} />, { width: 100, height: 18 })
    await until(t, () => t.frame().includes("alpha.ts") && t.frame().includes("gamma.ts"))
    // First tab is active by default → alpha body.
    expect(t.frame()).toContain("+new alpha")
    expect(t.frame()).not.toContain("+new beta")

    // Click 'beta.ts' label.
    const rows = t.frame().split("\n")
    const y = rows.findIndex(l => l.includes("beta.ts"))
    const x = rows[y].indexOf("beta.ts")
    await act(async () => { await t.mouse.pressDown(x, y) })
    await until(t, () => t.frame().includes("+new beta"))
    expect(t.frame()).not.toContain("+new alpha")
    t.destroy()
  })

  test("duplicate basenames disambiguated by parent dir", async () => {
    const tools = [
      tool("a", "src/chat/Foo.tsx", "chatfoo"),
      tool("b", "src/ui/Foo.tsx", "uifoo"),
    ]
    const t = await mountNode(<DiffTabs tools={tools} />, { width: 100, height: 16 })
    await until(t, () => t.frame().includes("chat/Foo.tsx"))
    expect(t.frame()).toContain("chat/Foo.tsx")
    expect(t.frame()).toContain("ui/Foo.tsx")
    t.destroy()
  })

  test("ribbon wraps to multiple rows at narrow width", async () => {
    const tools = Array.from({ length: 8 }, (_, i) =>
      tool(`t${i}`, `file${i}.ts`, `body${i}`))
    const t = await mountNode(<DiffTabs tools={tools} />, { width: 40, height: 24 })
    await until(t, () => t.frame().includes("file0.ts") && t.frame().includes("file7.ts"))
    const rows = t.frame().split("\n")
    const firstY = rows.findIndex(l => l.includes("file0.ts"))
    const lastY = rows.findIndex(l => l.includes("file7.ts"))
    // Wrap means the last tab sits below the first.
    expect(lastY).toBeGreaterThan(firstY)
    t.destroy()
  })

  test("falls back when tool has no preview path", async () => {
    const t = await mountNode(
      <DiffTabs tools={[{
        type: "tool", id: "np", name: "patch", args: "",
        status: "done", duration: 1, diff: udiff("x", "y"),
      }]} />,
      { width: 80, height: 12 },
    )
    await until(t, () => t.frame().includes("patch"))
    expect(t.frame()).toContain("patch") // falls back to tool name
    t.destroy()
  })
})
