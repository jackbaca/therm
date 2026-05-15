// Rasterizer contract + built-in implementations for the Eikon tab.
//
// Studio owns all spatial work (decode, crop, flip, contrast). A
// rasterizer receives a pre-cropped grayscale `Window` and only
// decides how luminance maps to glyphs. That makes zoom/pan uniform
// across every backend and keeps the per-frame hot path free of
// process spawns for in-process rasterizers.
//
// Source decode (ffmpeg → 384×384 gray plane) happens once per
// (path, mtime) and is cached. Each spatial change is a row-copy
// slice of that plane (~0.1 ms). CLI rasterizers get the window as a
// lazily-encoded PNG on stdin (~1 ms encode via node:zlib).
//
// Built-ins:
//   chafa  — pipes win.png() to `chafa -`; symbols/fill/dither/invert
//            /flip/contrast/threshold all applied chafa-side or on
//            the gray buffer in-process; no ffmpeg in the hot path.
//   native — reads win.gray directly; braille/block; ~0.3 ms warm.

import { deflateSync } from "node:zlib"
import { spawnSync } from "node:child_process"
import { statSync } from "node:fs"
import { chafaBin, resolveImage } from "./chafa"

export const W = 48
export const H = 24

export type Spatial = { zoom: number; ox: number; oy: number }
export const S0: Spatial = { zoom: 1.0, ox: 0.5, oy: 0.5 }

export type KnobDef =
  | { kind: "cycle";  label?: string; options: readonly string[]; default: string }
  | { kind: "toggle"; label?: string; default: boolean }
  | { kind: "slider"; label?: string; min: number; max: number; step: number; default: number }

export type KnobValues = Record<string, string | number | boolean>

export type Frame = string[]
export type Rendered = { frames: Frame[] } | { err: string }

/** Pre-cropped grayscale window handed to rasterizers. `gray` is
 *  row-major `w*h` bytes. `png()` lazily encodes the same pixels as
 *  an 8-bit grayscale PNG for CLI backends that read stdin. */
export type Window = {
  readonly gray: Uint8Array
  readonly w: number
  readonly h: number
  png(): Uint8Array
}

export type Rasterizer = {
  readonly name: string
  /** Tonal knobs; order = panel order. */
  readonly knobs: Readonly<Record<string, KnobDef>>
  /** true if usable; otherwise a short reason shown dimmed in the picker. */
  available(): true | string
  /** `signal` aborts mid-render (kill subprocess, bail early). A
   *  rasterizer that ignores it still works; abort just becomes a
   *  late-discard at the caller. */
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

/** Normalize rasterizer text output to exactly H rows × W cols. Rows
 *  carrying SGR escapes are passed through unpadded (width accounting
 *  under ANSI is the rasterizer's job). Non-BMP glyphs (sextant/wedge
 *  = U+1FB00+) are surrogate pairs in JS strings — String.slice by
 *  code unit would split them and OpenTUI's TextEncoder then emits
 *  U+FFFD for each lone surrogate. Iterate by codepoint instead. */
function box(out: string): Frame {
  const rows = out.replace(/\n$/, "").split("\n")
  while (rows.length < H) rows.push("")
  return rows.slice(0, H).map(l => {
    if (l.includes("\x1b[")) return l
    const cp = Array.from(l)
    return cp.length >= W ? cp.slice(0, W).join("") : l + " ".repeat(W - cp.length)
  })
}

// ── Plane decode + crop ──────────────────────────────────────────────

const SCALE = 384

type Plane = { buf: Uint8Array; w: number; h: number }

// Decoded gray planes keyed by (resolved path, mtime). One ffmpeg
// spawn per source ever; every spatial change is a pure slice.
const planes = new Map<string, Promise<Plane | string>>()

async function decode(src: string): Promise<Plane | string> {
  const full = resolveImage(src)
  if (!full) return `not found: ${src}`
  const mt = statSync(full, { throwIfNoEntry: false })?.mtimeMs ?? 0
  const key = `${full}:${mt}`
  const got = planes.get(key)
  if (got) return got
  if (!caps.ffmpeg) return "ffmpeg not installed"
  // Preserve aspect into a SCALE×SCALE letterbox so the crop math
  // (square window over the short side) matches the old ffmpeg
  // `crop=min(iw,ih)*z` semantics.
  const p = (async (): Promise<Plane | string> => {
    const ff = Bun.spawn(["ffmpeg",
      "-hide_banner", "-loglevel", "error", "-i", full, "-frames:v", "1",
      "-vf", `scale=${SCALE}:${SCALE}:force_original_aspect_ratio=increase,crop=${SCALE}:${SCALE}`,
      "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ], { stdout: "pipe", stderr: "pipe" })
    const [buf, err] = await Promise.all([
      new Response(ff.stdout).arrayBuffer().then(b => new Uint8Array(b)),
      new Response(ff.stderr).text(),
    ])
    await ff.exited
    if (ff.exitCode !== 0) return `ffmpeg: ${err.trim() || "failed"}`
    if (buf.length !== SCALE * SCALE) return `ffmpeg: short read (${buf.length})`
    return { buf, w: SCALE, h: SCALE }
  })()
  if (planes.size >= 8) planes.delete(planes.keys().next().value!)
  planes.set(key, p)
  return p
}

/** Crop a square zoom window out of the plane and return a Window. */
function crop(pl: Plane, sp: Spatial): Window {
  const side = Math.max(1, Math.round(pl.w * clamp(sp.zoom, 0.1, 1.0)))
  const x0 = Math.round((pl.w - side) * clamp(sp.ox, 0, 1))
  const y0 = Math.round((pl.h - side) * clamp(sp.oy, 0, 1))
  const gray = new Uint8Array(side * side)
  for (let y = 0; y < side; y++)
    gray.set(pl.buf.subarray((y0 + y) * pl.w + x0, (y0 + y) * pl.w + x0 + side), y * side)
  let enc: Uint8Array | undefined
  return { gray, w: side, h: side, png: () => (enc ??= png(gray, side, side)) }
}

/** Minimal 8-bit grayscale PNG encoder. ~1 ms at 384×384. */
function png(gray: Uint8Array, w: number, h: number): Uint8Array {
  const be32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
  // CRC-32 (PNG polynomial) — table computed once.
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
  // Filter byte 0 per scanline + row bytes.
  const raw = new Uint8Array(h * (w + 1))
  for (let y = 0; y < h; y++) raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1)
  const idat = new Uint8Array(deflateSync(raw))
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

// ── LRU over rendered frames ─────────────────────────────────────────

const cache = new Map<string, Frame[]>()
const CAP = 64

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

export function resetCache() { cache.clear(); planes.clear() }

const keyOf = (r: string, src: string, sp: Spatial, k: KnobValues) =>
  `${r}|${src}|${sp.zoom.toFixed(3)}:${sp.ox.toFixed(3)}:${sp.oy.toFixed(3)}|${JSON.stringify(k)}`

/** Decode → crop → rasterize, with LRU over the final frames. */
export async function cached(r: Rasterizer, src: string, sp: Spatial, k: KnobValues,
                             signal?: AbortSignal): Promise<Rendered> {
  const key = keyOf(r.name, src, sp, k)
  const got = hit(key)
  if (got) return { frames: got }
  const pl = await decode(src)
  if (typeof pl === "string") return { err: pl }
  if (signal?.aborted) return { err: "aborted" }
  const out = await r.render(crop(pl, sp), k, signal)
  if ("err" in out) return out
  if (signal?.aborted) return { err: "aborted" }
  return { frames: put(key, out.frames) }
}

/** Nearest-neighbor downsample of a 48×24 frame to w×h (center-pick).
 *  Codepoint-indexed so non-BMP glyphs (sextant/wedge) survive. */
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

/** Apply flip/contrast on the gray buffer in-place before encoding. */
function tone(win: Window, flip: string, con: number): Window {
  const { gray: g, w, h } = win
  if (flip === "h" || flip === "hv")
    for (let y = 0; y < h; y++) {
      const o = y * w
      for (let x = 0; x < w >> 1; x++) { const t = g[o + x]!; g[o + x] = g[o + w - 1 - x]!; g[o + w - 1 - x] = t }
    }
  if (flip === "v" || flip === "hv")
    for (let y = 0; y < h >> 1; y++) {
      const a = g.subarray(y * w, (y + 1) * w)
      const b = g.subarray((h - 1 - y) * w, (h - y) * w)
      const t = new Uint8Array(a); a.set(b); b.set(t)
    }
  if (Math.abs(con - 1) > 1e-3)
    for (let i = 0; i < g.length; i++) g[i] = clamp(Math.round((g[i]! - 128) * con + 128), 0, 255)
  return win
}

export const chafa: Rasterizer = {
  name: "chafa",
  knobs: {
    symbols:   { kind: "cycle",  options: ["braille", "block", "ascii", "sextant", "quad", "half", "wedge"], default: "braille" },
    fill:      { kind: "cycle",  options: ["none", "stipple", "ascii", "braille"], default: "none" },
    dither:    { kind: "cycle",  options: ["none", "ordered", "diffusion", "noise"], default: "none" },
    invert:    { kind: "toggle", default: true },
    flip:      { kind: "cycle",  options: ["none", "h", "v", "hv"], default: "none" },
    contrast:  { kind: "slider", min: 0.5, max: 3.0, step: 0.1, default: 1.0 },
  },
  available: () => caps.chafa ? true : "chafa not installed",
  async render(win, k, signal) {
    const bin = caps.chafa
    if (!bin) return { err: "chafa not installed" }
    const fill = String(k.fill ?? "none")
    tone(win, String(k.flip ?? "none"), clamp(Number(k.contrast ?? 1), 0.5, 3.0))
    const args = [
      `--size=${W}x${H}`, "--format=symbols", "--stretch", "--colors=none",
      `--symbols=${String(k.symbols ?? "braille")}`,
      ...(fill === "none" ? [] : [`--fill=${fill}`]),
      `--dither=${String(k.dither ?? "none")}`,
      // chafa's default --preprocess auto-levels the input, which would
      // undo the in-process contrast multiply.
      "--preprocess", "off",
      // --invert tells chafa the terminal bg is light, which flips its
      // luminance→density mapping — correct semantics for mono output.
      ...(k.invert ? ["--invert"] : []),
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
    return { frames: [box(out)] }
  },
}

// ── native ───────────────────────────────────────────────────────────

const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]] as const
const RAMP = " .:-=+*#%@"

function sample(win: Window, fw: number, fh: number) {
  const sx = win.w / fw, sy = win.h / fh
  return (gx: number, gy: number) =>
    win.gray[Math.min(win.h - 1, Math.floor(gy * sy)) * win.w + Math.min(win.w - 1, Math.floor(gx * sx))]!
}

function braille(win: Window, inv: boolean, con: number): Frame {
  const at = sample(win, W * 2, H * 4)
  const thr = 128 / con
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let row = ""
    for (let x = 0; x < W; x++) {
      let bits = 0
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        const v = at(x * 2 + dx, y * 4 + dy)
        if ((v > thr) !== inv) bits |= DOT[dy]![dx]!
      }
      row += String.fromCodePoint(0x2800 + bits)
    }
    rows.push(row)
  }
  return rows
}

function block(win: Window, inv: boolean, con: number): Frame {
  const at = sample(win, W, H)
  const n = RAMP.length - 1
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let row = ""
    for (let x = 0; x < W; x++) {
      const v = clamp((at(x, y) - 128) * con + 128, 0, 255)
      const i = Math.round((inv ? 255 - v : v) / 255 * n)
      row += RAMP[i]
    }
    rows.push(row)
  }
  return rows
}

export const native: Rasterizer = {
  name: "native",
  knobs: {
    symbols:  { kind: "cycle",  options: ["braille", "block"], default: "braille" },
    invert:   { kind: "toggle", default: true },
    contrast: { kind: "slider", min: 0.5, max: 3.0, step: 0.1, default: 1.0 },
  },
  // Decode is shared; native has no extra deps.
  available: () => caps.ffmpeg ? true : "ffmpeg not installed",
  async render(win, k) {
    const con = clamp(Number(k.contrast ?? 1), 0.5, 3.0)
    const inv = !!k.invert
    return { frames: [k.symbols === "block" ? block(win, inv, con) : braille(win, inv, con)] }
  },
}

export const BUILTIN: readonly Rasterizer[] = [chafa, native]

/** Test helper — wrap a raw gray buffer as a Window. */
export const windowOf = (gray: Uint8Array, w: number, h: number): Window => {
  let enc: Uint8Array | undefined
  return { gray, w, h, png: () => (enc ??= png(gray, w, h)) }
}

export * as render from "./eikon-render"
