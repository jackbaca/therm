// InlineTool — one terse ThoughtCloud trail row with optional nested
// details. Diff bodies stay in MessageItem/DiffTabs, never here.

import { memo, useState, type ReactNode } from "react"
import type { RGBA } from "@opentui/core"
import type { ToolPart } from "../../../types/message"
import { useTheme } from "../../../theme"
import { useSpinnerGlyph } from "../../../ui/spinner"
import { spec } from "./preview"

function ms(d?: number): string {
  if (d == null) return ""
  if (d < 1000) return `${Math.round(d)}ms`
  if (d < 60000) return `${(d / 1000).toFixed(1)}s`
  return `${Math.floor(d / 60000)}m${Math.round((d % 60000) / 1000)}s`
}

export type Branch = "mid" | "last"
export type Detail = { label: string; text: string; tone?: "error" | "muted" }

type InlineProps = {
  part: ToolPart
  branch?: Branch
  /** Content for the collapsed row; usually preview text. */
  children: ReactNode
  /** True once enough input exists to show `children` instead of pending. */
  complete?: boolean
  details?: Detail[]
  iconColor?: RGBA
  onClick?: () => void
}

export const lead = (branch: Branch) => branch === "mid" ? "├─ " : "└─ "
export const rail = (branch: Branch) => branch === "mid" ? "│  " : "   "

const DetailRow = memo((p: { branch: Branch; detail: Detail; last: boolean }) => {
  const theme = useTheme().theme
  const fg = p.detail.tone === "error" ? theme.error : theme.textMuted
  const stem = rail(p.branch)
  const fork = p.last ? "└─ " : "├─ "
  const pad = p.last ? "   " : "│  "
  const lines = p.detail.text.replace(/\t/g, "  ").split("\n")

  return (
    <box flexDirection="column">
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>{stem}{fork}</span>
          <span fg={fg}>{p.detail.label}</span>
        </text>
      </box>
      {lines.map((line, i) => (
        <box key={i} minHeight={1}>
          <text fg={fg} wrapMode="word">{stem}{pad}{line || " "}</text>
        </box>
      ))}
    </box>
  )
})

export const InlineTool = memo((p: InlineProps) => {
  const theme = useTheme().theme
  const [hover, setHover] = useState(false)
  const s = spec(p.part.name)
  const branch = p.branch ?? "last"
  const running = p.part.status === "running"
  const failed = p.part.status === "error"
  const spin = useSpinnerGlyph(running)

  const fg = failed ? theme.error
    : hover && p.onClick ? theme.text
    : running ? theme.text
    : theme.textMuted

  return (
    <box
      flexDirection="column"
      onMouseOver={p.onClick ? () => setHover(true) : undefined}
      onMouseOut={p.onClick ? () => setHover(false) : undefined}
      onMouseDown={p.onClick}
    >
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>{lead(branch)}</span>
          <span fg={running ? theme.warning : p.iconColor ?? fg}>{running ? spin : "●"} </span>
          {p.complete ?? true
            ? <span fg={fg}>{p.children}</span>
            : <span fg={fg}>~ {s.pending}</span>}
          {p.part.duration != null
            ? <span fg={theme.textMuted}>  {ms(p.part.duration)}</span>
            : null}
        </text>
      </box>
      {p.details?.map((detail, i, list) => (
        <DetailRow key={detail.label} branch={branch} detail={detail} last={i === list.length - 1} />
      ))}
    </box>
  )
})
