// Tabbed diff frame for an assistant turn — replaces the prior stack of
// ▸ collapsible chips with one CodeBlock-style frame whose header is a
// wrapping row of file tabs (basenames). The active tab swaps the body.
// Always-open: there's no per-chip toggle. Mouse-only selection.

import { memo, useMemo, useState } from "react"
import type { MouseEvent } from "@opentui/core"
import type { ToolPart } from "../../types/message"
import { LEFT_BAR } from "../../ui/borders"
import { DiffBlock, isDiff } from "./DiffBlock"
import { useTheme } from "../../theme"

const base = (p: string) => p.split(/[\\/]/).pop() ?? p
const parent = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ""
}
const trunc = (s: string, n: number) => s.length <= n ? s : "…" + s.slice(-(n - 1))

type Tab = { id: string; label: string; diff: string; add: number; del: number }

function buildTabs(tools: ToolPart[]): Tab[] {
  const raw = tools.flatMap(t => {
    const diff = t.diff ?? (isDiff(t.result) ? t.result : undefined)
    if (!diff) return []
    return [{ tool: t, path: t.preview ?? t.name, diff }]
  })
  // Disambiguate duplicate basenames (a/Foo.tsx + b/Foo.tsx) by prefixing
  // the parent dir only when needed — keeps short labels short.
  const counts = new Map<string, number>()
  raw.forEach(r => counts.set(base(r.path), (counts.get(base(r.path)) ?? 0) + 1))
  return raw.map(({ tool, path, diff }) => {
    const b = base(path)
    const dup = (counts.get(b) ?? 0) > 1 && parent(path)
    const label = trunc(dup ? `${parent(path)}/${b}` : b, 24)
    const lines = diff.split("\n")
    const add = lines.filter(l => /^\+(?!\+\+)/.test(l)).length
    const del = lines.filter(l => /^-(?!--)/.test(l)).length
    return { id: tool.id || `${tool.name}-${path}`, label, diff, add, del }
  })
}

export const DiffTabs = memo(({ tools }: { tools: ToolPart[] }) => {
  const theme = useTheme().theme
  const tabs = useMemo(() => buildTabs(tools), [tools])
  const [active, setActive] = useState(0)
  if (tabs.length === 0) return null
  const cur = tabs[Math.min(active, tabs.length - 1)]

  return (
    <box
      flexDirection="column" marginTop={1}
      border={["left"]} borderColor={theme.border} customBorderChars={LEFT_BAR}
      backgroundColor={theme.backgroundPanel} paddingLeft={1}
    >
      <box
        flexDirection="row" flexWrap="wrap"
        backgroundColor={theme.backgroundElement} paddingX={1}
      >
        {tabs.map((t, i) => {
          const on = i === active
          return (
            <box
              key={t.id} height={1} flexShrink={0} marginRight={1} paddingX={1}
              backgroundColor={on ? theme.backgroundPanel : undefined}
              onMouseDown={(e: MouseEvent) => { e.stopPropagation(); setActive(i) }}
            >
              <text fg={on ? theme.primary : theme.textMuted}>
                {on ? <strong>{t.label}</strong> : t.label}
              </text>
            </box>
          )
        })}
      </box>
      <box height={1} paddingX={1}>
        <text>
          <span fg={theme.success}>+{cur.add}</span>
          <span fg={theme.textMuted}> / </span>
          <span fg={theme.error}>-{cur.del}</span>
        </text>
      </box>
      <box paddingX={1} paddingBottom={1}>
        <DiffBlock text={cur.diff} />
      </box>
    </box>
  )
})
