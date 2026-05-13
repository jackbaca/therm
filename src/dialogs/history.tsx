// Read-only transcript viewer for the *live* session (authoritative
// gateway history, not herm's render state). Useful after resuming a
// session (shows server messages herm hasn't rendered) and for sanity
// checking what session.undo / rewind actually removed.
//
// Row shape comes from tui_gateway `_history_to_messages`:
//   user/assistant/system → {role, text}
//   tool                  → {role, name, context}  (args summary, no result)

import { useEffect, useState } from "react"
import { useTheme, type Theme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import type { Gateway } from "../context/gateway"
import type { TranscriptMessage } from "../context/wire"
import { trunc } from "../ui/fmt"

type Res = { count: number; messages: TranscriptMessage[] }

const tag = (m: TranscriptMessage, theme: Theme) =>
  m.role === "user" ? { label: "▸ You", fg: theme.info }
  : m.role === "assistant" ? { label: "◂ Agent", fg: theme.success }
  : m.role === "tool" ? { label: `⚙ ${m.name ?? "tool"}`, fg: theme.warning }
  : { label: "· system", fg: theme.textMuted }

// Flatten native-mode parts-lists to the first text fragment so the
// history preview renders something meaningful instead of [object Object].
const flatten = (t: TranscriptMessage["text"]): string => {
  if (typeof t === "string") return t
  if (!Array.isArray(t)) return ""
  for (const p of t)
    if (p && typeof p === "object" && "type" in p && p.type === "text"
        && "text" in p && typeof p.text === "string") return p.text
  return ""
}

const body = (m: TranscriptMessage) =>
  m.role === "tool" ? (m.context ?? "") : flatten(m.text)

const HistoryDialog = (props: { gw: Gateway }) => {
  const theme = useTheme().theme
  const [rows, setRows] = useState<TranscriptMessage[] | null>(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    props.gw.request<Res>("session.history")
      .then(r => setRows(r.messages ?? []))
      .catch((e: Error) => { setErr(e.message); setRows([]) })
  }, [props.gw])

  const n = rows?.length ?? 0
  const h = Math.min(34, Math.max(8, n + 5))

  return (
    <box flexDirection="column" width={110} height={h}>
      <box height={1}><text fg={theme.primary}><strong>Session History</strong></text></box>
      <box height={1}>
        <text fg={err ? theme.error : theme.textMuted}>
          {err ? `⚠ ${err}` : `${n} messages · server-authoritative · Esc to close`}
        </text>
      </box>
      <box height={1} />
      {rows === null ? (
        <box height={1}><text fg={theme.textMuted}>loading…</text></box>
      ) : n === 0 ? (
        <box height={1}><text fg={theme.textMuted}>Empty — no turns yet.</text></box>
      ) : (
        <scrollbox scrollY flexGrow={1}>
          <box flexDirection="column">
            {rows.map((m, i) => {
              const t = tag(m, theme)
              return (
                <box key={i} height={1} flexDirection="row">
                  <box width={14} flexShrink={0}>
                    <text fg={t.fg}>{trunc(t.label, 13)}</text>
                  </box>
                  <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
                    <text fg={m.role === "tool" || m.role === "system" ? theme.textMuted : theme.text}>
                      {body(m).replace(/\n/g, " ")}
                    </text>
                  </box>
                </box>
              )
            })}
          </box>
        </scrollbox>
      )}
    </box>
  )
}

export const openHistory = (dialog: DialogContext, gw: Gateway) =>
  dialog.replace(<HistoryDialog gw={gw} />)
