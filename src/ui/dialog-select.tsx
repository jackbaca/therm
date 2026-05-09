/**
 * Filterable select dialog — reusable pick-list for dialogs.
 *
 * Keyboard: up/down navigate, enter selects, typing filters.
 * Mouse: hover highlights, click selects.
 * Grouped by category with headers.
 */

import { useState, useMemo, useEffect, useRef } from "react"
import type { ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
import type { ParsedKey, ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "../theme"

export type SelectOption = {
  readonly title: string
  readonly value: string
  readonly description?: string
  readonly hint?: string
  readonly category?: string
}

type Props = {
  readonly title: string
  readonly options: ReadonlyArray<SelectOption>
  readonly onSelect: (option: SelectOption) => void
  readonly onMove?: (option: SelectOption) => void
  /** Printable-key interceptor — return true to consume (skip filter append). */
  readonly onKey?: (key: ParsedKey) => boolean
  readonly placeholder?: string
  readonly current?: string
  readonly footer?: ReactNode
  /** Show the type-to-filter input. Default true. Set false for small
   *  fixed-choice lists (priority, status, …) where filtering is noise
   *  and Space/Enter should be the only way to pick. */
  readonly filterable?: boolean
}

export const DialogSelect = (props: Props) => {
  const filterable = props.filterable ?? true
  const [filter, setFilter] = useState("")
  const [cursor, setCursor] = useState(0)
  const sb = useRef<ScrollBoxRenderable | null>(null)
  const theme = useTheme().theme

  const filtered = useMemo(() => {
    const lower = filter.toLowerCase()
    return props.options.filter(o =>
      o.title.toLowerCase().includes(lower) ||
      (o.description ?? "").toLowerCase().includes(lower)
    )
  }, [filter, props.options])

  // Group by category
  const groups = useMemo(() => {
    const map = new Map<string, SelectOption[]>()
    filtered.forEach(o => {
      const cat = o.category ?? ""
      const arr = map.get(cat) ?? []
      arr.push(o)
      map.set(cat, arr)
    })
    return map
  }, [filtered])

  // Clamp cursor
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1))
  }, [filtered.length, cursor])

  const rowId = (i: number) => `ds-row-${i}`

  const move = (n: number) => setCursor(c => {
    const next = Math.max(0, Math.min(filtered.length - 1, c + n))
    sb.current?.scrollChildIntoView(rowId(next))
    return next
  })

  // Notify on move
  useEffect(() => {
    const item = filtered[cursor]
    if (item && props.onMove) props.onMove(item)
  }, [cursor, filtered, props.onMove])

  useKeyboard((key) => {
    if (key.name === "up") return move(-1)
    if (key.name === "down") return move(1)
    if (key.name === "pageup") return move(-10)
    if (key.name === "pagedown") return move(10)
    // Space selects too when there's no filter input to type into.
    const isSpace = key.name === "space" || key.name === " "
    if (key.name === "return" || (!filterable && isSpace)) {
      const item = filtered[cursor]
      if (item) props.onSelect(item)
      return
    }
    if (props.onKey?.(key)) return
  })

  // Build flat list with index tracking
  let idx = 0
  const entries = Array.from(groups.entries())

  return (
    <box flexDirection="column" width={60}>
      <text fg={theme.text}>
        <strong>{props.title}</strong>
      </text>
      <box height={1} />
      {filterable ? (
        <>
          <input
            value={filter}
            onInput={setFilter}
            placeholder={props.placeholder ?? "Type to filter..."}
            focused={true}
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
          />
          <box height={1} />
        </>
      ) : null}
      {/* ScrollBox root is flex-row ([wrapper, v-scrollbar]); column stacking
          belongs on the content box, not here. With no filter input the
          scrollbox itself takes focus so ↑↓ and Space/Enter work. */}
      <scrollbox ref={sb} scrollY maxHeight={16} focused={!filterable}
        contentOptions={{ flexDirection: "column" }} paddingRight={1}>
        {filtered.length === 0 ? (
          <text fg={theme.textMuted}>{"No results found"}</text>
        ) : null}
        {entries.map(([cat, items]) => {
          const elements: React.ReactNode[] = []
          if (cat) {
            elements.push(
              <text key={`cat-${cat}`} fg={theme.textMuted}>
                <strong>{cat}</strong>
              </text>
            )
          }
          items.forEach(item => {
            const i = idx++
            const active = i === cursor
            const current = item.value === props.current
            elements.push(
              <box
                key={item.value}
                id={rowId(i)}
                flexDirection="row"
                backgroundColor={active ? theme.backgroundElement : undefined}
                onMouseMove={() => setCursor(i)}
                onMouseDown={() => props.onSelect(item)}
                paddingLeft={1}
                paddingRight={1}
              >
                <box flexGrow={1} height={1} overflow="hidden">
                  <text fg={active ? theme.text : theme.textMuted}>
                    {current ? "● " : "  "}{item.title}{item.description ? ` — ${item.description}` : ""}
                  </text>
                </box>
                {item.hint ? (
                  <box flexShrink={0} height={1}>
                    <text fg={theme.textMuted}>{item.hint}</text>
                  </box>
                ) : null}
              </box>
            )
          })
          return elements
        }).flat()}
      </scrollbox>
      {props.footer != null ? <box paddingTop={1}>{props.footer}</box> : null}
    </box>
  )
}
