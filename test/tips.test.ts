import { describe, test, expect } from "bun:test"
import { tips } from "../src/service/tips"

describe("tips", () => {
  test("loadTips parses hermes_cli/tips.py into a flat string list", () => {
    const t = tips.loadTips()
    expect(t.length).toBeGreaterThan(10)
    // Every entry is a single non-empty line (source is one string per line).
    for (const tip of t) {
      expect(tip.length).toBeGreaterThan(0)
      expect(tip).not.toContain("\n")
    }
    // Corpus contains slash-command tips (structural, not pinned to a
    // specific command — upstream rewords entries).
    expect(t.some(s => /^\/[a-z]+ /.test(s))).toBe(true)

  })

  test("splitTip highlights /slash, @ref, keybind, `code`, quoted", () => {
    const p = tips.splitTip('Use /model or Ctrl+G to edit `foo.ts` with @file:bar and "baz".')
    const hl = p.filter(x => x.hl).map(x => x.t)
    expect(hl).toEqual(["/model", "Ctrl+G", "foo.ts", "@file:bar", '"baz"'])
    // Reassembly covers whole input (modulo stripped backticks).
    const joined = p.map(x => x.t).join("")
    expect(joined).toBe('Use /model or Ctrl+G to edit foo.ts with @file:bar and "baz".')
  })

  test("splitTip on plain text yields single non-highlight part", () => {
    const p = tips.splitTip("nothing special here")
    expect(p).toEqual([{ t: "nothing special here", hl: false }])
  })

  test("parseTips extracts escaped one-line literals", () => {
    const src = `TIPS = [\n    "one",\n    "quote: \\"two\\"",\n]\n`
    expect(tips.parseTips(src)).toEqual(["one", 'quote: "two"'])
  })

  test("randomTip deterministically avoids the previous value", () => {
    expect(tips.randomTip(undefined, () => 0, ["a", "b", "c"])).toBe("a")
    expect(tips.randomTip("a", () => 0, ["a", "b", "c"])).toBe("b")
    expect(tips.randomTip("only", () => 0, ["only"])).toBe("only")
  })

  test("resetTips drops the cached corpus", () => {
    const first = tips.loadTips()
    tips.resetTips()
    const second = tips.loadTips()
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

})
