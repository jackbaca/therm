import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, mountNode, MockGateway, until } from "./harness"
import { Journey, buildJourneyRows } from "../src/tabs/Journey"
import { resolve, LOCAL_COMMANDS } from "../src/app/slashCommands"
import type { LearningFramesResponse } from "../src/context/wire"

const frames = (): LearningFramesResponse => ({
  frames: [{
    reveal: 1,
    date: "2026-06-30",
    visible: 2,
    grid: [[
      ["╭", "dim"],
      ["●", "memory"],
      ["─", "dim"],
      ["◆", "skill"],
      ["╯", "dim"],
    ]],
    labels: [],
  }],
  legend: [{ glyph: "●", style: "memory", label: "memory" }],
  categories: [{ glyph: "◆", color: "#00ffff", label: "skills" }],
  buckets: [{
    index: 0,
    label: "Jun 30",
    date: "2026-06-30",
    skills: 1,
    memories: 1,
    total: 2,
    category: "recent",
    color: "#00ffff",
    nodes: [
      { id: "skill-a", glyph: "◆", label: "Skill", fullLabel: "Skill A", meta: "skill", body: "", style: "skill" },
      { id: "memory:memory:0", glyph: "●", label: "Memory", fullLabel: "Memory card", meta: "MEMORY.md", body: "remember me", style: "memory" },
    ],
  }],
  summary: ["2 learned items"],
  axis: { start: "2026-06-30", end: "2026-06-30" },
  count: 2,
  cols: 80,
  rows: 8,
})

const oldFrames = (): LearningFramesResponse => ({
  ...frames(),
  buckets: [
    frames().buckets![0],
    { ...frames().buckets![0], index: 1, label: "Jul 01", nodes: [
      { id: "memory:memory:1", glyph: "●", label: "New", fullLabel: "Newest memory", meta: "MEMORY.md", body: "new", style: "memory" },
    ] },
  ],
  count: 3,
})

describe("Journey", () => {
  test("builds chronological slice and item rows with gaps", () => {
    const data = frames()
    const rows = buildJourneyRows([data.buckets![0], { ...data.buckets![0], index: 1, label: "Jul 01" }])
    expect(rows.map(r => r.kind)).toEqual(["slice", "node", "node", "gap", "slice", "node", "node"])
  })

  test("renders learning frames and opens detail through RPC", async () => {
    const gw = new MockGateway({
      "learning.frames": () => frames(),
      "learning.detail": p => ({ ok: true, kind: "memory", id: p.id, label: "Memory card", content: "full memory body" }),
    })
    await using t = await mountNode(<Journey focused />, { gw, width: 120, height: 36 })
    await until(t, () => t.frame().includes("Memory card"))

    expect(t.frame()).toContain("Jun 30")
    expect(t.frame()).toContain("Memory card")
    expect(t.gw.last("learning.frames")?.params.frames).toBe(2)

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("full memory body"))
    expect(t.gw.last("learning.detail")?.params.id).toBe("memory:memory:0")
  })

  test("keeps the initial selection visible and activates its owned row", async () => {
    const many = frames()
    const nodes = Array.from({ length: 24 }, (_, i) => ({
      id: `memory:memory:${i}`,
      glyph: "●",
      label: `Memory ${i}`,
      fullLabel: `Memory card ${i}`,
      meta: "MEMORY.md",
      body: `body ${i}`,
      style: "memory",
    }))
    many.buckets = [{ ...many.buckets![0], nodes, total: nodes.length, memories: nodes.length, skills: 0 }]
    many.count = nodes.length
    const gw = new MockGateway({
      "learning.frames": () => many,
      "learning.detail": p => ({ ok: true, kind: "memory", id: p.id, label: `Detail ${p.id}`, content: "owned detail" }),
    })

    await using t = await mountNode(<Journey focused />, { gw, width: 100, height: 20 })
    await until(t, () => t.frame().includes("Memory card 23"))
    const y = t.frame().split("\n").findIndex(line => line.includes("Memory card 23"))
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThan(20)

    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("learning.detail") !== undefined)
    expect(t.gw.last("learning.detail")?.params.id).toBe("memory:memory:23")
  })

  test("moves backward across bucket gaps", async () => {
    const gw = new MockGateway({
      "learning.frames": () => oldFrames(),
      "learning.detail": p => ({ ok: true, kind: "memory", id: p.id, label: "Gap target", content: "gap target detail" }),
    })

    await using t = await mountNode(<Journey focused />, { gw, width: 120, height: 36 })
    await until(t, () => t.frame().includes("Newest memory"))

    act(() => t.keys.pressArrow("up"))
    await t.settle()
    act(() => t.keys.pressArrow("up"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("learning.detail") !== undefined)
    expect(t.gw.last("learning.detail")?.params.id).toBe("memory:memory:0")
  })

  test("mouse hover selects and mouse down opens detail", async () => {
    const gw = new MockGateway({
      "learning.frames": () => frames(),
      "learning.detail": p => ({ ok: true, kind: "skill", id: p.id, label: "Skill A", content: `skill detail ${p.id}` }),
    })
    await using t = await mountNode(<Journey focused />, { gw, width: 120, height: 36 })
    await until(t, () => t.frame().includes("Skill A"))
    const y = t.frame().split("\n").findIndex(l => l.includes("Skill A"))

    await act(async () => { await t.mouse.moveTo(6, y) })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.calls.filter(c => c.method === "learning.detail").length === 1)
    expect(t.gw.last("learning.detail")?.params.id).toBe("skill-a")

    await act(async () => { await t.mouse.pressDown(6, y) })
    await until(t, () => t.gw.calls.filter(c => c.method === "learning.detail").length === 2)
    expect(t.gw.last("learning.detail")?.params.id).toBe("skill-a")
  })

  test("detail pane receives Tab focus and keyboard scrolling", async () => {
    const content = Array.from({ length: 30 }, (_, i) => `detail line ${i}`).join("\n")
    const gw = new MockGateway({
      "learning.frames": () => frames(),
      "learning.detail": p => ({ ok: true, kind: "memory", id: p.id, label: "Memory card", content }),
    })
    await using t = await mountNode(<Journey focused />, { gw, width: 120, height: 22 })
    await until(t, () => t.frame().includes("Memory card"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("detail line 0"))
    const before = t.gw.calls.filter(c => c.method === "learning.detail").length
    act(() => t.keys.pressKey("tab"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(t.gw.calls.filter(c => c.method === "learning.detail")).toHaveLength(before)
    await act(async () => { await t.keys.pressKeys(["\x1B[6~"]) })
    await until(t, () => t.frame().includes("detail line 14") || t.frame().includes("detail line 15"))
    act(() => t.keys.pressEscape())
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.calls.filter(c => c.method === "learning.detail").length === before + 1)
    expect(t.gw.last("learning.detail")?.params.id).toBe("memory:memory:0")
  })

  test("opens on the newest learned node", async () => {
    const gw = new MockGateway({
      "learning.frames": () => oldFrames(),
      "learning.detail": p => ({ ok: true, kind: "memory", id: p.id, label: "Newest memory", content: "newest detail" }),
    })
    await using t = await mountNode(<Journey focused />, { gw, width: 120, height: 36 })
    await until(t, () => t.frame().includes("Newest memory"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("newest detail"))
    expect(t.gw.last("learning.detail")?.params.id).toBe("memory:memory:1")
  })

  test("shows raw RPC errors", async () => {
    await using fail = await mountNode(<Journey focused />, {
      gw: new MockGateway({ "learning.frames": () => { throw new Error("learning.frames failed") } }),
    })
    await until(fail, () => fail.frame().includes("learning.frames failed"))
  })

  test("ignores stale frame responses after resize", async () => {
    const pending: Array<(value: LearningFramesResponse) => void> = []
    const gw = new MockGateway({
      "learning.frames": () => new Promise<LearningFramesResponse>(resolve => pending.push(resolve)),
    })
    await using t = await mountNode(<Journey focused />, { gw, width: 100, height: 24 })
    await until(t, () => pending.length === 1)

    t.resize(140, 36)
    await until(t, () => pending.length === 2)
    await act(async () => { pending[1]!(oldFrames()); await Promise.resolve() })
    await until(t, () => t.frame().includes("Newest memory"))

    await act(async () => { pending[0]!(frames()); await Promise.resolve() })
    await t.settle()
    expect(t.frame()).toContain("Newest memory")
  })

  test("delete uses confirm dialog and refreshes after mutation", async () => {
    const gw = new MockGateway({
      "learning.frames": () => frames(),
      "learning.delete": p => ({ ok: true, message: `deleted ${p.id}` }),
    })
    await using t = await mountNode(<Journey focused />, { gw })
    await until(t, () => t.frame().includes("Memory card"))
    const before = t.gw.calls.filter(c => c.method === "learning.frames").length

    act(() => t.keys.pressKey("d"))
    await t.settle()
    expect(t.gw.last("learning.delete")).toBeUndefined()
    act(() => t.keys.pressKey("y"))
    await until(t, () => t.gw.calls.filter(c => c.method === "learning.frames").length > before)
    const deletes = t.gw.calls.filter(c => c.method === "learning.delete")
    expect(deletes).toHaveLength(1)
    expect(deletes[0]?.params.id).toBe("memory:memory:0")
    const order = t.gw.calls.map(c => c.method)
    expect(order.lastIndexOf("learning.frames")).toBeGreaterThan(order.indexOf("learning.delete"))
  })

  test("slash aliases route to the native Journey surface", async () => {
    for (const alias of ["journey", "learning", "memory-graph"])
      expect(resolve(LOCAL_COMMANDS, alias)).toMatchObject({ hit: { name: "journey", target: "local" } })

    await using t = await mount({
      handlers: { "learning.frames": () => frames() },
      width: 130,
      height: 40,
    })
    await until(t, () => t.frame().includes("Ready"))
    await act(async () => { await t.keys.typeText("/journey") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("learning.frames") !== undefined)
    expect(t.gw.last("learning.frames")?.params.frames).toBe(2)
    expect(t.gw.last("slash.exec")).toBeUndefined()
  })
})
