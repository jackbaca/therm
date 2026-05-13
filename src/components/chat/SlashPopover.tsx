/**
 * Slash command popover — OpenCode-inspired visual style.
 *
 * Purely presentational. Keyboard navigation lives in the parent (app.tsx
 * useKeyboard) to avoid OpenTUI's global keyboard event conflicts.
 *
 * Uses a sliding window that follows the cursor rather than scrollbox
 * (scrollbox requires focus to scroll, which would conflict with the input).
 */

import { useMemo, memo } from "react"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../../theme"
import type { Theme } from "../../theme"
import type { SlashCommand, SlashSource } from "../../app/slashCommands"
import { sort } from "../../app/slashCommands"

type Props = {
  readonly commands: ReadonlyArray<SlashCommand>
  readonly cursor: number
  readonly onCursor: (idx: number) => void
  readonly onSelect: (cmd: SlashCommand) => void
}

type Row =
  | { type: "header"; cat: string }
  | { type: "cmd"; cmd: SlashCommand; flat: number }

const MAX_VISIBLE = 14

/** Color for the source badge. Returns null for sources that shouldn't render. */
function badge(source: SlashSource, theme: Theme): RGBA | null {
  if (source === "skill") return theme.success
  if (source === "plugin") return theme.info
  if (source === "mcp") return theme.warning
  return null // "command" and "local" get no badge
}

export const SlashPopover = memo(({ commands: cmds, cursor, onCursor, onSelect }: Props) => {
  const theme = useTheme().theme

  if (cmds.length === 0) {
    return (
      <box
        border
        borderStyle="single"
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        paddingX={1}
        height={3}
      >
        <text fg={theme.textMuted}>No matching commands</text>
      </box>
    )
  }

  // Build flat row list with category headers, stable order (sort by category).
  const rows = useMemo(() => {
    const sorted = sort(cmds)
    const result: Row[] = []
    let flat = 0
    let lastCat = ""
    for (const cmd of sorted) {
      if (cmd.category !== lastCat) {
        result.push({ type: "header", cat: cmd.category })
        lastCat = cmd.category
      }
      result.push({ type: "cmd", cmd, flat: flat++ })
    }
    return result
  }, [cmds])

  // Find the row index of the cursor to drive the sliding window.
  const cursorRow = rows.findIndex(r => r.type === "cmd" && r.flat === cursor)
  const start = Math.max(0, Math.min(cursorRow - 2, rows.length - MAX_VISIBLE))
  const visible = rows.slice(start, start + MAX_VISIBLE)
  const clipped = rows.length > MAX_VISIBLE
  const above = clipped && start > 0
  const below = clipped && start + MAX_VISIBLE < rows.length
  const height = visible.length + 2 + (above ? 1 : 0) + (below ? 1 : 0)

  return (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      paddingX={1}
      height={height}
    >
      {above ? (
        <box height={1} paddingLeft={1}>
          <text fg={theme.textMuted}>↑ more</text>
        </box>
      ) : null}
      {visible.map((row) => {
        if (row.type === "header") {
          return (
            <box key={`h-${row.cat}`} height={1} paddingLeft={1}>
              <text>
                <span fg={theme.textMuted}>
                  <strong>{row.cat}</strong>
                </span>
              </text>
            </box>
          )
        }

        const active = row.flat === cursor
        const color = badge(row.cmd.source, theme)

        return (
          <box
            key={`c-${row.cmd.name}`}
            height={1}
            flexDirection="row"
            backgroundColor={active ? theme.backgroundElement : undefined}
            onMouseOver={() => onCursor(row.flat)}
            onMouseDown={() => onSelect(row.cmd)}
            paddingLeft={2}
            paddingRight={1}
          >
            {/* Left: /name [args]  description */}
            <box flexGrow={1} height={1}>
              <text>
                <span fg={active ? theme.primary : theme.text}>/{row.cmd.name}</span>
                {row.cmd.argsHint ? (
                  <span fg={theme.textMuted}> {row.cmd.argsHint}</span>
                ) : null}
                <span fg={theme.textMuted}>  {row.cmd.description}</span>
              </text>
            </box>

            {/* Right: source badge + keybind */}
            <box height={1} flexDirection="row">
              {color ? (
                <text>
                  <span fg={color}> {row.cmd.source}</span>
                </text>
              ) : null}
              {row.cmd.keybind ? (
                <text>
                  <span fg={theme.textMuted}>  {row.cmd.keybind}</span>
                </text>
              ) : null}
            </box>
          </box>
        )
      })}
      {below ? (
        <box height={1} paddingLeft={1}>
          <text fg={theme.textMuted}>↓ more</text>
        </box>
      ) : null}
    </box>
  )
})
