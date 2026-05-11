import { memo } from "react"
import { useTheme } from "../theme"

// Tab-footer hint line (docs/nav_and_ui_standards.md § Hint Line).
// One row, rendered below all panes and above the composer. Muted
// text, clips instead of wraps.
//
// Two input shapes during migration:
//   - `pairs`: structured [key, verb] list, rendered as `[key] verb`
//     separated by 2 spaces. Preferred going forward; sibling card
//     t_2b0d31ac rebuilds tabs around this.
//   - `raw`: free-form string (previous TabShell.hint text). Relocated
//     verbatim so the footer move is layout-only; each tab migrates to
//     `pairs` when its nav is fully catalog-resolved.

type Pair = readonly [string, string]

export const HintBar = memo((props: { pairs?: readonly Pair[]; raw?: string }) => {
  const theme = useTheme().theme
  const text = props.pairs
    ? props.pairs.map(p => `[${p[0]}] ${p[1]}`).join("  ")
    : props.raw ?? ""
  return (
    <box height={1} flexShrink={0} paddingX={1} overflow="hidden">
      <text fg={theme.textMuted} wrapMode="none">{text}</text>
    </box>
  )
})
