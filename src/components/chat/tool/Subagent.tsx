// delegate_task / subagent renderer. The parent task stays a terse
// ThoughtCloud trail row; clicking opens the child tool trail.

import { memo, useState } from "react"
import type { ToolPart as Part } from "../../../types/message"
import { useTheme } from "../../../theme"
import { useSpinnerGlyph } from "../../../ui/spinner"
import { spec } from "./preview"
import { lead, rail, type Branch } from "./frame"

function dur(d?: number): string {
  if (d == null) return ""
  const s = d / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
}

export const Subagent = memo(({ branch = "last", tool }: { branch?: Branch; tool: Part }) => {
  const theme = useTheme().theme
  const [open, setOpen] = useState(false)
  const running = tool.status === "running"
  const failed = tool.status === "error"
  const spin = useSpinnerGlyph(running)
  const trail = tool.trail ?? []
  const last = trail[trail.length - 1]
  const stem = rail(branch)

  const fg = failed ? theme.error : running ? theme.text : theme.textMuted
  const goal = (tool.goal ?? tool.preview ?? "").replace(/\s+/g, " ").trim()

  const sub = running
    ? last
      ? `↳ ${spec(last.name).verb || last.name} ${last.preview ?? ""}`
      : trail.length ? `↳ ${trail.length} toolcalls` : ""
    : `└─ ${trail.length} toolcall${trail.length === 1 ? "" : "s"}${tool.duration ? ` · ${dur(tool.duration)}` : ""}`

  return (
    <box flexDirection="column" onMouseDown={trail.length ? () => setOpen(o => !o) : undefined}>
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>{lead(branch)}</span>
          <span fg={running ? theme.warning : fg}>{running ? spin : "●"} </span>
          <span fg={fg}>Task — {goal || "delegating…"}</span>
        </text>
      </box>
      {open ? (
        <box flexDirection="column">
          {trail.map((c, i) => {
            const s = spec(c.name)
            const lbl = s.verb ? `${s.verb} ${c.preview ?? ""}` : c.preview ?? c.name
            return (
              <box key={i} height={1}>
                <text>
                  <span fg={theme.textMuted}>{stem}{i < trail.length - 1 ? "├─ " : "└─ "}</span>
                  <span fg={theme.textMuted}>{s.icon} {lbl}</span>
                </text>
              </box>
            )
          })}
          {tool.result ? (
            <box minHeight={1}>
              <text fg={theme.textMuted} wrapMode="word">{stem}   {tool.result}</text>
            </box>
          ) : null}
        </box>
      ) : sub ? (
        <box height={1}>
          <text fg={theme.textMuted}>{stem}{sub}</text>
        </box>
      ) : null}
    </box>
  )
})
