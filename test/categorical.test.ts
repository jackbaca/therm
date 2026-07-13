import { describe, test, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { categorical, hslToRgba, rgbaToHsl, luminance } from "../src/utils/categorical"

const key = (c: RGBA) => `${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)}`

describe("categorical ramp", () => {
  test("hsl roundtrip", () => {
    const src = RGBA.fromValues(0.2, 0.7, 0.4, 1)
    const [h, s, l] = rgbaToHsl(src)
    const back = hslToRgba(h, s, l)
    expect(back.r).toBeCloseTo(src.r, 3)
    expect(back.g).toBeCloseTo(src.g, 3)
    expect(back.b).toBeCloseTo(src.b, 3)
  })

  test("all N colors are unique RGBA", () => {
    const seed = RGBA.fromHex("#3b82f6")
    const bg = RGBA.fromHex("#0b0e14")
    const N = 12
    const ramp = categorical(seed, bg, N)
    expect(ramp).toHaveLength(N)
    const seen = new Set(ramp.map(key))
    expect(seen.size).toBe(N)
  })


  test("dark bg → higher lightness than light bg", () => {
    const seed = RGBA.fromHex("#3b82f6")
    const dark = categorical(seed, RGBA.fromHex("#000000"), 1)[0]
    const light = categorical(seed, RGBA.fromHex("#ffffff"), 1)[0]
    expect(luminance(dark)).toBeGreaterThan(luminance(light))
  })

  test("slot i is hue-stable across different seeds modulo offset", () => {
    // Changing seed rotates the whole ramp by a constant; pairwise hue deltas
    // between slots must be invariant.
    const bg = RGBA.fromHex("#0b0e14")
    const a = categorical(RGBA.fromHex("#3b82f6"), bg, 4).map(c => rgbaToHsl(c)[0])
    const b = categorical(RGBA.fromHex("#ef4444"), bg, 4).map(c => rgbaToHsl(c)[0])
    const da = ((a[1] - a[0]) + 360) % 360
    const db = ((b[1] - b[0]) + 360) % 360
    expect(da).toBeCloseTo(db, 3)
  })
})
