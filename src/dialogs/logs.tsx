// Gateway subprocess stderr tail — everything GatewayClient.log() captured
// (stderr lines, protocol errors, startup-timeout markers). The ring
// buffer holds the last ~200 lines regardless of what the transcript
// chose to surface.

import { useTheme } from "../theme"
import { useGateway } from "../context/gateway"
import { useDialog } from "../ui/dialog"

const ERRLIKE = /error|fail|traceback|exception|\b[45]\d\d\b|refused|denied|unauthori/i

const LogsDialog = () => {
  const theme = useTheme().theme
  const gw = useGateway()
  const lines = gw.tail(200).split("\n").filter(Boolean)

  return (
    <box flexDirection="column" width={110} height={Math.min(34, Math.max(8, lines.length + 5))}>
      <box height={1}><text fg={theme.primary}><strong>Gateway Logs</strong></text></box>
      <box height={1}><text fg={theme.textMuted}>{lines.length} lines · stderr + protocol · Esc to close</text></box>
      <box height={1} />
      {lines.length === 0 ? (
        <box height={1}><text fg={theme.textMuted}>No log output captured.</text></box>
      ) : (
        <scrollbox scrollY stickyScroll stickyStart="bottom" flexGrow={1}>
          <box flexDirection="column">
            {lines.map((l, i) => (
              <box key={i} height={1}>
                <text fg={ERRLIKE.test(l) ? theme.error : theme.textMuted}>
                  {l.length > 106 ? l.slice(0, 105) + "…" : l}
                </text>
              </box>
            ))}
          </box>
        </scrollbox>
      )}
    </box>
  )
}

export const openLogs = (dialog: ReturnType<typeof useDialog>) =>
  dialog.replace(<LogsDialog />)
