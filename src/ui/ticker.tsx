// Single-line styled text that horizontally auto-scrolls when active.
//
// Differs from ui/table.tsx Marquee in two ways:
//   1. Content is a ReactNode (styled <span>s), not a plain string —
//      the component can't slice it, so it animates the text node's
//      native scrollX instead of rebuilding a substring each tick.
//   2. Because scrollX is driven via ref (not React state), there's
//      exactly one React render regardless of scroll position.
//
// Motion is ping-pong with a dwell at each end: hold → scroll to
// max → endHold → scroll back to 0 → endHold → …. Defaults are the
// "readable" profile (180ms/cell, 600ms initial hold, 3s at each
// end) — tuned for reading a long label, not glancing. Callers that
// want the fast transcript-preview feel pass speed/hold explicitly.

import { useEffect, useRef, type ReactNode } from "react"
import type { TextRenderable } from "@opentui/core"
import { prefs } from "../context/preferences"

export const Ticker = (p: {
  active: boolean
  /** ms per cell (default 180 — readable). */
  speed?: number
  /** ms to sit still before the first scroll (default 600). */
  hold?: number
  /** ms to dwell at each end before reversing (default 3000). */
  endHold?: number
  fg?: import("@opentui/core").RGBA
  children: ReactNode
}) => {
  const ref = useRef<TextRenderable | null>(null)

  const animate = prefs.get("animations") !== false && p.active
  const speed = p.speed ?? 180
  const hold = p.hold ?? 600
  const endHold = p.endHold ?? 3000

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (!animate) { node.scrollX = 0; return }
    let dir = 1
    let tick: ReturnType<typeof setInterval> | undefined
    let wait: ReturnType<typeof setTimeout> | undefined
    const step = () => {
      const max = node.maxScrollX
      if (max <= 0) return
      node.scrollX = Math.max(0, Math.min(max, node.scrollX + dir))
      const end = dir > 0 ? node.scrollX >= max : node.scrollX <= 0
      if (!end) return
      // Dwell, then reverse. Re-arming via setTimeout (rather than
      // counting skipped ticks) means the dwell is exact even when
      // `speed` and `endHold` don't divide evenly.
      if (tick) { clearInterval(tick); tick = undefined }
      dir = -dir
      wait = setTimeout(() => { tick = setInterval(step, speed) }, endHold)
    }
    wait = setTimeout(() => { tick = setInterval(step, speed) }, hold)
    return () => {
      if (wait) clearTimeout(wait)
      if (tick) clearInterval(tick)
      if (ref.current) ref.current.scrollX = 0
    }
  }, [animate, speed, hold, endHold])

  return (
    <box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
      <text ref={ref} wrapMode="none" fg={p.fg}>{p.children}</text>
    </box>
  )
}
// Just enough for a one-line peek: **bold**, `code`, _italic_/*italic*.
// Block syntax (headings, lists, fences) was already flattened by the
// caller's whitespace collapse; we strip the markers we don't style.

type Seg = { t: string; b?: boolean; c?: boolean; i?: boolean }

// Order matters — code first so ** inside backticks stays literal.
// Single * / _ require a non-word char (or start/end) on the outer
// side so snake_case and a*b don't become italics.
const RX = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|((?<![\w*])\*[^*\s][^*]*\*(?![\w*]))|((?<!\w)_[^_\s][^_]*_(?!\w))/g

/** Tokenize one line of collapsed markdown into styled segments. */
export const inline = (s: string): Seg[] => {
  const out: Seg[] = []
  let last = 0
  for (const m of s.matchAll(RX)) {
    const at = m.index ?? 0
    if (at > last) out.push({ t: s.slice(last, at) })
    const hit = m[0]
    if (hit.startsWith("`"))       out.push({ t: hit.slice(1, -1), c: true })
    else if (hit.startsWith("**") || hit.startsWith("__"))
                                   out.push({ t: hit.slice(2, -2), b: true })
    else                           out.push({ t: hit.slice(1, -1), i: true })
    last = at + hit.length
  }
  if (last < s.length) out.push({ t: s.slice(last) })
  // Scrub residual block markers that survived the collapse.
  return out.map(seg => seg.c ? seg : { ...seg, t: seg.t.replace(/^#{1,6}\s+/, "") })
}
