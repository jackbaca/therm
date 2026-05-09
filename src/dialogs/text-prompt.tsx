// Single-line text prompt dialog. Enter submits, Esc cancels.

import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"

type Props = {
  title: string
  label?: string
  initial?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

const TextPrompt = (props: Props) => {
  const theme = useTheme().theme
  const [value, setValue] = useState(props.initial ?? "")

  // Native <input> owns text/paste/cursor; global bus only handles Esc
  // (DialogProvider also clears on Esc, but it doesn't resolve the
  // promise — onCancel does).
  useKeyboard((key) => {
    if (key.name === "escape") return props.onCancel()
  })

  return (
    <box flexDirection="column" width={60}>
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
      <box height={1}><text fg={theme.textMuted}>
        {value.trim() ? "Enter confirm  ·  Esc cancel  ·  Ctrl+U clear" : "Esc cancel"}
      </text></box>
    </box>
  )
}

export function openTextPrompt(
  dialog: DialogContext,
  opts: { title: string; label?: string; initial?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.replace(
      <TextPrompt
        title={opts.title} label={opts.label} initial={opts.initial}
        onSubmit={(v) => { dialog.clear(); resolve(v) }}
        onCancel={() => { dialog.clear(); resolve(null) }}
      />,
    )
  })
}
