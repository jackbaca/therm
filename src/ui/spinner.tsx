import { useRef, useState, useEffect, memo, type ReactNode } from "react"
import type { RGBA, TextNodeRenderable } from "@opentui/core"
import { useTheme } from "../theme"
import { prefs } from "../context/preferences"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const MS = 80

type Sub = (n: number) => void
const subs = new Set<Sub>()
let tick = 0
let timer: ReturnType<typeof setInterval> | null = null

function sub(fn: Sub) {
  subs.add(fn)
  fn(tick)
  if (!timer) timer = setInterval(() => {
    tick = (tick + 1) % FRAMES.length
    for (const s of Array.from(subs)) s(tick)
  }, MS)
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && timer) { clearInterval(timer); timer = null }
  }
}

// Drive the glyph by mutating the span's renderable child directly.
// `.children = [str]` marks the TextNode dirty and bubbles one native
// requestRender() — no React reconcile, so N visible spinners cost
// zero framework work per tick instead of N memo comparisons.
function useGlyph(active: boolean) {
  const ref = useRef<TextNodeRenderable | null>(null)
  useEffect(() => {
    if (!active) return
    return sub(n => {
      const node = ref.current
      if (node) node.children = [FRAMES[n]]
    })
  }, [active])
  return ref
}

export const Spinner = memo((props: { color?: RGBA; label?: ReactNode }) => {
  const theme = useTheme().theme
  const color = props.color ?? theme.textMuted
  const on = prefs.get("animations") !== false
  const ref = useGlyph(on)
  return (
    <text>
      <span ref={ref} fg={color}>{on ? FRAMES[tick] : "⋯"}</span>
      {props.label ? <span fg={color}> {props.label}</span> : null}
    </text>
  )
})

/**
 * Inline glyph for embedding inside an existing <text>. The parent
 * must never re-render this span's children from props — the JSX
 * child is a module constant so React's diff no-ops while the tick
 * mutates the renderable underneath.
 */
export const SpinGlyph = memo((props: { active?: boolean; fg?: RGBA }) => {
  const on = (props.active ?? true) && prefs.get("animations") !== false
  const ref = useGlyph(on)
  return <span ref={ref} fg={props.fg}>{on ? FRAMES[tick] : "⋯"}</span>
})

// Legacy hook for call sites that interpolate the glyph into a
// larger string (tool frame header, subagent row). Those can't use
// ref-mutation because the glyph isn't its own span, so fall back to
// a per-tick setState. Both callers gate on `running`, so idle rows
// don't subscribe to the clock.
export function useSpinnerGlyph(active = true): string {
  const on = prefs.get("animations") !== false && active
  const [n, set] = useState(tick)
  useEffect(() => (on ? sub(set) : undefined), [on])
  return on ? FRAMES[n] : "⋯"
}
