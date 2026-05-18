// Rasterizer contract + built-in implementations for the Eikon tab.
//
// Studio owns all spatial + temporal work: decode the source at the
// target fps into a Clip (N gray planes), crop every plane at the
// current zoom/ox/oy, vstack them into one tall Window, and hand
// that to the rasterizer. The rasterizer emits N 48×24 frames in one
// call — chafa via a single filmstrip render, native via an
// in-process loop. Playback is then a cache lookup + index bump.
//
// decode(src, fps) runs ffmpeg once per (path, mtime, fps) and caches
// the Clip. Each spatial change is a row-copy slice of those planes
// (~2 ms for 64 frames) plus one PNG encode + one chafa spawn
// (~125 ms for 64 frames). Stills are the N=1 degenerate case.

import { deflateSync } from "node:zlib"
import { spawnSync } from "node:child_process"
import { statSync } from "node:fs"
import { chafaBin, resolveImage } from "./chafa"

export const W = 48
export const H = 24
export const FPS0 = 16
/** Hard frame cap — 16 s at fps=16. Longer clips truncate. */
const MAXF = 256

export type Spatial = { zoom: number; ox: number; oy: number }
export const S0: Spatial = { zoom: 1.0, ox: 0.5, oy: 0.5 }

/** Pixel-domain prep applied to the gray Window before it reaches
 *  any rasterizer. Rasterizer knobs are glyph-domain only. */
export type Flip = "none" | "h" | "v" | "hv"
export type Tone = { contrast: number; invert: boolean; flip: Flip }
export const T0: Tone = { contrast: 1.0, invert: true, flip: "none" }

export type KnobDef =
  | { kind: "cycle";  label?: string; hint?: string; options: readonly string[]; default: string }
  | { kind: "toggle"; label?: string; hint?: string; default: boolean }
  | { kind: "slider"; label?: string; hint?: string; min: number; max: number; step: number; default: number }

export type KnobValues = Record<string, string | number | boolean>

export type Frame = string[]
export type Rendered = { frames: Frame[] } | { err: string }

/** Pre-cropped grayscale window handed to rasterizers. `gray` is
 *  `frames` planes of `w×h` bytes vstacked row-major. `png()` lazily
 *  encodes the same pixels as one `w × h·frames` 8-bit grayscale PNG
 *  for CLI backends that read stdin. */
export type Window = {
  readonly gray: Uint8Array
  readonly w: number
  readonly h: number
  readonly frames: number
  png(): Uint8Array
}

export type Rasterizer = {
  readonly name: string
  /** Tonal knobs; order = panel order. */
  readonly knobs: Readonly<Record<string, KnobDef>>
  /** true if usable; otherwise a short reason shown dimmed in the picker. */
  available(): true | string
  /** Must return `win.frames` frames. `signal` aborts mid-render
   *  (kill subprocess, bail early); a rasterizer that ignores it
   *  still works — abort becomes a late-discard at the caller. */
  render(win: Window, knobs: KnobValues, signal?: AbortSignal): Promise<Rendered>
}

/** Seed a KnobValues bag from a rasterizer's defaults. */
export const defaults = (r: Rasterizer): KnobValues =>
  Object.fromEntries(Object.entries(r.knobs).map(([k, d]) => [k, d.default]))

export const caps = {
  chafa: chafaBin(),
  ffmpeg: spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0,
  ffprobe: spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0,
}

/** Source pixel dimensions via ffprobe; null when unavailable. Used
 *  only for the minimap aspect ratio — rasterizers never see it. */
export function probe(path: string): { w: number; h: number } | null {
  if (!caps.ffprobe) return null
  const r = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0", path,
  ], { encoding: "utf8" })
  if (r.status !== 0) return null
  const m = r.stdout.trim().match(/^(\d+),(\d+)/)
  return m ? { w: +m[1]!, h: +m[2]! } : null
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

// ── Clip decode + crop ───────────────────────────────────────────────

const SCALE = 384
const PLANE = SCALE * SCALE

export type Clip = { planes: Uint8Array[]; fps: number; w: number; h: number }

const VID = /\.(mp4|webm|mov|mkv|m4v|gif)$/i

// Decoded clips keyed by (path, mtime, fps). One ffmpeg spawn per key
// ever; every spatial change is a pure slice. ~9 MB per 64-frame clip.
const clips = new Map<string, Promise<Clip | string>>()
const CLIP_CAP = 8

export function decode(src: string, fps = FPS0): Promise<Clip | string> {
  const full = resolveImage(src)
  if (!full) return Promise.resolve(`not found: ${src}`)
  const mt = statSync(full, { throwIfNoEntry: false })?.mtimeMs ?? 0
  const key = `${full}:${mt}:${fps}`
  const got = clips.get(key)
  if (got) { clips.delete(key); clips.set(key, got); return got }
  if (!caps.ffmpeg) return Promise.resolve("ffmpeg not installed")
  const video = VID.test(full)
  const vf = [
    ...(video ? [`fps=${fps}`] : []),
    `scale=${SCALE}:${SCALE}:force_original_aspect_ratio=increase`,
    `crop=${SCALE}:${SCALE}`,
  ].join(",")
  const p = (async (): Promise<Clip | string> => {
    const ff = Bun.spawn(["ffmpeg",
      "-hide_banner", "-loglevel", "error", "-i", full,
      "-vf", vf, "-frames:v", video ? String(MAXF) : "1",
      "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ], { stdout: "pipe", stderr: "pipe" })
    const [buf, err] = await Promise.all([
      new Response(ff.stdout).arrayBuffer().then(b => new Uint8Array(b)),
      new Response(ff.stderr).text(),
    ])
    await ff.exited
    if (ff.exitCode !== 0) return `ffmpeg: ${err.trim() || "failed"}`
    if (buf.length === 0 || buf.length % PLANE !== 0)
      return `ffmpeg: bad read (${buf.length})`
    const n = buf.length / PLANE
    const planes = Array.from({ length: n }, (_, i) => buf.subarray(i * PLANE, (i + 1) * PLANE))
    return { planes, fps: video ? fps : 0, w: SCALE, h: SCALE }
  })()
  if (clips.size >= CLIP_CAP) clips.delete(clips.keys().next().value!)
  clips.set(key, p)
  return p
}

/** Pre-warm the clip cache without rendering. Studio calls this for
 *  every source on open so the first spatial change is decode-free. */
export const prewarm = (src: string, fps = FPS0) => void decode(src, fps)

/** Crop the same square window out of every plane; vstack. */
function crop(clip: Clip, sp: Spatial): Window {
  const side = Math.max(1, Math.round(clip.w * clamp(sp.zoom, 0.1, 1.0)))
  const x0 = Math.round((clip.w - side) * clamp(sp.ox, 0, 1))
  const y0 = Math.round((clip.h - side) * clamp(sp.oy, 0, 1))
  const n = clip.planes.length
  const gray = new Uint8Array(side * side * n)
  for (let f = 0; f < n; f++) {
    const pl = clip.planes[f]!
    const off = f * side * side
    for (let y = 0; y < side; y++)
      gray.set(pl.subarray((y0 + y) * clip.w + x0, (y0 + y) * clip.w + x0 + side), off + y * side)
  }
  let enc: Uint8Array | undefined
  return { gray, w: side, h: side, frames: n, png: () => (enc ??= png(gray, side, side * n)) }
}

/** One frame's slice of a Window — for rasterizers that can't batch. */
export function eachFrame(win: Window, i: number): Window {
  const sz = win.w * win.h
  const g = win.gray.subarray(i * sz, (i + 1) * sz)
  let enc: Uint8Array | undefined
  return { gray: g, w: win.w, h: win.h, frames: 1, png: () => (enc ??= png(g, win.w, win.h)) }
}

/** Minimal 8-bit grayscale PNG encoder. Level-1 deflate — chafa
 *  doesn't care about size, we care about encode time. */
function png(gray: Uint8Array, w: number, h: number): Uint8Array {
  const be32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
  const T = png_crc
  const crc = (b: Uint8Array) => {
    let c = ~0 >>> 0
    for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]!) & 255]! ^ (c >>> 8)
    return ~c >>> 0
  }
  const chunk = (tag: string, data: Uint8Array) => {
    const t = new TextEncoder().encode(tag)
    const body = new Uint8Array(t.length + data.length)
    body.set(t); body.set(data, 4)
    return [be32(data.length), body, be32(crc(body))]
  }
  const ihdr = new Uint8Array(13)
  ihdr.set(be32(w), 0); ihdr.set(be32(h), 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = new Uint8Array(h * (w + 1))
  for (let y = 0; y < h; y++) raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1)
  const idat = new Uint8Array(deflateSync(raw, { level: 1 }))
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunk("IHDR", ihdr), ...chunk("IDAT", idat), ...chunk("IEND", new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const png_crc = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

// ── LRU over rendered frame-arrays ───────────────────────────────────

const cache = new Map<string, Frame[]>()
const CAP = 256

function put(key: string, v: Frame[]) {
  if (cache.size >= CAP) cache.delete(cache.keys().next().value!)
  cache.set(key, v)
  return v
}

function hit(key: string): Frame[] | undefined {
  const v = cache.get(key)
  if (!v) return undefined
  cache.delete(key); cache.set(key, v)
  return v
}

export function resetCache() { cache.clear(); clips.clear() }

const keyOf = (r: string, src: string, sp: Spatial, tn: Tone, fps: number, k: KnobValues) =>
  `${r}|${src}|${fps}|${sp.zoom.toFixed(3)}:${sp.ox.toFixed(3)}:${sp.oy.toFixed(3)}|${tn.contrast.toFixed(2)}:${+tn.invert}:${tn.flip}|${JSON.stringify(k)}`

/** Decode → crop → tone → rasterize (all frames), with LRU over the result. */
export async function cached(r: Rasterizer, src: string, sp: Spatial, tn: Tone,
                             fps: number, k: KnobValues, signal?: AbortSignal): Promise<Rendered> {
  const key = keyOf(r.name, src, sp, tn, fps, k)
  const got = hit(key)
  if (got) return { frames: got }
  const cl = await decode(src, fps)
  if (typeof cl === "string") return { err: cl }
  if (signal?.aborted) return { err: "aborted" }
  const out = await r.render(tone(crop(cl, sp), tn), k, signal)
  if ("err" in out) return out
  if (signal?.aborted) return { err: "aborted" }
  return { frames: put(key, out.frames) }
}

/** Normalize one frame to exactly H rows × W cols. Non-BMP glyphs
 *  (sextant/wedge = U+1FB00+) are surrogate pairs — iterate by
 *  codepoint so OpenTUI's TextEncoder never sees lone surrogates. */
function pad(rows: string[]): Frame {
  const out = rows.slice(0, H)
  while (out.length < H) out.push("")
  return out.map(l => {
    if (l.includes("\x1b[")) return l
    const cp = Array.from(l)
    return cp.length >= W ? cp.slice(0, W).join("") : l + " ".repeat(W - cp.length)
  })
}

/** Split a filmstrip text output (N·24 rows) into N padded frames. */
function box(out: string, n: number): Frame[] {
  const rows = out.replace(/\n$/, "").split("\n")
  return Array.from({ length: n }, (_, i) => pad(rows.slice(i * H, (i + 1) * H)))
}

/** Nearest-neighbor downsample of a 48×24 frame to w×h (center-pick).
 *  Codepoint-indexed so non-BMP glyphs survive. */
export function thumb(frame: Frame, w = 16, h = 8): Frame {
  const fx = W / w, fy = H / h
  return Array.from({ length: h }, (_, y) => {
    const row = Array.from(frame[Math.min(H - 1, Math.floor(y * fy + fy / 2))] ?? "")
    const n = row.length
    return Array.from({ length: w }, (_, x) =>
      row[Math.min(n - 1, Math.floor(x * fx + fx / 2))] ?? " ").join("")
  })
}

// ── chafa ────────────────────────────────────────────────────────────

/** Apply flip/contrast on every plane of the gray buffer in-place.
 *  Called by `cached()` after `crop()` so every rasterizer sees the
 *  same tone-mapped Window; rasterizers never touch contrast/flip. */
export function tone(win: Window, t: Tone): Window {
  const { gray: g, w, h, frames: n } = win
  const sz = w * h
  const flip = t.flip, con = clamp(t.contrast, 0.25, 4.0)
  for (let f = 0; f < n; f++) {
    const o = f * sz
    if (flip === "h" || flip === "hv")
      for (let y = 0; y < h; y++) {
        const ro = o + y * w
        for (let x = 0; x < w >> 1; x++) { const t = g[ro + x]!; g[ro + x] = g[ro + w - 1 - x]!; g[ro + w - 1 - x] = t }
      }
    if (flip === "v" || flip === "hv")
      for (let y = 0; y < h >> 1; y++) {
        const a = g.subarray(o + y * w, o + (y + 1) * w)
        const b = g.subarray(o + (h - 1 - y) * w, o + (h - y) * w)
        const t = new Uint8Array(a); a.set(b); b.set(t)
      }
  }
  if (Math.abs(con - 1) > 1e-3) {
    // Center on the per-plane mean, not 128 — a photographic source
    // whose pixels cluster well above or below mid-gray (a bright
    // moon scene, a dark owl on a dark branch) barely shifts under
    // a 128-pivot multiply because most of the dynamic range sits
    // in the clamp tails. Mean-centering keeps the slider effective
    // across arbitrary luminance distributions.
    for (let f = 0; f < n; f++) {
      const o = f * sz
      let sum = 0
      for (let i = 0; i < sz; i++) sum += g[o + i]!
      const m = sum / sz
      for (let i = 0; i < sz; i++) g[o + i] = clamp(Math.round((g[o + i]! - m) * con + m), 0, 255)
    }
  }
  if (t.invert) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i]!
  return win
}

export const chafa: Rasterizer = {
  name: "chafa",
  knobs: {
    symbols:   { kind: "cycle",  options: ["braille", "block", "ascii", "sextant", "quad", "half", "wedge"], default: "braille",
                 hint: "Glyph family used to draw pixels. Braille is densest; block is boldest; ascii is most compatible." },
    fill:      { kind: "cycle",  options: ["none", "stipple", "ascii", "braille"], default: "none",
                 hint: "Secondary glyph set used where the primary leaves gaps." },
    dither:    { kind: "cycle",  options: ["none", "ordered", "diffusion", "noise"], default: "none",
                 hint: "Adds texture to smooth gradients so mid-tones don't band." },
  },
  available: () => caps.chafa ? true : "chafa not installed",
  async render(win, k, signal) {
    const bin = caps.chafa
    if (!bin) return { err: "chafa not installed" }
    const fill = String(k.fill ?? "none")
    const args = [
      `--size=${W}x${H * win.frames}`, "--format=symbols", "--stretch", "--colors=none",
      `--symbols=${String(k.symbols ?? "braille")}`,
      ...(fill === "none" ? [] : [`--fill=${fill}`]),
      `--dither=${String(k.dither ?? "none")}`,
      // chafa's default --preprocess auto-levels the input, which
      // would undo the studio-owned tone() pass. Invert is also
      // applied upstream (255-g), so --invert is never passed.
      "--preprocess", "off",
      "-",
    ]
    if (signal?.aborted) return { err: "aborted" }
    const ch = Bun.spawn([bin, ...args], { stdin: win.png(), stdout: "pipe", stderr: "pipe" })
    const kill = () => ch.kill()
    signal?.addEventListener("abort", kill, { once: true })
    const [out, cerr] = await Promise.all([
      new Response(ch.stdout).text(), new Response(ch.stderr).text(),
    ])
    await ch.exited
    signal?.removeEventListener("abort", kill)
    if (signal?.aborted) return { err: "aborted" }
    if (ch.exitCode !== 0) return { err: `chafa: ${cerr.trim() || "failed"}` }
    return { frames: box(out, win.frames) }
  },
}

// ── native ───────────────────────────────────────────────────────────

const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]] as const
const RAMP = " .:-=+*#%@"

function sample(g: Uint8Array, w: number, h: number, fw: number, fh: number) {
  const sx = w / fw, sy = h / fh
  return (gx: number, gy: number) =>
    g[Math.min(h - 1, Math.floor(gy * sy)) * w + Math.min(w - 1, Math.floor(gx * sx))]!
}

function mean(g: Uint8Array): number {
  let s = 0
  for (let i = 0; i < g.length; i++) s += g[i]!
  return s / g.length
}

function braille(g: Uint8Array, w: number, h: number): Frame {
  const at = sample(g, w, h, W * 2, H * 4)
  // Mean threshold on the already-tone()d plane — contrast/invert
  // are studio-owned and applied upstream.
  const thr = mean(g)
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let row = ""
    for (let x = 0; x < W; x++) {
      let bits = 0
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        if (at(x * 2 + dx, y * 4 + dy) > thr) bits |= DOT[dy]![dx]!
      }
      row += String.fromCodePoint(0x2800 + bits)
    }
    rows.push(row)
  }
  return rows
}

function block(g: Uint8Array, w: number, h: number): Frame {
  const at = sample(g, w, h, W, H)
  const n = RAMP.length - 1
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let row = ""
    for (let x = 0; x < W; x++) row += RAMP[Math.round(at(x, y) / 255 * n)]
    rows.push(row)
  }
  return rows
}

export const native: Rasterizer = {
  name: "native",
  knobs: {
    symbols:  { kind: "cycle",  options: ["braille", "block"], default: "braille",
                hint: "Glyph family used to draw pixels. Braille is denser; block is bolder." },
  },
  available: () => caps.ffmpeg ? true : "ffmpeg not installed",
  async render(win, k) {
    const fn = k.symbols === "block" ? block : braille
    const sz = win.w * win.h
    const frames = Array.from({ length: win.frames }, (_, i) =>
      fn(win.gray.subarray(i * sz, (i + 1) * sz), win.w, win.h))
    return { frames }
  },
}

export const BUILTIN: readonly Rasterizer[] = [chafa, native]

/** Wrap a raw gray buffer as a Window (tests / in-process rasterizers). */
export const windowOf = (gray: Uint8Array, w: number, h: number, frames = 1): Window => {
  let enc: Uint8Array | undefined
  return { gray, w, h, frames, png: () => (enc ??= png(gray, w, h * frames)) }
}

export * as render from "./eikon-render"
