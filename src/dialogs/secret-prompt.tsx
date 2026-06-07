// Single-line masked secret prompt dialog. Enter submits, Esc cancels.

import { useState } from "react"
import { useTheme } from "../theme"
import { MaskInput } from "../ui/mask-input"

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
      <MaskInput value={value} input={setValue}
                 submit={() => { const v = value.trim(); if (v) props.onSubmit(v) }} />
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {value.trim() ? "Enter confirm  ·  Esc cancel" : "Esc cancel"}
      </text></box>
    </box>
  )
}
