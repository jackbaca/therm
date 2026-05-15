// Rasterizer contract + built-in implementations for the Eikon tab.
//
// The Studio owns exactly three spatial knobs (zoom, ox, oy) — driven by
// mouse drag/wheel on the preview pane — and renders whatever tonal
// knobs the active rasterizer declares. A rasterizer with `spatial:
// false` ignores zoom/ox/oy; the tab hides the minimap and inert the
// preview mouse. Output is always 48×24 mono text; thumbnails are
// derived via nearest-neighbor downsample of that one render.
//
// Built-ins:
//   chafa  — ffmpeg crop/eq → chafa symbols. Known-good POC pipeline.
//   native — ffmpeg decode to gray Uint8Array → in-process braille/block.
//            Proves the seam, covers chafa-absent.
//
// Third-party rasterizers register via `service/eikon.register()` (or
// the plugin api). `render()` is async so subprocess CLIs and a future
// async queue slot in; built-ins currently resolve immediately.

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

export type Rasterizer = {
  readonly name: string
  /** Tonal knobs; order = panel order. */
  readonly knobs: Readonly<Record<string, KnobDef>>
  /** Honors zoom/ox/oy (preview mouse + minimap)? */
  readonly spatial: boolean
  /** Accepts video sources? */
  readonly video: boolean
  /** true if usable; otherwise a short reason shown dimmed in the picker. */
  available(): true | string
  render(src: string, sp: Spatial, knobs: KnobValues): Promise<Rendered>
  probe?(src: string): { w: number; h: number } | null
}

/** Seed a KnobValues bag from a rasterizer's defaults. */
export const defaults = (r: Rasterizer): KnobValues =>
  Object.fromEntries(Object.entries(r.knobs).map(([k, d]) => [k, d.default]))

export const caps = {
  chafa: chafaBin(),
  ffmpeg: spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0,
  ffprobe: spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0,
}

/** Source pixel dimensions via ffprobe; null when unavailable. */
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
 *  under ANSI is the rasterizer's job). */
function box(out: string): Frame {
  const rows = out.replace(/\n$/, "").split("\n")
  while (rows.length < H) rows.push("")
  return rows.slice(0, H).map(l => (l.includes("\x1b[") ? l : l.padEnd(W).slice(0, W)))
}

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

/** Wrap a rasterizer's render with the shared LRU. */
export async function cached(r: Rasterizer, src: string, sp: Spatial, k: KnobValues): Promise<Rendered> {
  const key = keyOf(r.name, src, sp, k)
  const got = hit(key)
  if (got) return { frames: got }
  const out = await r.render(src, sp, k)
  if ("err" in out) return out
  return { frames: put(key, out.frames) }
}

/** Nearest-neighbor downsample of a 48×24 frame to w×h (center-pick). */
export function thumb(frame: Frame, w = 16, h = 8): Frame {
  const fx = W / w, fy = H / h
  const pick = (row: string, x: number) => {
    const i = Math.min(row.length - 1, Math.floor(x * fx + fx / 2))
    return row[i] ?? " "
  }
  return Array.from({ length: h }, (_, y) => {
    const row = frame[Math.min(H - 1, Math.floor(y * fy + fy / 2))] ?? ""
    return Array.from({ length: w }, (_, x) => pick(row, x)).join("")
  })
}

// ── chafa ────────────────────────────────────────────────────────────

/** ffmpeg -vf string. Crop window is a square of side min(iw,ih)*zoom;
 *  ox/oy place it in the remaining slack so 0.5,0.5 is centered
 *  regardless of source aspect. */
function vf(sp: Spatial, k: KnobValues): string {
  const z = clamp(sp.zoom, 0.1, 1.0).toFixed(4)
  const ox = clamp(sp.ox, 0, 1).toFixed(4)
  const oy = clamp(sp.oy, 0, 1).toFixed(4)
  const c = clamp(Number(k.contrast ?? 1), 0.5, 3.0).toFixed(3)
  const flip = String(k.flip ?? "none")
  const side = `min(iw\\,ih)*${z}`
  return [
    `crop=${side}:${side}:(iw-${side})*${ox}:(ih-${side})*${oy}`,
    ...(flip === "h" || flip === "hv" ? ["hflip"] : []),
    ...(flip === "v" || flip === "hv" ? ["vflip"] : []),
    `eq=contrast=${c}`,
  ].join(",")
}

export const chafa: Rasterizer = {
  name: "chafa",
  spatial: true,
  video: true,
  knobs: {
    symbols:   { kind: "cycle",  options: ["braille", "block", "ascii", "sextant", "quad", "half", "wedge"], default: "braille" },
    fill:      { kind: "cycle",  options: ["none", "stipple", "ascii", "braille"], default: "none" },
    dither:    { kind: "cycle",  options: ["none", "ordered", "diffusion", "noise"], default: "none" },
    invert:    { kind: "toggle", default: true },
    flip:      { kind: "cycle",  options: ["none", "h", "v", "hv"], default: "none" },
    contrast:  { kind: "slider", min: 0.5, max: 3.0, step: 0.1, default: 1.0 },
    threshold: { kind: "slider", label: "alpha cut", min: 0.0, max: 1.0, step: 0.05, default: 0.5 },
  },
  available: () => caps.chafa ? true : "chafa not installed",
  probe,
  async render(src, sp, k) {
    const bin = caps.chafa
    if (!bin) return { err: "chafa not installed" }
    const full = resolveImage(src)
    if (!full) return { err: `not found: ${src}` }
    const fill = String(k.fill ?? "none")
    const args = [
      `--size=${W}x${H}`, "--format=symbols", "--stretch", "--colors=none",
      `--symbols=${String(k.symbols ?? "braille")}`,
      ...(fill === "none" ? [] : [`--fill=${fill}`]),
      `--dither=${String(k.dither ?? "none")}`,
      `--threshold=${clamp(Number(k.threshold ?? 0.5), 0, 1).toFixed(2)}`,
      // Always off: chafa's auto-levels would fight eq=contrast and make
      // the ffmpeg and direct-read paths diverge at contrast=1.
      "--preprocess", "off",
      // --invert tells chafa the terminal bg is light, which flips its
      // luminance→density mapping — correct semantics for mono output.
      ...(k.invert ? ["--invert"] : []),
    ]
    // Bun.spawn keeps the main thread free so slider drag stays
    // responsive; the calling effect's `dead` flag discards stale
    // results when a newer spatial value arrives mid-render.
    if (caps.ffmpeg) {
      const ff = Bun.spawn(["ffmpeg",
        "-hide_banner", "-loglevel", "error", "-i", full,
        "-vf", vf(sp, k), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-",
      ], { stdout: "pipe", stderr: "pipe" })
      const ch = Bun.spawn([bin, ...args, "-"],
        { stdin: ff.stdout, stdout: "pipe", stderr: "pipe" })
      const [out, cerr, ferr] = await Promise.all([
        new Response(ch.stdout).text(),
        new Response(ch.stderr).text(),
        new Response(ff.stderr).text(),
      ])
      await Promise.all([ff.exited, ch.exited])
      if (ff.exitCode !== 0) return { err: `ffmpeg: ${ferr.trim() || "failed"}` }
      if (ch.exitCode !== 0) return { err: `chafa: ${cerr.trim() || "failed"}` }
      return { frames: [box(out)] }
    }
    // Direct read: no ffmpeg (absent, or every ffmpeg-owned knob at
    // identity). chafa handles the decode via its built-in loaders.
    const ch = Bun.spawn([bin, ...args, full], { stdout: "pipe", stderr: "pipe" })
    const [out, cerr] = await Promise.all([
      new Response(ch.stdout).text(), new Response(ch.stderr).text(),
    ])
    await ch.exited
    if (ch.exitCode !== 0) return { err: `chafa: ${cerr.trim() || "failed"}` }
    return { frames: [box(out)] }
  },
}

// ── native ───────────────────────────────────────────────────────────
//
// ffmpeg decodes the source to a raw gray byte plane at a fixed
// resolution; crop/zoom is a slice into that plane; luminance→char
// runs in-process. No chafa dependency. Braille packs 2×4 sub-cells
// per output cell (effective 96×96 sample grid); block picks from a
// 9-step ramp. ~1–2ms per frame after decode.

const SCALE = 192
// Braille dot bit positions for a 2×4 cell, column-major per Unicode
// U+2800 layout: dots 1-3 left col, 4-6 right col, 7-8 bottom row.
const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]] as const
const RAMP = " .:-=+*#%@"

// Decoded gray planes keyed by (resolved path, mtime). Pan/zoom only
// touches the plane slice so after the first decode every spatial
// change is spawn-free. Keep last 4 (one per visible state source).
const planes = new Map<string, Uint8Array>()

function decode(src: string): Uint8Array | string {
  const full = resolveImage(src)
  if (!full) return `not found: ${src}`
  const mt = statSync(full, { throwIfNoEntry: false })?.mtimeMs ?? 0
  const key = `${full}:${mt}`
  const got = planes.get(key)
  if (got) { planes.delete(key); planes.set(key, got); return got }
  const ff = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", full, "-frames:v", "1",
    "-vf", `scale=${SCALE}:${SCALE}:flags=lanczos`,
    "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ], { maxBuffer: 4 * 1024 * 1024 })
  if (ff.status !== 0) return `ffmpeg: ${ff.stderr?.toString().trim() || "failed"}`
  const buf = new Uint8Array(ff.stdout)
  if (buf.length !== SCALE * SCALE) return `ffmpeg: short read (${buf.length})`
  if (planes.size >= 4) planes.delete(planes.keys().next().value!)
  planes.set(key, buf)
  return buf
}

/** Sample the crop window at (gx,gy) in an fw×fh sub-cell grid. */
function sampler(buf: Uint8Array, sp: Spatial, fw: number, fh: number) {
  const side = Math.max(1, Math.round(SCALE * clamp(sp.zoom, 0.1, 1.0)))
  const x0 = Math.round((SCALE - side) * clamp(sp.ox, 0, 1))
  const y0 = Math.round((SCALE - side) * clamp(sp.oy, 0, 1))
  return (gx: number, gy: number) => {
    const px = x0 + Math.min(side - 1, Math.floor(gx / fw * side))
    const py = y0 + Math.min(side - 1, Math.floor(gy / fh * side))
    return buf[py * SCALE + px]!
  }
}

function braille(buf: Uint8Array, sp: Spatial, inv: boolean, con: number): Frame {
  const at = sampler(buf, sp, W * 2, H * 4)
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

function block(buf: Uint8Array, sp: Spatial, inv: boolean, con: number): Frame {
  const at = sampler(buf, sp, W, H)
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
  spatial: true,
  video: false,
  knobs: {
    symbols:  { kind: "cycle",  options: ["braille", "block"], default: "braille" },
    invert:   { kind: "toggle", default: true },
    contrast: { kind: "slider", min: 0.5, max: 3.0, step: 0.1, default: 1.0 },
  },
  available: () => caps.ffmpeg ? true : "ffmpeg not installed",
  probe,
  render(src, sp, k) {
    const buf = decode(src)
    if (typeof buf === "string") return Promise.resolve({ err: buf })
    const con = clamp(Number(k.contrast ?? 1), 0.5, 3.0)
    const inv = !!k.invert
    const frame = k.symbols === "block" ? block(buf, sp, inv, con) : braille(buf, sp, inv, con)
    return Promise.resolve({ frames: [frame] })
  },
}

export const BUILTIN: readonly Rasterizer[] = [chafa, native]

export * as render from "./eikon-render"
