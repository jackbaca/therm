import { describe, expect, test } from "bun:test"
import { knobs, STATES } from "../src/utils/eikon-knobs"
import { native, S0, type KnobDef } from "../src/utils/eikon-render"

describe("eikon-knobs", () => {
  const s0 = knobs.fresh("owl", native)

  test("fresh seeds rasterizer defaults; no dirty", () => {
    expect(s0.rasterizer).toBe("native")
    expect(s0.state).toBe("idle")
    expect(s0.dirty).toBe(false)
    expect(s0.base.symbols).toBe("braille")
    expect(s0.spatial).toEqual(S0)
  })

  test("fresh honors studio.json seed (glyph, spatial survive)", () => {
    const s = knobs.fresh("owl", native, { glyph: "◈", spatial: { zoom: 0.5, ox: 0.2, oy: 0.8 } } as never)
    expect(s.glyph).toBe("◈")
    expect(s.spatial.zoom).toBe(0.5)
  })

  test("step: cycle wraps, slider clamps, toggle flips", () => {
    const cyc: KnobDef = { kind: "cycle", options: ["a", "b", "c"], default: "a" }
    expect(knobs.step({ x: "c" }, "x", cyc, 1).x).toBe("a")
    expect(knobs.step({ x: "a" }, "x", cyc, -1).x).toBe("c")
    const sl: KnobDef = { kind: "slider", min: 0, max: 1, step: 0.3, default: 0.5 }
    let v = { x: 0.5 }
    for (let i = 0; i < 10; i++) v = knobs.step(v, "x", sl, 1) as { x: number }
    expect(v.x).toBe(1)
    const tg: KnobDef = { kind: "toggle", default: false }
    expect(knobs.step({ x: false }, "x", tg, 1).x).toBe(true)
  })

  test("edit writes base until forked, then per[state]; fork/unfork", () => {
    const a = knobs.edit(s0, k => ({ ...k, invert: false }))
    expect(a.base.invert).toBe(false)
    expect(a.dirty).toBe(true)
    const f = knobs.fork(a)
    expect(f.per.idle).toBeDefined()
    const b = knobs.edit(f, k => ({ ...k, invert: true }))
    expect(b.per.idle!.invert).toBe(true)
    expect(b.base.invert).toBe(false)
    expect(knobs.unfork(b).per.idle).toBeUndefined()
  })

  test("pan/zoom clamp to [0,1] / [0.1,1]", () => {
    let sp = S0
    for (let i = 0; i < 100; i++) sp = knobs.pan(sp, 1, 1)
    expect(sp.ox).toBe(1); expect(sp.oy).toBe(1)
    for (let i = 0; i < 100; i++) sp = knobs.zoom(sp, -1)
    expect(sp.zoom).toBe(0.1)
  })

  test("cycle wraps states (closed set)", () => {
    let s = s0
    for (let i = 0; i < STATES.length; i++) s = knobs.cycle(s, 1)
    expect(s.state).toBe("idle")
  })

  test("swap resets tonal, preserves spatial", () => {
    const moved = { ...s0, spatial: { zoom: 0.5, ox: 0.3, oy: 0.7 }, base: { ...s0.base, symbols: "block" } }
    const sw = knobs.swap(moved, native)
    expect(sw.spatial.zoom).toBe(0.5)
    expect(sw.base.symbols).toBe("braille")  // back to default
    expect(sw.per).toEqual({})
  })

  test("slug normalizes", () => {
    expect(knobs.slug("  Foo Bar!! ")).toBe("foo-bar")
    expect(knobs.slug("###")).toBe("wip")
  })
})
