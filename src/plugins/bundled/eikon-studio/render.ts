// Image → 48×24 mono text pipeline for eikon-studio.
//
// chafa alone can't crop/pan/contrast, so ffmpeg preprocesses
// (crop=iw*z:ih*z:iw*ox:ih*oy , eq=contrast=c) and pipes PNG to chafa
// over stdout/stdin — no temp files, no shell string. If ffmpeg is
// absent the filter stage is skipped and chafa reads the source
// directly; pan/contrast knobs then become no-ops (caller greys them).
//
// Platform: Bun.spawn argv arrays on linux/macOS/WSL. chafa path comes
// from utils/chafa.chafaBin() (handles brew/linuxbrew/usr).

import { spawnSync } from "node:child_process"
import { chafaBin, resolveImage } from "../../../utils/chafa"

export const W = 48
export const H = 24

export type Symbols = "braille" | "block" | "ascii" | "sextant"

export type Knobs = {
  symbols: Symbols
  invert: boolean
  flipH: boolean
  flipV: boolean
  /** 0.5–3.0; 1.0 = source. Requires ffmpeg. */
  contrast: number
  /** Crop side as fraction of min(iw,ih). 1.0 = largest centered square. */
  zoom: number
  /** Pan offset, normalized 0–1 of the slack on each axis. */
  ox: number
  oy: number
}

export const K0: Knobs = { symbols: "braille", invert: true, flipH: false, flipV: false, contrast: 1.0, zoom: 1.0, ox: 0.5, oy: 0.5 }

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

/** ffmpeg -vf string for the given knobs. The crop window is a square
 *  of side min(iw,ih)*zoom; ox/oy place it in the remaining slack so
 *  0.5,0.5 is centered regardless of source aspect. */
function vf(k: Knobs): string {
  const z = clamp(k.zoom, 0.3, 1.0).toFixed(4)
  const ox = clamp(k.ox, 0, 1).toFixed(4)
  const oy = clamp(k.oy, 0, 1).toFixed(4)
  const c = clamp(k.contrast, 0.5, 3.0).toFixed(3)
  const side = `min(iw\\,ih)*${z}`
  return [
    `crop=${side}:${side}:(iw-${side})*${ox}:(ih-${side})*${oy}`,
    ...(k.flipH ? ["hflip"] : []),
    ...(k.flipV ? ["vflip"] : []),
    `eq=contrast=${c}`,
  ].join(",")
}

/** Normalize chafa output to exactly H rows × W cols. */
function box(out: string): string[] {
  const rows = out.replace(/\n$/, "").split("\n")
  while (rows.length < H) rows.push("")
  return rows.slice(0, H).map(l => (l.includes("\x1b[") ? l : l.padEnd(W).slice(0, W)))
}

const cache = new Map<string, string[]>()
const CAP = 16
const keyOf = (src: string, k: Knobs) =>
  `${src}|${k.symbols}|${+k.invert}${+k.flipH}${+k.flipV}|${k.contrast.toFixed(2)}|${k.zoom.toFixed(3)}|${k.ox.toFixed(3)}|${k.oy.toFixed(3)}|${caps.ffmpeg ? 1 : 0}`

function put(key: string, v: string[]) {
  if (cache.size >= CAP) cache.delete(cache.keys().next().value!)
  cache.set(key, v)
  return v
}

export type Rendered = { lines: string[]; cached: boolean } | { err: string }

/** Rasterize `src` at `k`. Synchronous — per call ~30ms on a warm ffmpeg. */
export function render(src: string, k: Knobs): Rendered {
  if (!caps.chafa) return { err: "chafa not installed" }
  const full = resolveImage(src)
  if (!full) return { err: `not found: ${src}` }

  const key = keyOf(full, k)
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return { lines: hit, cached: true } }

  const chafaArgs = [
    `--size=${W}x${H}`, "--format=symbols", "--stretch",
    `--symbols=${k.symbols}`, "--colors=none", "--dither=none",
    // chafa's default --preprocess auto-levels the input, which would
    // undo eq=contrast upstream. Only skip it when we own contrast.
    ...(caps.ffmpeg ? ["--preprocess", "off"] : []),
    ...(k.invert ? ["--invert"] : []),
  ]

  // ffmpeg → png on stdout → chafa reading stdin. Two sync spawns; the
  // intermediate PNG sits in a Buffer (≤ a few hundred KB at these sizes).
  if (caps.ffmpeg) {
    const ff = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", full,
      "-vf", vf(k), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-",
    ], { maxBuffer: 8 * 1024 * 1024 })
    if (ff.status !== 0) return { err: `ffmpeg: ${ff.stderr?.toString().trim() || "failed"}` }
    const ch = spawnSync(caps.chafa, [...chafaArgs, "-"], { input: ff.stdout, encoding: "utf8" })
    if (ch.status !== 0) return { err: `chafa: ${ch.stderr?.trim() || "failed"}` }
    return { lines: put(key, box(ch.stdout)), cached: false }
  }

  // Fallback: chafa reads the file directly — no pan/contrast.
  const ch = spawnSync(caps.chafa, [...chafaArgs, full], { encoding: "utf8" })
  if (ch.status !== 0) return { err: `chafa: ${ch.stderr?.trim() || "failed"}` }
  return { lines: put(key, box(ch.stdout)), cached: false }
}

export function reset() { cache.clear() }
