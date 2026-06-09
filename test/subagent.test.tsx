import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, type Harness } from "./harness"
import { turnReducer, initialTurn, type TurnState } from "../src/app/turnReducer"
import { Tool } from "../src/components/chat/tool"
import type { ToolPart } from "../src/types/message"

function run(actions: Parameters<typeof turnReducer>[1][]): TurnState {
  return actions.reduce(turnReducer, initialTurn)
}

describe("turnReducer — subagent", () => {
  test("accumulates child tool events into trail[], preserves goal", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "subagent", event: "start", payload: { task_index: 0, goal: "refactor foo" } },
      { kind: "subagent", event: "tool", payload: { task_index: 0, goal: "refactor foo", tool_name: "read_file", tool_preview: "a.ts" } },
      { kind: "subagent", event: "tool", payload: { task_index: 0, goal: "refactor foo", tool_name: "patch", tool_preview: "a.ts" } },
      { kind: "subagent", event: "thinking", payload: { task_index: 0, goal: "refactor foo", text: "hmm" } },
      { kind: "subagent", event: "complete", payload: { task_index: 0, goal: "refactor foo", status: "completed", summary: "done", duration_seconds: 3.5 } },
    ])
    const part = s.messages.at(-1)!.parts.find(p => p.type === "tool") as ToolPart
    expect(part.name).toBe("delegate_task")
    expect(part.goal).toBe("refactor foo")
    expect(part.trail).toEqual([
      { name: "read_file", preview: "a.ts" },
      { name: "patch", preview: "a.ts" },
    ])
    expect(part.status).toBe("done")
    expect(part.duration).toBe(3500)
    expect(part.result).toBe("done")
    // preview resets to goal on complete (transient text cleared)
    expect(part.preview).toBe("refactor foo")
  })

  test("parallel tasks keyed by task_index", () => {
    const s = run([
      { kind: "message.start" },
      { kind: "subagent", event: "start", payload: { task_index: 0, goal: "A" } },
      { kind: "subagent", event: "start", payload: { task_index: 1, goal: "B" } },
      { kind: "subagent", event: "tool", payload: { task_index: 1, goal: "B", tool_name: "terminal", tool_preview: "ls" } },
      { kind: "subagent", event: "complete", payload: { task_index: 0, goal: "A", status: "failed" } },
    ])
    const parts = s.messages.at(-1)!.parts.filter(p => p.type === "tool") as ToolPart[]
    expect(parts).toHaveLength(2)
    expect(parts[0].goal).toBe("A")
    expect(parts[0].status).toBe("error")
    expect(parts[0].trail).toEqual([])
    expect(parts[1].goal).toBe("B")
    expect(parts[1].status).toBe("running")
    expect(parts[1].trail).toHaveLength(1)
  })
})

function locate(t: Harness, needle: string) {
  const rows = t.frame().split("\n")
  const y = rows.findIndex(l => l.includes(needle))
  return { x: rows[y].indexOf(needle), y }
}

describe("Subagent renderer", () => {
  const part = (p: Partial<ToolPart>): ToolPart => ({
    type: "tool", id: "sub-0", name: "delegate_task", args: "",
    status: "done", goal: "refactor foo", preview: "refactor foo",
    trail: [
      { name: "read_file", preview: "src/a.ts" },
      { name: "terminal", preview: "bun test" },
      { name: "patch", preview: "src/a.ts" },
    ],
    duration: 4200, result: "3 files changed",
    ...p,
  })

  async function setup(p: Partial<ToolPart>) {
    const t: Harness = await mountNode(
      <box flexDirection="column" width="100%" height="100%"><Tool tool={part(p)} /></box>,
      { width: 120, height: 30 },
    )
    await t.settle()
    return t
  }

  test("collapsed: goal + footer row (└─ N toolcalls · dur)", async () => {
    const t = await setup({})
    await until(t, () => t.frame().includes("● Task — refactor foo"))
    const f = t.frame()
    expect(f).toContain("└─ 3 toolcalls · 4.2s")
    expect(f).not.toContain("├─")
    expect(f).not.toContain("bun test")
    t.destroy()
  })

  test("running: spinner + ↳ last child row", async () => {
    const t = await setup({ status: "running", duration: undefined })
    await until(t, () => t.frame().includes("Task — refactor foo"))
    const f = t.frame()
    expect(f).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Task — refactor foo/)
    expect(f).toContain("↳ Edit src/a.ts")
    t.destroy()
  })

  test("click expands to ├─/└─ trail with per-child glyphs + summary", async () => {
    const t = await setup({})
    await until(t, () => t.frame().includes("● Task — refactor foo"))
    const p = locate(t, "● Task")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("├─"))

    const f = t.frame()
    expect(f).toContain("├─ → Read src/a.ts")
    expect(f).toContain("├─ $ bun test")
    expect(f).toContain("└─ ← Edit src/a.ts")
    expect(f).toContain("3 files changed")
    expect(f).not.toContain("└─ 3 toolcalls")
    t.destroy()
  })
})
