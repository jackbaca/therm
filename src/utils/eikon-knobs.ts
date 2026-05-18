// Pure session/knob manipulation for the Eikon Studio tab. No I/O.
//
// `Session` is the in-memory working draft: which rasterizer, spatial
// crop, per-state tonal overrides, and per-state source filenames.
// Knob rows are derived from the active rasterizer's declared schema
// (see utils/eikon-render.ts); `step()` is generic over `KnobDef`.

import type { AvatarState } from "../components/avatar/states"
import type { KnobDef, KnobValues, Rasterizer, Spatial, Tone } from "./eikon-render"
import { S0, T0, FPS0, defaults } from "./eikon-render"

export const STATES: readonly AvatarState[] = ["idle", "listening", "thinking", "speaking", "working", "error"]

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const round = (x: number, p = 3) => +x.toFixed(p)
const wrap = <T,>(arr: readonly T[], cur: T, d: 1 | -1): T =>
  arr[(Math.max(0, arr.indexOf(cur)) + d + arr.length) % arr.length]!

/** What `studio.json` holds — the persisted subset of `Session`. */
export type Studio = {
  rasterizer: string
  spatial: Spatial
  tone: Tone
  fps: number
  base: KnobValues
  per: Partial<Record<AvatarState, KnobValues>>
  glyph: string
  sources: Partial<Record<AvatarState | "base", string>>
  /** Per-state last generation prompt — pre-fills the generate dialog
   *  on a state's next open so users can iterate without retyping. */
  prompts?: Partial<Record<AvatarState, string>>
}

export type Session = Studio & {
  name: string
  state: AvatarState
  dims: { w: number; h: number } | null
  dirty: boolean
}

export function fresh(name: string, r: Rasterizer, seed?: Partial<Studio>): Session {
  return {
    name, state: "idle", dims: null, dirty: false,
    rasterizer: seed?.rasterizer ?? r.name,
    spatial: seed?.spatial ?? { ...S0 },
    tone: { ...T0, ...seed?.tone },
    fps: seed?.fps ?? FPS0,
    base: seed?.base ?? defaults(r),
    per: seed?.per ?? {},
    glyph: seed?.glyph ?? "◆",
    sources: seed?.sources ?? {},
    prompts: seed?.prompts ?? {},
  }
}

/** Effective tonal values for a state (override → base). */
export const eff = (s: Session, state: AvatarState): KnobValues =>
  s.per[state] ?? s.base

/** Apply a knob edit to whichever bag the current state uses. */
export function edit(s: Session, fn: (k: KnobValues) => KnobValues): Session {
  const own = s.per[s.state]
  return own
    ? { ...s, per: { ...s.per, [s.state]: fn(own) }, dirty: true }
    : { ...s, base: fn(s.base), dirty: true }
}

/** Fork the current state from base (no-op if already forked). */
export const fork = (s: Session): Session =>
  s.per[s.state] ? s : { ...s, per: { ...s.per, [s.state]: { ...s.base } }, dirty: true }

/** Drop the current state's override (back to base). */
export const unfork = (s: Session): Session => {
  if (!s.per[s.state]) return s
  const { [s.state]: _, ...rest } = s.per
  return { ...s, per: rest, dirty: true }
}

export const setState = (s: Session, state: AvatarState): Session => ({ ...s, state })
export const cycle = (s: Session, d: 1 | -1): Session => setState(s, wrap(STATES, s.state, d))

/** Step one tonal knob by ±1 according to its declared schema. */
export function step(k: KnobValues, id: string, def: KnobDef, d: 1 | -1): KnobValues {
  if (def.kind === "cycle")
    return { ...k, [id]: wrap(def.options, String(k[id] ?? def.default), d) }
  if (def.kind === "toggle")
    return { ...k, [id]: !(k[id] ?? def.default) }
  const cur = Number(k[id] ?? def.default)
  return { ...k, [id]: round(clamp(cur + d * def.step, def.min, def.max)) }
}

/** Set a slider knob directly (mouse drag on <slider>). */
export function setSlider(k: KnobValues, id: string, def: KnobDef, v: number): KnobValues {
  if (def.kind !== "slider") return k
  return { ...k, [id]: round(clamp(v, def.min, def.max)) }
}

export function pan(sp: Spatial, dx: number, dy: number, fine = false): Spatial {
  const s = fine ? 0.01 : 0.03
  return {
    zoom: sp.zoom,
    ox: round(clamp(sp.ox + dx * s, 0, 1)),
    oy: round(clamp(sp.oy + dy * s, 0, 1)),
  }
}

export function zoom(sp: Spatial, d: 1 | -1, fine = false): Spatial {
  const s = fine ? 0.02 : 0.05
  return { ...sp, zoom: round(clamp(sp.zoom + d * s, 0.1, 1.0)) }
}

/** Switch rasterizer. Spatial survives; tonal resets to the new
 *  backend's defaults (unknown keys are meaningless to it). */
export function swap(s: Session, r: Rasterizer): Session {
  return { ...s, rasterizer: r.name, base: defaults(r), per: {}, dirty: true }
}

export const reset = (s: Session, r: Rasterizer): Session =>
  ({ ...s, spatial: { ...S0 }, tone: { ...T0 }, base: defaults(r), per: {}, dirty: true })

export const slug = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "wip"

/** Persisted slice of a session. */
export const toStudio = (s: Session): Studio => ({
  rasterizer: s.rasterizer, spatial: s.spatial, tone: s.tone, fps: s.fps,
  base: s.base, per: s.per, glyph: s.glyph, sources: s.sources, prompts: s.prompts,
})

export * as knobs from "./eikon-knobs"
