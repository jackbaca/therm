import type { Knobs, Symbols } from "./render"
import { K0, caps } from "./render"
import type { AvatarState } from "../../../components/avatar/states"

export const STATES: AvatarState[] = ["idle", "listening", "thinking", "speaking", "working", "error"]
const SYMBOLS: Symbols[] = ["braille", "block", "ascii", "sextant"]

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const wrap = <T,>(arr: readonly T[], cur: T, d: 1 | -1): T =>
  arr[(arr.indexOf(cur) + d + arr.length) % arr.length]!

/** A knob-panel row. `source/name/glyph` open prompts; `pan` is a sub-mode. */
export type Row =
  | "source" | "state" | "symbols" | "invert" | "flip"
  | "contrast" | "zoom" | "pan" | "name" | "glyph"

export type RowKind = "prompt" | "cycle" | "toggle" | "slider" | "submode"

type Def = { row: Row; kind: RowKind; ff?: boolean }
export const ROWS: readonly Def[] = [
  { row: "source",   kind: "prompt" },
  { row: "state",    kind: "cycle" },
  { row: "symbols",  kind: "cycle" },
  { row: "invert",   kind: "toggle" },
  { row: "flip",     kind: "cycle",  ff: true },
  { row: "contrast", kind: "slider", ff: true },
  { row: "zoom",     kind: "slider", ff: true },
  { row: "pan",      kind: "submode", ff: true },
  { row: "name",     kind: "prompt" },
  { row: "glyph",    kind: "prompt" },
]

export const rowDef = (r: Row) => ROWS.find(d => d.row === r)!
/** Rows that can actually be reached given current caps. */
export const liveRows = () => ROWS.filter(d => !d.ff || caps.ffmpeg).map(d => d.row)

const FLIPS: Array<[boolean, boolean]> = [[false, false], [true, false], [false, true], [true, true]]

/** Adjust one knob by ±1 step. */
export function step(k: Knobs, row: Row, d: 1 | -1): Knobs {
  if (row === "symbols") return { ...k, symbols: wrap(SYMBOLS, k.symbols, d) }
  if (row === "invert")  return { ...k, invert: !k.invert }
  if (row === "flip") {
    const i = FLIPS.findIndex(f => f[0] === k.flipH && f[1] === k.flipV)
    const [h, v] = FLIPS[(i + d + 4) % 4]!
    return { ...k, flipH: h, flipV: v }
  }
  if (row === "contrast") return { ...k, contrast: clamp(+(k.contrast + d * 0.1).toFixed(2), 0.5, 3.0) }
  if (row === "zoom")     return { ...k, zoom: clamp(+(k.zoom + d * 0.05).toFixed(3), 0.3, 1.0) }
  return k
}

/** Pan step — normalized; shift halves the stride. */
export function pan(k: Knobs, dx: number, dy: number, fine = false): Knobs {
  const s = fine ? 0.02 : 0.05
  return { ...k, ox: clamp(+(k.ox + dx * s).toFixed(3), 0, 1), oy: clamp(+(k.oy + dy * s).toFixed(3), 0, 1) }
}

export type Session = {
  src: string
  dims: { w: number; h: number } | null
  base: Knobs
  per: Partial<Record<AvatarState, Knobs>>
  state: AvatarState
  name: string
  glyph: string
}

export function fresh(src: string, dims: Session["dims"]): Session {
  const name = src.replace(/^.*\//, "").replace(/\.[^.]+$/, "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "wip"
  return { src, dims, base: { ...K0 }, per: {}, state: "idle", name, glyph: "◆" }
}

export const eff = (s: Session, state: AvatarState): Knobs => s.per[state] ?? s.base

/** Apply an edit to whichever knob-set the current state uses. */
export function edit(s: Session, fn: (k: Knobs) => Knobs): Session {
  const has = s.per[s.state]
  return has
    ? { ...s, per: { ...s.per, [s.state]: fn(has) } }
    : { ...s, base: fn(s.base) }
}

export const fork = (s: Session): Session =>
  s.per[s.state] ? s : { ...s, per: { ...s.per, [s.state]: { ...s.base } } }

export const cycle = (s: Session, d: 1 | -1): Session =>
  ({ ...s, state: wrap(STATES, s.state, d) })

export const resetKnobs = (s: Session): Session =>
  ({ ...s, base: { ...K0 }, per: {} })
