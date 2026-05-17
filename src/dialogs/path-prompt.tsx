// Single-line path prompt with Tab-completion. Tab calls `complete.path`
// (same RPC the `@file:` popover uses), picks the first item whose `text`
// passes `filter` (directories always pass so navigation works), and
// replaces the input. Up to 5 matches show below the input as muted text.
// Enter submits, Esc cancels.

import { useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import type { Gateway } from "../context/gateway"

type Item = { readonly text: string; readonly display: string; readonly meta: string }

type Props = {
  title: string
  label?: string
  initial?: string
  filter?: RegExp
  gw: Gateway
  onSubmit: (value: string) => void
}

const PathPrompt = (props: Props) => {
  const theme = useTheme().theme
  const [value, setValue] = useState(props.initial ?? "")
  const [items, setItems] = useState<Item[]>([])
  const seq = useRef(0)

  const ok = (it: Item) => it.meta === "dir" || !props.filter || props.filter.test(it.text)

  useEffect(() => {
    if (!value.trim()) { setItems([]); return }
    const me = ++seq.current
    const t = setTimeout(() => {
      props.gw.request<{ items: Item[] }>("complete.path", { word: value })
        .then(r => { if (seq.current === me) setItems((r.items ?? []).filter(ok).slice(0, 5)) })
        .catch(() => { if (seq.current === me) setItems([]) })
    }, 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, props.gw])

  useKeyboard(key => {
    if (key.name !== "tab") return
    key.preventDefault()
    const hit = items[0]
    if (hit) setValue(hit.text)
  })

  return (
    <box flexDirection="column" width={72}>
      <box height={1}><text fg={theme.primary}><strong>{props.title}</strong></text></box>
      <box height={1} />
      {props.label ? <box height={1}><text fg={theme.textMuted}>{props.label}</text></box> : null}
      <box height={1} flexDirection="row" overflow="hidden">
        <box flexShrink={0}><text fg={theme.accent}>{"┃ "}</text></box>
        <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
          <input
            value={value}
            onInput={setValue}
            onSubmit={() => { const v = value.trim(); if (v) props.onSubmit(v) }}
            focused
            textColor={theme.text}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
          />
        </box>
      </box>
      <box height={1} />
      {items.length > 0 ? items.map(it => (
        <box key={it.text} height={1} flexDirection="row" overflow="hidden">
          <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
            <text fg={theme.textMuted}>{it.text}</text>
          </box>
          {it.meta ? (
            <box flexShrink={0} height={1}><text fg={theme.textMuted}>{`  ${it.meta}`}</text></box>
          ) : null}
        </box>
      )) : null}
      {items.length > 0 ? <box height={1} /> : null}
      <box height={1}><text fg={theme.textMuted}>
        {value.trim()
          ? `Tab complete  ·  Enter confirm  ·  Esc cancel${items.length > 0 ? `  ·  ${items.length} match${items.length === 1 ? "" : "es"}` : ""}`
          : "Type a path  ·  Esc cancel"}
      </text></box>
    </box>
  )
}

export function openPathPrompt(
  dialog: DialogContext,
  gw: Gateway,
  opts: { title: string; label?: string; initial?: string; filter?: RegExp },
): Promise<string | null> {
  return new Promise(resolve => {
    dialog.replace(
      <PathPrompt
        title={opts.title} label={opts.label} initial={opts.initial}
        filter={opts.filter} gw={gw}
        onSubmit={v => { resolve(v); dialog.clear() }}
      />,
      () => resolve(null),
    )
  })
}
