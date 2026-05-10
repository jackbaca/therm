import { memo } from "react"
import { useTheme } from "../../theme"

type Props = {
  tabs: readonly string[]
  active: number
  onChange: (i: number) => void
  hint?: string
}

// Narrow horizontal strip shown at the top of group tabs. Visually lower-
// weight than the primary TabBar: no bold, no background block, a thin
// underline on the active entry. Mouse click switches; keyboard switching
// lives in useAppKeys (Shift+←/→).
export const SubTabBar = memo(({ tabs, active, onChange, hint }: Props) => {
  const theme = useTheme().theme
  return (
    <box width="100%" flexDirection="row" height={1} overflow="hidden">
      {tabs.map((name, i) => (
        <box
          key={i}
          onMouseDown={() => onChange(i)}
          paddingX={1}
          marginRight={1}
          flexShrink={0}
        >
          <text>
            <span fg={i === active ? theme.accent : theme.textMuted}>
              {i === active ? `● ${name}` : `  ${name}`}
            </span>
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
