import { describe, expect, test } from "bun:test"
import type { ParsedKey } from "@opentui/core"
import { parse, match, from, toBindings } from "../src/keys/chord"

const k = (o: Partial<ParsedKey> & { name: string }): ParsedKey => ({
  ctrl: false, meta: false, shift: false, option: false, super: false,
  number: false, sequence: o.name, raw: o.name, eventType: "press", source: "raw",
  ...o,
})

describe("chord.parse", () => {
  test("none / empty → []", () => {
    expect(parse("none")).toEqual([])
    expect(parse("")).toEqual([])
  })

  test("single key", () => {
    expect(parse("return")).toEqual([
      { name: "return", ctrl: false, meta: false, shift: false, super: false, leader: false },
    ])
  })

  test("modifiers", () => {
    const [c] = parse("ctrl+shift+k")
    expect(c).toMatchObject({ name: "k", ctrl: true, shift: true, meta: false })
  })

  test("alt/meta/option alias", () => {
    expect(parse("alt+v")[0].meta).toBe(true)
    expect(parse("option+v")[0].meta).toBe(true)
    expect(parse("meta+v")[0].meta).toBe(true)
  })

  test("comma-separated alternates", () => {
    const list = parse("shift+return,ctrl+return,ctrl+j")
    expect(list).toHaveLength(3)
    expect(list[2]).toMatchObject({ name: "j", ctrl: true })
  })

  test("leader", () => {
    expect(parse("<leader>e")[0]).toMatchObject({ name: "e", leader: true, ctrl: false })
    expect(parse("<leader>shift+x")[0]).toMatchObject({ name: "x", leader: true, shift: true })
  })

  test("name aliases", () => {
    expect(parse("esc")[0].name).toBe("escape")
    expect(parse("enter")[0].name).toBe("return")
    expect(parse("del")[0].name).toBe("delete")
  })

  test("case-insensitive, whitespace-tolerant", () => {
    expect(parse("Ctrl+K")[0]).toMatchObject({ name: "k", ctrl: true })
    expect(parse(" ctrl + k ")[0]).toMatchObject({ name: "k", ctrl: true })
  })
})

describe("chord.match", () => {
  test("exact modifier match required", () => {
    const list = parse("ctrl+k")
    expect(match(list, k({ name: "k", ctrl: true }))).toBe(true)
    expect(match(list, k({ name: "k" }))).toBe(false)
    expect(match(list, k({ name: "k", ctrl: true, shift: true }))).toBe(false)
  })

  test("any alternate matches", () => {
    const list = parse("shift+return,ctrl+j")
    expect(match(list, k({ name: "return", shift: true }))).toBe(true)
    expect(match(list, k({ name: "j", ctrl: true }))).toBe(true)
    expect(match(list, k({ name: "return" }))).toBe(false)
  })

  test("space normalization (kitty vs legacy)", () => {
    const list = parse("space")
    expect(match(list, k({ name: "space" }))).toBe(true)
    expect(match(list, k({ name: " " }))).toBe(true)
  })

  test("leader gating", () => {
    const list = parse("<leader>e")
    expect(match(list, k({ name: "e" }), false)).toBe(false)
    expect(match(list, k({ name: "e" }), true)).toBe(true)
    // leader-armed but chord doesn't want leader
    expect(match(parse("e"), k({ name: "e" }), true)).toBe(false)
  })

  test("empty list never matches", () => {
    expect(match([], k({ name: "x" }))).toBe(false)
    expect(match(parse("none"), k({ name: "x" }))).toBe(false)
  })
})


describe("chord.from", () => {
  test("super defaults false when absent", () => {
    expect(from(k({ name: "x" })).super).toBe(false)
  })
})

describe("chord.toBindings", () => {
  test("omits false modifiers (textarea keyBindings convention)", () => {
    const b = toBindings(parse("shift+return,ctrl+j"), "newline")
    expect(b).toEqual([
      { name: "return", shift: true, ctrl: undefined, meta: undefined, super: undefined, action: "newline" },
      { name: "j", ctrl: true, shift: undefined, meta: undefined, super: undefined, action: "newline" },
    ])
  })
})
