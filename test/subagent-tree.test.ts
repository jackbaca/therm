import { describe, test, expect } from "bun:test"
import { tree, totals, summary, spark, heat, peak, type Live } from "../src/service/subagent-tree"
import type { DelegationRecord } from "../src/context/wire"

const rec = (id: string, parent: string | null, depth: number, o: Partial<DelegationRecord> = {}): DelegationRecord => ({
  subagent_id: id, parent_id: parent, depth, goal: id,
  started_at: 1000, tool_count: 0, status: "running", ...o,
})

describe("utils/subagent-tree", () => {
  test("tree + totals aggregate across depth; orphans promote to root", () => {
    const recs = [
      rec("a", null, 0, { tool_count: 5 }),
      rec("a1", "a", 1, { tool_count: 3 }),
      rec("a1x", "a1", 2, { tool_count: 2 }),
      rec("b", null, 0, { tool_count: 1 }),
      rec("orphan", "ghost", 1, { tool_count: 7 }),
    ]
    const live = new Map<string, Live>([
      ["a1", { input_tokens: 1000, output_tokens: 200, cost_usd: 0.02, status: "done" }],
    ])
    const t = tree(recs, live, 1010)

    // a, b, orphan at root (ghost isn't in snapshot → orphan promotes)
    expect(t.length).toBe(3)
    expect(t.map(n => n.rec.subagent_id)).toEqual(["a", "b", "orphan"])
    expect(t[0].kids[0].kids[0].rec.subagent_id).toBe("a1x")

    // a's subtree: 3 agents, 5+3+2 tools, depth 2, a1 done → 2 active
    expect(t[0].agg.agents).toBe(3)
    expect(t[0].agg.tools).toBe(10)
    expect(t[0].agg.depth).toBe(2)
    expect(t[0].agg.active).toBe(2)
    expect(t[0].agg.tok).toBe(1200)
    expect(t[0].agg.cost).toBeCloseTo(0.02)

    const all = totals(t)
    expect(all.agents).toBe(5)
    expect(all.tools).toBe(18)
    expect(all.depth).toBe(3)  // max child depth + 1
    expect(all.active).toBe(4) // a, a1x, b, orphan
  })

  test("summary line + spark", () => {
    const t = tree([
      rec("a", null, 0, { tool_count: 10 }),
      rec("a1", "a", 1), rec("a2", "a", 1), rec("a3", "a", 1),
    ], new Map(), 1120)
    const s = summary(totals(t))
    expect(s).toMatch(/^d2 · 4 agents · 10 tools · /)
    expect(s).toContain("⚡4")
    // depth widths: [1, 3] → second bar is max
    expect(spark(t)).toMatch(/^.█$/)
  })

  test("hotness + heat bucketing", () => {
    const t = tree([
      rec("a", null, 0, { tool_count: 100, started_at: 0 }),
      rec("b", null, 0, { tool_count: 10, started_at: 0 }),
    ], new Map(), 10)
    // a alone: 100 tools / 10s = 10; b: 10/10 = 1
    expect(t[0].agg.hot).toBe(10)
    expect(t[1].agg.hot).toBe(1)
    const pk = peak(t)
    expect(pk).toBe(10)
    expect(heat(10, pk, 4)).toBe(3)
    expect(heat(1, pk, 4)).toBe(0)
    expect(heat(0, pk, 4)).toBe(0)
  })

  test("empty", () => {
    expect(tree([], new Map(), 0)).toEqual([])
    expect(totals([])).toMatchObject({ agents: 0, tools: 0, depth: 0 })
    expect(spark([])).toBe("")
    expect(summary(totals([]))).toBe("d0 · 0 agents")
  })
})
