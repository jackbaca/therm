import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { caps, native, chafa, thumb, cached, resetCache, defaults, windowOf, tone, S0, T0, W, H } from "../src/utils/eikon-render"

describe("eikon-render", () => {
  test("thumb nearest-neighbor 48×24 → 16×8, center-pick", () => {
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
      symbols: "braille", fill: "none", dither: "none",
    })
    expect(defaults(native)).toEqual({ symbols: "braille" })
  })

  test("available() gates on caps", () => {
    expect(typeof chafa.available()).toBe(caps.chafa ? "boolean" : "string")
    expect(typeof native.available()).toBe(caps.ffmpeg ? "boolean" : "string")
  })

  test("Window.png() produces a valid PNG header + dims", () => {
    const win = windowOf(new Uint8Array(32 * 32).fill(200), 32, 32)
    const p = win.png()
    // Magic + IHDR at fixed offset.
    expect([...p.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect([...p.slice(12, 16)]).toEqual([73, 72, 68, 82])  // "IHDR"
    // width/height big-endian at 16..24.
    const be = (o: number) => (p[o]! << 24 | p[o+1]! << 16 | p[o+2]! << 8 | p[o+3]!) >>> 0
    expect(be(16)).toBe(32); expect(be(20)).toBe(32)
    // bit-depth 8, colour-type 0 (gray).
    expect(p[24]).toBe(8); expect(p[25]).toBe(0)
    // Lazy: second call is the same object.
    expect(win.png()).toBe(p)
  })

  test("native renders a synthetic window without any subprocess", async () => {
    // Left-black / right-white 64×64 plane.
    const g = new Uint8Array(64 * 64)
    for (let y = 0; y < 64; y++) for (let x = 32; x < 64; x++) g[y * 64 + x] = 255
    const out = await native.render(windowOf(g, 64, 64), defaults(native))
    if ("err" in out) throw new Error(out.err)
    const row = out.frames[0]![H >> 1]!
    expect(row.slice(0, W >> 1)).not.toBe(row.slice(W >> 1))
    // block mode: right (white) half heavy — invert is studio-owned
    // and not applied here, so rasterizer maps bright→dense directly.
    const b = await native.render(windowOf(g, 64, 64), { ...defaults(native), symbols: "block" })
    if ("err" in b) throw new Error(b.err)
    const br = b.frames[0]![H >> 1]!
    expect("@#%*".includes(br[W - 4]!)).toBe(true)
    expect(" .:".includes(br[4]!)).toBe(true)
  })

  test("cached() LRU hits on identical key; miss re-renders", async () => {
    resetCache()
    let n = 0
    const stub = {
      name: "stub", knobs: {},
      available: () => true as const,
      render: async () => { n++; return { frames: [Array.from({ length: H }, () => "x".repeat(W))] } },
    }
    // cached() decodes src first — gate on ffmpeg.
    if (!caps.ffmpeg) return
    const IMG = "/tmp/eikon-cache.png"
    spawnSync("ffmpeg", ["-hide_banner","-loglevel","error","-f","lavfi","-i","color=gray:s=32x32","-frames:v","1","-y",IMG])
    await cached(stub, IMG, S0, T0, 16, {})
    await cached(stub, IMG, S0, T0, 16, {})
    expect(n).toBe(1)
    await cached(stub, IMG, { zoom: 0.5, ox: 0.3, oy: 0.7 }, T0, 16, {})
    expect(n).toBe(2)
  })

  const run = caps.ffmpeg ? test : test.skip
  const IMG = "/tmp/eikon-step.png"

  run("cached(): decode once, crop many — zoom crops correctly", async () => {
    resetCache()
    spawnSync("ffmpeg", ["-hide_banner","-loglevel","error","-f","lavfi",
      "-i","nullsrc=s=64x64,format=gray,geq=lum=255*gte(X\\,32)","-frames:v","1","-y",IMG])
    // Crop window at ox=1 zoom=0.3 sits entirely in the right (white)
    // half; T0.invert maps it to all-black → all-light glyphs.
    const out = await cached(native, IMG, { zoom: 0.3, ox: 1, oy: 0.5 }, T0, 16, { ...defaults(native), symbols: "block" })
    if ("err" in out) throw new Error(out.err)
    expect(out.frames[0]!.every(r => /^[ .:]+$/.test(r))).toBe(true)
    // ox=0 → all-black → inverted → all-heavy.
    const l = await cached(native, IMG, { zoom: 0.3, ox: 0, oy: 0.5 }, T0, 16, { ...defaults(native), symbols: "block" })
    if ("err" in l) throw new Error(l.err)
    expect(l.frames[0]!.every(r => /^[@#%*]+$/.test(r))).toBe(true)
  })

  const runc = caps.chafa && caps.ffmpeg ? test : test.skip

  runc("chafa reads the in-process PNG window; ffmpeg absent from hot path", async () => {
    resetCache()
    // One spawn visible: chafa. (We can't count spawns here, but the
    // fact that this works at all proves png() is well-formed.)
    const out = await cached(chafa, IMG, S0, T0, 16, defaults(chafa))
    expect("err" in out).toBe(false)
  })

  runc("chafa: fill + dither flags reach the binary and change output", async () => {
    resetCache()
    spawnSync("ffmpeg", ["-hide_banner","-loglevel","error","-f","lavfi",
      "-i","mandelbrot=s=256x256","-frames:v","1","-y","/tmp/eikon-mand.png"])
    const M = "/tmp/eikon-mand.png"
    const base = await cached(chafa, M, S0, T0, 16, defaults(chafa))
    const dith = await cached(chafa, M, S0, T0, 16, { ...defaults(chafa), dither: "diffusion" })
    const fill = await cached(chafa, M, S0, T0, 16, { ...defaults(chafa), symbols: "block", fill: "stipple" })
    if ("err" in base || "err" in dith || "err" in fill) throw new Error("render err")
    expect(dith.frames[0]!.join("\n")).not.toBe(base.frames[0]!.join("\n"))
    expect(fill.frames[0]!.join("")).toMatch(/[░▒▓]/)
  })

    runc("tone: flip applied on the gray buffer before rasterize", async () => {
    resetCache()
    const a = await cached(chafa, IMG, S0, T0, 16, { ...defaults(chafa), symbols: "block" })
    const b = await cached(chafa, IMG, S0, { ...T0, flip: "h" }, 16, { ...defaults(chafa), symbols: "block" })
    if ("err" in a || "err" in b) throw new Error("render err")
    // Horizontal flip of a left/right step swaps where the █ run sits.
    const ar = a.frames[0]![H >> 1]!, br = b.frames[0]![H >> 1]!
    expect(ar.indexOf("█")).toBeLessThan(W >> 1)
    expect(br.lastIndexOf("█")).toBeGreaterThanOrEqual(W >> 1)
    expect(ar).not.toBe(br)
  })

  test("tone: mean-centered contrast responds on off-mean sources", () => {
    // 64 px all at 200 except 4 px at 40 → mean ≈ 190. A 128-pivot
    // multiply would barely change anything; mean-centered pushes
    // the 200s up and the 40s down.
    const g = new Uint8Array(64).fill(200)
    g[0] = g[1] = g[2] = g[3] = 40
    const win = windowOf(new Uint8Array(g), 8, 8)
    tone(win, { contrast: 2, invert: false, flip: "none" })
    expect(win.gray[10]).toBeGreaterThan(200)
    expect(win.gray[0]).toBeLessThan(40)
  })

  test("tone: invert is 255-g, post-contrast", () => {
    const g = Uint8Array.of(0, 64, 128, 255)
    tone(windowOf(g, 4, 1), { contrast: 1, invert: true, flip: "none" })
    expect(Array.from(g)).toEqual([255, 191, 127, 0])
  })

  runc("chafa: symbol classes incl. non-BMP (sextant/wedge) accepted, no U+FFFD", async () => {
    resetCache()
    for (const sym of ["quad", "half", "wedge", "sextant"]) {
      const out = await cached(chafa, IMG, S0, T0, 16, { ...defaults(chafa), symbols: sym })
      if ("err" in out) throw new Error(`${sym}: ${out.err}`)
      for (const row of out.frames[0]!) {
        expect(Array.from(row).length).toBe(W)
        expect(row).not.toContain("\uFFFD")
      }
    }
  })

  test("thumb() preserves non-BMP codepoints", () => {
    const sex = "\u{1FB17}"
    const f = Array.from({ length: H }, () => sex.repeat(W))
    const t = thumb(f)
    expect(t.length).toBe(8)
    expect(t.every(row => Array.from(row).length === 16)).toBe(true)
    expect(t.every(row => Array.from(row).every(c => c === sex))).toBe(true)
  })

  run("video: decode at fps, filmstrip returns N frames, frames differ", async () => {
    resetCache()
    const V = "/tmp/eikon-vid.mp4"
    // 1s of animated testsrc at 24fps.
    spawnSync("ffmpeg", ["-hide_banner","-loglevel","error","-f","lavfi",
      "-i","testsrc=s=128x128:r=24:d=1","-pix_fmt","yuv420p","-y",V])
    const out = await cached(native, V, S0, T0, 12, defaults(native))
    if ("err" in out) throw new Error(out.err)
    // 1s @ 12fps → 12 frames.
    expect(out.frames.length).toBe(12)
    expect(out.frames[0]!.join("")).not.toBe(out.frames[6]!.join(""))
    // fps change = different clip key → re-decode, different count.
    const out8 = await cached(native, V, S0, T0, 8, defaults(native))
    if ("err" in out8) throw new Error(out8.err)
    expect(out8.frames.length).toBe(8)
  })

  runc("chafa filmstrip: N-frame video → N padded frames, no U+FFFD", async () => {
    resetCache()
    const V = "/tmp/eikon-vid.mp4"
    const out = await cached(chafa, V, S0, T0, 8, { ...defaults(chafa), symbols: "sextant" })
    if ("err" in out) throw new Error(out.err)
    expect(out.frames.length).toBe(8)
    for (const f of out.frames) {
      expect(f.length).toBe(H)
      for (const row of f) {
        expect(Array.from(row).length).toBe(W)
        expect(row).not.toContain("\uFFFD")
      }
    }
  })

  test("windowOf(…, frames=3): native returns 3 frames; eachFrame slices", async () => {
    // 3 distinct 4×4 planes: luminance 0, 128, 255.
    const g = new Uint8Array(4 * 4 * 3)
    g.fill(0, 0, 16); g.fill(128, 16, 32); g.fill(255, 32, 48)
    const out = await native.render(windowOf(g, 4, 4, 3), { ...defaults(native), symbols: "block" })
    if ("err" in out) throw new Error(out.err)
    expect(out.frames.length).toBe(3)
    // No rasterizer invert; bright plane → dense glyph.
    expect(out.frames[0]![0]![0]).toBe(" ")
    expect(out.frames[2]![0]![0]).toBe("@")
  })
})
