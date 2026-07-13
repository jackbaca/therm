import { describe, test, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { act, createRef, forwardRef, useImperativeHandle } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Sidebar } from "../src/components/sidebar/Sidebar"
import { useDialog } from "../src/ui/dialog"

const INFO = {
  model: "test-model-v9",
  cwd: "/home/t",
  tools: { file: ["read", "write"], web: ["search"] },
  skills: { dev: ["a"] },
  mcp_servers: [
    { name: "linear", connected: true, transport: "stdio", tools: 5 },
    { name: "broken", connected: false, transport: "stdio", tools: 0 },
  ],
}

type Handle = { open: () => void }

const Host = forwardRef<Handle, { cwd: string }>((props, ref) => {
  const dialog = useDialog()
  useImperativeHandle(ref, () => ({ open: () => dialog.replace(<text>protected dialog</text>) }), [dialog])
  return <Sidebar agentState="idle" info={{ ...INFO, cwd: props.cwd }} />
})

const repo = async (root: string) => {
  const p = Bun.spawn(["sh", "-c", "git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m root"], {
    cwd: root, stdout: "ignore", stderr: "ignore",
  })
  await p.exited
}

describe("Sidebar", () => {
  test("MCP section toggles on header click", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("MCP"))

    const find = () => {
      const lines = t.frame().split("\n")
      const y = lines.findIndex(line => line.includes("MCP"))
      return { x: lines[y].indexOf("MCP"), y }
    }

    let p = find()
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("linear") && t.frame().includes("broken"))

    p = find()
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => !t.frame().includes("linear"))
    t.destroy()
  })

  test("context gauge renders used/max + bar + percent when usage present", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const info = {
      ...INFO,
      usage: { input: 0, output: 0, total: 0, context_used: 258_000, context_max: 1_000_000 },
    }
    const t = await mountNode(
      <Sidebar agentState="idle" info={info} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("258K"))
    const f = t.frame()
    expect(f).toContain("258K / 1M")
    expect(f).toContain("26%")
    t.destroy()
  })

  test("changed-files dialog refreshes and cannot replace an active dialog", async () => {
    const root = mkdtempSync(join(tmpdir(), "herm-sidebar-git-"))
    try {
      await repo(root)
      writeFileSync(join(root, "new.ts"), "new")
      const ref = createRef<Handle>()
      const t = await mountNode(<Host ref={ref} cwd={root} />, { width: 160, height: 48 })
      await until(t, () => t.frame().includes("Changes  +1 ~0 -0"))

      const lines = t.frame().split("\n")
      const y = lines.findIndex(line => line.includes("Changes  +1 ~0 -0"))
      await act(async () => { await t.mouse.pressDown(lines[y].indexOf("Changes"), y) })
      await until(t, () => t.frame().includes("Changed Files (1)"))
      expect(t.frame()).toContain("new.ts")
      act(() => t.keys.pressEscape())
      await until(t, () => !t.frame().includes("Changed Files (1)"))

      act(() => ref.current!.open())
      await until(t, () => t.frame().includes("protected dialog"))
      act(() => t.keys.pressKey("x", { ctrl: true }))
      act(() => t.keys.pressKey("d"))
      await t.settle()
      expect(t.frame()).toContain("protected dialog")
      expect(t.frame()).not.toContain("Changed Files (1)")
      t.destroy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

})
