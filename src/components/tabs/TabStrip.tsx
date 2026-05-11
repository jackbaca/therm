import { memo } from "react"
import { useTheme } from "../../theme"

// Shared horizontal tab strip. Top-level TabBar and per-group SubTabBar
// both render this so the two levels read as the same control (see
// docs/nav.md § Tab Bars) — they differ only in nav chord and hint text,
// which callers supply. No digit prefix, no bullet; active entry gets a
// bold label on a backgroundElement block, inactive entries are muted.
// Keyboard lives in useAppKeys; this is click + paint only.

type Props = {
  tabs: readonly string[]
  active: number
  onChange: (i: number) => void
  hint?: string
}

export const TabStrip = memo(({ tabs, active, onChange, hint }: Props) => {
  const theme = useTheme().theme
  return (
    <box width="100%" flexDirection="row" height={1} overflow="hidden">
      {tabs.map((name, i) => (
        <box
          key={i}
          onMouseDown={() => onChange(i)}
          paddingX={2}
          marginRight={1}
          flexShrink={0}
          backgroundColor={i === active ? theme.backgroundElement : undefined}
        >
          <text fg={i === active ? theme.primary : theme.textMuted}>
            <strong>{name}</strong>
          </text>
        </box>
      ))}
      <box flexGrow={1} minWidth={0} />
      {hint ? (
        <box paddingX={1} flexShrink={1} minWidth={0} overflow="hidden">
          <text fg={theme.borderSubtle}>{hint}</text>
        </box>
      ) : null}
    </box>
  )
})
