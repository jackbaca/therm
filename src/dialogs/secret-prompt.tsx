// Single-line masked secret prompt dialog. Enter submits, Esc cancels.

import { useState } from "react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"

type Props = {
  title: string
  label?: string
  onSubmit: (value: string) => void
}

export const SecretPrompt = (props: Props) => {
  const theme = useTheme().theme
  const [value, setValue] = useState("")

  return (
    <box flexDirection="column" width={60}>
      <box height={1}><text fg={theme.warning}><strong>{props.title}</strong></text></box>
      <box height={1} />
      {props.label ? <box height={1}><text fg={theme.textMuted}>{props.label}</text></box> : null}
      <box height={1} flexDirection="row" position="relative">
        <text fg={theme.textMuted}>{"> "}</text>
        <input
          value={value}
          onInput={setValue}
          onSubmit={() => { const v = value.trim(); if (v) props.onSubmit(v) }}
          focused
          flexGrow={1}
          textColor={theme.backgroundElement}
          cursorColor={theme.accent}
          backgroundColor={theme.backgroundElement}
          focusedBackgroundColor={theme.backgroundElement}
        />
        <box position="absolute" left={2} top={0} height={1}>
          <text fg={theme.text} bg={theme.backgroundElement}>{"•".repeat(value.length)}</text>
        </box>
      </box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {value.trim() ? "Enter confirm  ·  Esc cancel" : "Esc cancel"}
      </text></box>
    </box>
  )
}

export function openSecretPrompt(
  dialog: DialogContext,
  opts: { title: string; label?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.replace(
      <SecretPrompt
        title={opts.title} label={opts.label}
        onSubmit={(v) => { resolve(v); dialog.clear() }}
      />,
      () => resolve(null),
    )
  })
}
