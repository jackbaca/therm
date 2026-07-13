import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Context, contextBreakdown, contextMeter, remoteSegments } from "../src/tabs/Context"
import { build } from "../src/service/context-segments"
import type { SessionInfo } from "../src/context/wire"
import type { Message, Usage } from "../src/types/message"
import type { HermesConfig } from "../src/service/hermes-home"

// Strip ANSI so regex matches the visual text, not escape codes.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "")

describe("Context tab", () => {
  test("contextMeter prioritizes live usage and keeps absent usage unknown", () => {
    const cfg = { model: { context_length: 64_000 } } as HermesConfig
    expect(contextMeter(
      { input: 1, output: 1, total: 2, context_used: 12_000, context_max: 100_000 },
      { model: "test", context_used: 25_000, context_max: 500_000 },
      cfg,
    )).toEqual({ max: 100_000, used: 12_000 })
    expect(contextMeter(undefined, {
      model: "test", context_used: 70_000, context_max: 100_000,
      usage: { input: 1, output: 1, total: 2, context_used: 25_000, context_max: 500_000 },
    }, cfg)).toEqual({ max: 500_000, used: 25_000 })
    expect(contextMeter(undefined, { model: "test", context_max: 500_000 }, cfg))
      .toEqual({ max: 500_000, used: undefined })
    expect(contextMeter(undefined, undefined, cfg)).toEqual({ max: 64_000, used: undefined })
    expect(contextMeter(undefined, undefined, { model: { context_length: 0 } } as HermesConfig))
      .toEqual({ max: 128_000, used: undefined })
  })

  test("uses app-level live usage before cumulative message input", async () => {
    const messages: Message[] = [
      { id: "m1", role: "assistant", timestamp: 0, parts: [{ type: "text", content: "a", streaming: false }], usage: { input: 40_000, output: 10, total: 40_010 } },
      { id: "m2", role: "assistant", timestamp: 1, parts: [{ type: "text", content: "b", streaming: false }], usage: { input: 50_000, output: 10, total: 50_010 } },
    ]
    const usage: Usage = { input: 90_000, output: 20, total: 90_020, context_used: 12_000, context_max: 100_000 }
    const t = await mountNode(<Context messages={messages} usage={usage} info={{ model: "test", context_max: 100_000 }} />)
    const f = strip(t.frame())
    expect(f).toMatch(/12k\s*\/\s*100k/)
    expect(f).not.toContain("90k / 100k")
    t.destroy()
  })

  test("maps session.context_breakdown categories to context segments", () => {
    const remote = contextBreakdown({
      categories: [
        { id: "tool_definitions", label: "Tool definitions", tokens: 2000, color: "red" },
        { id: "mcp", label: "MCP", tokens: 500, color: "blue" },
        { id: "conversation", label: "Conversation", tokens: 1000, color: "green" },
      ],
      context_max: 20_000,
      context_percent: 25,
      context_used: 5000,
      estimated_total: 3500,
      model: "test",
    })
    expect(remote).not.toBeNull()
    const local = build({ contextLength: 20_000, usedTokens: 5000, sections: [], conversationTokens: 1, tools: [] })
    const got = remoteSegments(remote!, local)
    expect(got.map(s => s.id)).toEqual(["system_tools", "mcp_tools", "conversation", "unknown", "free"])
    expect(got.find(s => s.id === "system_tools")?.tokens).toBe(2000)
    expect(got.find(s => s.id === "mcp_tools")?.tokens).toBe(500)
    expect(got.find(s => s.id === "unknown")?.tokens).toBe(1500)
    expect(got.find(s => s.id === "free")?.tokens).toBe(15_000)
  })

  test("uses session.context_breakdown payload when available", async () => {
    const gw = new MockGateway({
      "session.context_breakdown": () => ({
        categories: [
          { id: "tool_definitions", label: "Tool definitions", tokens: 2000, color: "red" },
          { id: "mcp", label: "MCP", tokens: 500, color: "blue" },
          { id: "conversation", label: "Conversation", tokens: 1000, color: "green" },
        ],
        context_max: 20_000,
        context_percent: 25,
        context_used: 5000,
        estimated_total: 3500,
        model: "test",
      }),
    })
    const t = await mountNode(<Context info={{ session_id: "s1", model: "test", context_max: 10_000, context_used: 1000 }} />, { gw })
    await until(t, () => strip(t.frame()).includes("Context · 5.0k / 20k (25%)"))
    const f = strip(t.frame())
    expect(gw.last("session.context_breakdown")?.params).toEqual({ session_id: "s1" })
    expect(f).toContain("Context · 5.0k / 20k (25%)")
    expect(f).toContain("System Tools — 2.0k")
    expect(f).toContain("MCP Tools — 500")
    expect(f).toContain("Conversation — 1.0k")
    expect(f).toContain("Free — 15k")
    t.destroy()
  })

  test("falls back to local estimate when context_breakdown errors", async () => {
    const gw = new MockGateway({ "session.context_breakdown": () => { throw new Error("old gateway") } })
    const t = await mountNode(<Context info={{ session_id: "s1", model: "test", context_max: 10_000, context_used: 1000 }} />, { gw })
    await until(t, () => gw.last("session.context_breakdown") !== undefined)
    const f = strip(t.frame())
    expect(gw.last("session.context_breakdown")?.params).toEqual({ session_id: "s1" })
    expect(f).toContain("Context · 1.0k / 10k (10%)")
    expect(f).toContain("Free — 9.0k")
    t.destroy()
  })


  test("uses session.info tools without legacy session JSON snapshots", async () => {
    const info: SessionInfo = {
      model: "test",
      context_max: 10_000,
      context_used: 1000,
      tools: { builtin: ["terminal"], mcp: ["mcp_search"] },
    }
    const t = await mountNode(<Context info={info} />)
    await t.settle()
    const f = strip(t.frame())
    expect(f).toContain("System Tools")
    expect(f).toContain("MCP Tools")
    t.destroy()
  })

  test("empty live tools do not fall back to legacy tool snapshots", async () => {
    const t = await mountNode(<Context info={{ model: "test", context_max: 10_000, context_used: 1000, tools: {} }} />)
    const f = strip(t.frame())
    expect(f).not.toContain("System Tools")
    expect(f).not.toContain("MCP Tools")
    t.destroy()
  })


  // In-grid threshold marker (◼ in textMuted past threshold).
  describe("threshold marker", () => {
    test("cells past threshold render ◼ in the grid", async () => {
      const info: SessionInfo = { model: "claude-opus-4-7", context_max: 200_000, context_used: 40_000 }
      const t = await mountNode(<Context info={info} />)
      const f = strip(t.frame())
      // All-free fixture, threshold 0.5 → rows 0-7 are ◻, rows 8-15 are ◼.
      // Assert on a run so the Breakdown legend's lone ◼ can't satisfy it.
      expect(f).toContain("◼ ◼ ◼ ◼")
      expect(f).toContain("◻ ◻ ◻ ◻")
      t.destroy()
    })

    test("drilled groups hide full-window compression markers", async () => {
      const info: SessionInfo = {
        model: "claude-opus-4-7",
        context_max: 200_000,
        usage: {
          input: 100,
          output: 50,
          total: 150,
          context_used: 40_000,
          context_max: 200_000,
          compressions: 3,
        },
        system_prompt: "# Project Context\n" + "project context ".repeat(100) + "\nConversation started:",
      }
      const t = await mountNode(<Context focused info={info} />)
      act(() => t.keys.pressArrow("down"))
      act(() => t.keys.pressEnter())
      await t.settle()

      const f = strip(t.frame())
      expect(f).toContain("Breakdown · System Prompt")
      expect(f).not.toContain("×3 compressed")
      expect(f).not.toContain("Beyond compression threshold")
      t.destroy()
    })
  })


  // Grid keyboard nav routes through list.* (rebind-aware) with ←/→
  // as tab-local aliases. With an empty sandbox (no system prompt, no
  // tools) top-level segments reduce to Conversation + Free. Asserts
  // target the focus legend line (` tok `), the only selection-driven
  // surface — the breakdown rows render `◼ Conversation` regardless.
  describe("keyboard nav", () => {
    const msgs: Message[] = [{
      id: "m1", role: "user", timestamp: 0,
      parts: [{ type: "text", content: "hello world ".repeat(50), streaming: false }],
      usage: { input: 200, output: 0, total: 200 },
    }]
    const info: SessionInfo = { model: "test", context_max: 10_000, context_used: 1000 }
    const legend = (f: string) => f.split("\n").find(l => l.includes(" tok ")) ?? ""

    test("↓ selects first; clamps at last; ← steps back; Esc clears", async () => {
      const t = await mountNode(<Context focused messages={msgs} info={info} />)
      await t.settle()
      expect(legend(strip(t.frame()))).toBe("")

      act(() => t.keys.pressArrow("down"))
      await t.settle()
      expect(legend(strip(t.frame()))).toContain("Conversation")

      // Three segs → two ↓ lands on Unknown / Provider Overhead.
      act(() => { t.keys.pressArrow("down"); t.keys.pressArrow("down") })
      await t.settle()
      expect(legend(strip(t.frame()))).toContain("Unknown / Provider Overhead")

      // ← alias behaves like list.up
      act(() => t.keys.pressArrow("left"))
      await t.settle()
      expect(legend(strip(t.frame()))).toContain("Conversation")

      // Enter on leaf with no children: no drill, selection holds
      act(() => t.keys.pressEnter())
      await t.settle()
      expect(legend(strip(t.frame()))).toContain("Conversation")
      expect(strip(t.frame())).toContain("Esc back")

      act(() => t.keys.pressEscape())
      await t.settle()
      expect(strip(t.frame())).not.toContain("Esc back")
      expect(legend(strip(t.frame()))).toBe("")
      t.destroy()
    })

    test("ignores keys when not focused", async () => {
      const t = await mountNode(<Context messages={msgs} info={info} />)
      act(() => t.keys.pressArrow("down"))
      await t.settle()
      expect(legend(strip(t.frame()))).toBe("")
      t.destroy()
    })
  })
})
