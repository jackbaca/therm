// Help dialog — keyboard shortcut reference, generated from the
// action catalog so it stays correct under user rebinds.

import { useMemo } from "react"
import { useTheme } from "../theme"
import { useKeys, type Scope } from "../keys"

type Group = { title: string; scope: Scope }

const GROUPS: ReadonlyArray<Group> = [
  { title: "Global",   scope: "global" },
  { title: "Composer", scope: "composer" },
  { title: "Lists",    scope: "list" },
  { title: "Dialogs",  scope: "dialog" },
  { title: "Sessions", scope: "sessions" },
  { title: "Agents",   scope: "agents" },
  { title: "Config",   scope: "config" },
  { title: "Eikon",    scope: "eikon" },
]

const COLS = 2

export const HelpDialog = () => {
  const theme = useTheme().theme
  const keys = useKeys()

  const sections = useMemo(() =>
    GROUPS.map(g => ({
      title: g.title,
      rows: keys.all(g.scope)
        .filter(e => e.id !== "leader" && e.chord.length > 0)
        .map(e => [keys.print(e.id), e.desc] as const),
    })).filter(s => s.rows.length > 0),
  [keys])

  const total = sections.reduce((n, s) => n + s.rows.length + 2, 0)
  const split = Math.ceil(total / COLS)

  // Flow sections into two roughly-equal columns. A section goes to
  // column 1 once placing it in column 0 would overshoot the split.
  const cols: typeof sections[] = [[], []]
  let acc = 0
  for (const s of sections) {
    const h = s.rows.length + 2
    const i = acc + h <= split || cols[0].length === 0 ? 0 : 1
    cols[i].push(s)
    if (i === 0) acc += h
  }

  return (
    <box flexDirection="column" width={104}>
      <box height={1} flexDirection="row">
        <box flexGrow={1}>
          <text fg={theme.text}><strong>Keyboard Shortcuts</strong></text>
        </box>
        <text fg={theme.textMuted}>{`leader = ${keys.print("leader")}`}</text>
      </box>
      <box height={1} />
      <box flexDirection="row" gap={3}>
        {cols.map((col, ci) => (
          <box key={ci} flexDirection="column" flexGrow={1} flexBasis={0}>
            {col.map(s => (
              <box key={s.title} flexDirection="column" marginBottom={1}>
                <text fg={theme.primary}><strong>{s.title}</strong></text>
                {s.rows.map(([chord, desc]) => (
                  <box key={chord + desc} flexDirection="row" height={1} paddingLeft={1}>
                    <box width={14}><text fg={theme.accent}>{chord}</text></box>
                    <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
                      <text fg={theme.textMuted}>{desc}</text>
                    </box>
                  </box>
                ))}
              </box>
            ))}
          </box>
        ))}
      </box>
      <text fg={theme.textMuted}>esc to close</text>
    </box>
  )
}
