import { memo } from "react"
import { useTheme } from "../../theme"
import type { SessionInfo } from "../../context/wire"
import type { Usage } from "../../types/message"
import { formatTokens } from "../../utils/tokens"

// Context-compaction gauge for the sidebar. Three-line block:
//   258K / 1M                          (used / limit, centered)
//  [████████████░░░░░░░░░░░░░░░░░░░]   (bar spans ~full width minus [])
//              26%                     (percent, centered)
//
// Color ramps with ratio:
//   <0.50 → textMuted   (plenty of room)
//   <0.75 → primary     (normal working range)
//   <0.90 → warning     (approaching compression)
//   ≥0.90 → error       (hot)
//
// Hidden entirely when live usage is unavailable — never renders a
// stale or fabricated value.

const FILL = "█"
const EMPTY = "░"

type Ramp = "muted" | "primary" | "warning" | "error"

const ramp = (ratio: number): Ramp => {
  if (ratio >= 0.90) return "error"
  if (ratio >= 0.75) return "warning"
  if (ratio >= 0.50) return "primary"
  return "muted"
}

const centered = (s: string, width: number): string => {
  const pad = Math.max(0, width - s.length)
  // Bias the extra space to the right when pad is odd. Terminal glyphs
  // are visually slightly left-weighted, so ceil-left / floor-right
  // reads as more optically centered than the naive floor/ceil split.
  const left = Math.ceil(pad / 2)
  const right = pad - left
  return " ".repeat(left) + s + " ".repeat(right)
}

const formatPct = (ratio: number): string => {
  const pct = ratio * 100
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

export const ContextGauge = memo((props: {
  info?: SessionInfo | null
  usage?: Usage
  width: number
}) => {
  const theme = useTheme().theme
  const info = props.info

  // Live usage from message.complete events takes priority over the
  // session.info snapshot (which is captured at session create and
  // stale after any turn). Fall back to info.usage for the first
  // render after resume, before any new wire event has arrived.
  const used = props.usage?.context_used ?? info?.usage?.context_used ?? info?.context_used
  const max = props.usage?.context_max ?? info?.usage?.context_max ?? info?.context_max

  // No live data → hide. Stale gauges are worse than no gauge.
  // Note: used=0 is valid (fresh session, no turn yet). Guard on the
  // max (non-positive → no compression wired up → hide).
  if (typeof max !== "number" || max <= 0) return null
  if (typeof used !== "number") return null

  const ratio = Math.max(0, Math.min(1, used / max))
  // Bar fills the row minus the two bracket chars; min 8 cells for
  // safety at very narrow widths.
  const cells = Math.max(8, props.width - 2)
  const filled = Math.round(ratio * cells)
  const bar = FILL.repeat(filled) + EMPTY.repeat(cells - filled)

  const color = (() => {
    switch (ramp(ratio)) {
      case "error":   return theme.error
      case "warning": return theme.warning
      case "primary": return theme.primary
      default:        return theme.textMuted
    }
  })()

  const top = `${formatTokens(used)} / ${formatTokens(max)}`
  const pct = formatPct(ratio)

  return (
    <box flexDirection="column" marginTop={1}>
      <box height={1}>
        <text><span fg={theme.textMuted}>{centered(top, props.width)}</span></text>
      </box>
      <box height={1}>
        <text><span fg={color}>{centered(`[${bar}]`, props.width)}</span></text>
      </box>
      <box height={1}>
        <text><span fg={theme.textMuted}>{centered(pct, props.width)}</span></text>
      </box>
    </box>
  )
})
