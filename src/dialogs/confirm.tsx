// Generic y/n confirm dialog. `openConfirm(dialog, {...})` resolves to
// true on [y], false on [n]/Esc.

import { useKeyboard } from "@opentui/react"
import { useKeys } from "../keys"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"

type Props = {
  title: string
  body: string
  yes?: string
  no?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const Confirm = (props: Props) => {
  const theme = useTheme().theme
  const keys = useKeys()
  useKeyboard((key) => {
    if (keys.match("dialog.confirm", key) || keys.match("dialog.accept", key)) return props.onConfirm()
    if (keys.match("dialog.deny", key)) return props.onCancel()
  })
  return (
    <box flexDirection="column" width={54}>
      <box height={1}>
        <text fg={props.danger ? theme.warning : theme.primary}>
          <strong>{props.title}</strong>
        </text>
      </box>
      <box height={1} />
      <box minHeight={1}><text wrapMode="word">{props.body}</text></box>
      <box height={1} />
      <box height={1}>
        <text fg={theme.textMuted}>
          {`[${keys.print("dialog.confirm")}/${keys.print("dialog.accept")}] ${props.yes ?? "confirm"}   [${keys.print("dialog.deny")}] ${props.no ?? "cancel"}`}
        </text>
      </box>
    </box>
  )
}

export function openConfirm(
  dialog: DialogContext,
  opts: Omit<Props, "onConfirm" | "onCancel">,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => { resolve(v); dialog.clear() }
    dialog.replace(
      <Confirm {...opts} onConfirm={() => done(true)} onCancel={() => done(false)} />,
      () => resolve(false),
    )
  })
}
