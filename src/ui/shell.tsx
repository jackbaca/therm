import type { ReactNode } from "react"
import { useTheme } from "../theme"

// Bordered panel chrome shared by every tab: bare title line, optional
// error line, a one-row gap, then the body. Body is wrapped in a
// flexGrow column with minWidth=0 so children can truncate instead of
// forcing the panel wider than the terminal.
//
// Keybind hints do NOT live here — each tab owns a single <HintBar>
// footer rendered below all its panes (docs/nav_and_ui_standards.md §
// Hint Line). Multi-pane tabs otherwise rendered two competing header
// hints with no room for either.
//
// `focus` switches the border to theme.primary — used when a tab
// hosts multiple panels and wants to show which has keyboard focus.
// `grow` lets side-by-side panels set their flex ratio directly;
// flexBasis=0 makes the ratio authoritative regardless of content.

export const TabShell = (props: {
  title: string
  error?: string | null
  focus?: boolean
  grow?: number
  children?: ReactNode
}) => {
  const theme = useTheme().theme
  return (
    <box flexDirection="column" flexGrow={props.grow ?? 1} flexBasis={0} minWidth={0}
         border borderColor={props.focus ? theme.primary : theme.border}
         backgroundColor={theme.backgroundPanel} padding={1}>
      <box height={1} overflow="hidden">
        <text fg={theme.primary} wrapMode="none"><strong>{props.title}</strong></text>
      </box>
      {props.error
        ? <box height={1}><text fg={theme.error}>{`⚠ ${props.error}`}</text></box>
        : null}
      <box height={1} />
      <box flexDirection="column" flexGrow={1} minWidth={0}>
        {props.children}
      </box>
    </box>
  )
}
