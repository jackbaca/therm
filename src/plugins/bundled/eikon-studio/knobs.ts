import type { Knobs, Symbols } from "./render"
import { K0 } from "./render"
import type { AvatarState } from "../../../components/avatar/states"

export const STATES: AvatarState[] = ["idle", "listening", "thinking", "speaking", "working", "error"]
const SYMBOLS: Symbols[] = ["braille", "block", "ascii", "sextant"]

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const wrap = <T,>(arr: readonly T[], cur: T, d: 1 | -1): T =>
  arr[(arr.indexOf(cur) + d + arr.length) % arr.length]!

export type Row = "symbols" | "invert" | "contrast" | "zoom" | "pan" | "state"
export const ROWS: Row[] = ["state", "symbols", "invert", "contrast", "zoom", "pan"]

/** Adjust one knob by ±1 step. `pan` handled separately (2-axis). */
export function step(k: Knobs, row: Row, d: 1 | -1): Knobs {
  if (row === "symbols") return { ...k, symbols: wrap(SYMBOLS, k.symbols, d) }
  if (row === "invert")  return { ...k, invert: !k.invert }
  if (row === "contrast") return { ...k, contrast: clamp(+(k.contrast + d * 0.1).toFixed(2), 0.5, 3.0) }
  if (row === "zoom") {
    const z = clamp(+(k.zoom + d * 0.05).toFixed(3), 0.3, 1.0)
    // Re-clamp pan so the window stays inside source bounds at new zoom.
    return { ...k, zoom: z, ox: clamp(k.ox, 0, 1), oy: clamp(k.oy, 0, 1) }
  }
  return k
}

/** Pan step — normalized by zoom so one keypress ≈ 5% of the slack. */
export function pan(k: Knobs, dx: number, dy: number, fine = false): Knobs {
  const s = fine ? 0.02 : 0.05
  return { ...k, ox: clamp(+(k.ox + dx * s).toFixed(3), 0, 1), oy: clamp(+(k.oy + dy * s).toFixed(3), 0, 1) }
}

export type Session = {
  src: string
  dims: { w: number; h: number } | null
  /** Default knobs for states without an override. */
  base: Knobs
  /** Per-state overrides (absent → use base). */
  per: Partial<Record<AvatarState, Knobs>>
  /** Which state the panel is editing. */
  state: AvatarState
}

export function fresh(src: string, dims: Session["dims"]): Session {
  return { src, dims, base: { ...K0 }, per: {}, state: "idle" }
}

/** Effective knobs for a given state. */
export const eff = (s: Session, state: AvatarState): Knobs => s.per[state] ?? s.base

/** Apply an edit: if the current state has an override, edit that; else
 *  edit base (so single-image users never fork state-specific knobs). */
export function edit(s: Session, fn: (k: Knobs) => Knobs): Session {
  const has = s.per[s.state]
  return has
    ? { ...s, per: { ...s.per, [s.state]: fn(has) } }
    : { ...s, base: fn(s.base) }
}

/** Fork current state's knobs from base so further edits don't touch base. */
export const fork = (s: Session): Session =>
  s.per[s.state] ? s : { ...s, per: { ...s.per, [s.state]: { ...s.base } } }

export const cycle = (s: Session, d: 1 | -1): Session =>
  ({ ...s, state: wrap(STATES, s.state, d) })

export const reset = (s: Session): Session =>
  ({ ...s, base: { ...K0 }, per: {} })
