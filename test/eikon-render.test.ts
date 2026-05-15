import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { caps, native, chafa, thumb, cached, resetCache, defaults, S0, W, H } from "../src/utils/eikon-render"

describe("eikon-render", () => {
  test("thumb nearest-neighbor 48×24 → 16×8, center-pick", () => {
    // Checkerboard where each 3×3 block is a single char; center-pick
    // should preserve the coarse pattern exactly.
    const frame = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => (((x / 3 | 0) + (y / 3 | 0)) % 2 ? "#" : ".")).join(""))
    const t = thumb(frame)
    expect(t.length).toBe(8)
    expect(t[0]!.length).toBe(16)
    expect(t[0]![0]).toBe(".")
    expect(t[0]![1]).toBe("#")
  })

  test("defaults() seeds from KnobDef", () => {
    expect(defaults(chafa)).toEqual({
      symbols: "braille", fill: "none", dither: "none", invert: true,
      flip: "none", contrast: 1.0, threshold: 0.5,
    })
    expect(defaults(native).symbols).toBe("braille")
  })

  test("available() gates on caps", () => {
    expect(typeof chafa.available()).toBe(caps.chafa ? "boolean" : "string")
    expect(typeof native.available()).toBe(caps.ffmpeg ? "boolean" : "string")
  })

  test("cached() LRU hits on identical key", async () => {
    resetCache()
    const stub = {
      name: "stub", knobs: {}, spatial: false, video: false,
      available: () => true as const,
      render: async () => ({ frames: [Array.from({ length: H }, () => "x".repeat(W))] }),
    }
    let n = 0
    const spy = { ...stub, render: async (...a: Parameters<typeof stub.render>) => { n++; return stub.render(...a) } }
    await cached(spy, "/a", S0, {})
    await cached(spy, "/a", S0, {})
    expect(n).toBe(1)
    await cached(spy, "/b", S0, {})
    expect(n).toBe(2)
  })

  // Only runs when ffmpeg is installed (CI + dev boxes have it).
  const run = caps.ffmpeg ? test : test.skip
  const IMG = "/tmp/eikon-native-step.png"

  run("native: left-black/right-white step → braille halves differ", async () => {
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "nullsrc=s=64x64,format=gray,geq=lum=255*gte(X\\,32)",
      "-frames:v", "1", "-y", IMG])
    const out = await native.render(IMG, S0, defaults(native))
    expect("err" in out).toBe(false)
    if ("err" in out) return
    const row = out.frames[0]![H >> 1]!
    // Left half (dark, inverted→on) should differ from right half.
    expect(row.slice(0, W >> 1)).not.toBe(row.slice(W >> 1))
    // Block mode: left ≈ heavy, right ≈ light (invert on).
    const b = await native.render(IMG, S0, { ...defaults(native), symbols: "block" })
    if ("err" in b) throw new Error(b.err)
    const br = b.frames[0]![H >> 1]!
    expect("@#%*".includes(br[4]!)).toBe(true)
    expect(" .:".includes(br[W - 4]!)).toBe(true)
  })

  run("native: zoom crops — full-white at ox=1 zoom=0.3", async () => {
    const out = await native.render(IMG, { zoom: 0.3, ox: 1, oy: 0.5 }, { ...defaults(native), symbols: "block" })
    if ("err" in out) throw new Error(out.err)
    // Crop window sits entirely in the right (white) half → invert on → all-light.
    expect(out.frames[0]!.every(r => /^[ .:]+$/.test(r))).toBe(true)
  })

  const runc = caps.chafa && caps.ffmpeg ? test : test.skip
  runc("chafa: fill + dither + threshold flags reach the binary and change output", async () => {
    const base = await chafa.render(IMG, S0, defaults(chafa))
    const dith = await chafa.render(IMG, S0, { ...defaults(chafa), dither: "diffusion" })
    const fill = await chafa.render(IMG, S0, { ...defaults(chafa), symbols: "block", fill: "stipple" })
    if ("err" in base || "err" in dith || "err" in fill) throw new Error("render err")
    // Diffusion should perturb rows relative to dither=none.
    expect(dith.frames[0]!.join("\n")).not.toBe(base.frames[0]!.join("\n"))
    // Fill=stipple with block symbols should introduce ░/▒/▓.
    expect(fill.frames[0]!.join("")).toMatch(/[░▒▓]/)
    // threshold at either extreme must not error.
    const t0 = await chafa.render(IMG, S0, { ...defaults(chafa), threshold: 0 })
    expect("err" in t0).toBe(false)
  })

  runc("chafa: new symbol classes (quad, wedge) are accepted", async () => {
    for (const sym of ["quad", "half", "wedge"]) {
      const out = await chafa.render(IMG, S0, { ...defaults(chafa), symbols: sym })
      expect("err" in out).toBe(false)
    }
  })

  test("box()/thumb() preserve non-BMP codepoints (sextant U+1FB00+)", () => {
    // 48 sextants → 96 UTF-16 code units. box() must keep all 48.
    const sex = "\u{1FB17}"
    const raw = Array.from({ length: H }, () => sex.repeat(W)).join("\n")
    // call box via chafa being unavailable isn't practical; test via
    // the public cached() path with a stub rasterizer that returns raw.
    const r = { name: "t", knobs: {}, spatial: false, video: false,
      available: () => true as const, render: async () => ({ frames: [raw.split("\n")] }) }
    return cached(r, "/x", S0, {}).then(out => {
      if ("err" in out) throw new Error(out.err)
      // thumb() on a non-BMP frame — every output codepoint survives.
      const t = thumb(out.frames[0]!)
      expect(t.length).toBe(8)
      expect(t.every(row => Array.from(row).length === 16)).toBe(true)
      expect(t.every(row => Array.from(row).every(c => c === sex))).toBe(true)
    })
  })

  runc("chafa sextant output survives box() without U+FFFD", async () => {
    const out = await chafa.render(IMG, S0, { ...defaults(chafa), symbols: "sextant" })
    if ("err" in out) throw new Error(out.err)
    const f = out.frames[0]!
    // Every row has exactly 48 codepoints and no replacement char.
    for (const row of f) {
      expect(Array.from(row).length).toBe(W)
      expect(row).not.toContain("\uFFFD")
    }
  })
})
