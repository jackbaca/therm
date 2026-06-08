/**
 * Theme picker dialog — live preview with DialogSelect.
 */

import { useCallback } from "react"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import type { SelectOption } from "../ui/dialog-select"

const ThemePickerDialog = ({ onConfirm }: { onConfirm: () => void }) => {
  const ctx = useTheme()
  const dialog = useDialog()

  const options: SelectOption[] = ctx.names.map(n => ({
    title: n,
    value: n,
  }))

  const onMove = useCallback((opt: SelectOption) => {
    ctx.set(opt.value)
  }, [ctx])

  const onSelect = useCallback((opt: SelectOption) => {
    ctx.set(opt.value)
    onConfirm()
    dialog.clear()
  }, [ctx, dialog, onConfirm])

  const flip = useCallback(() => {
    ctx.setMode(ctx.mode === "dark" ? "light" : "dark")
  }, [ctx])

  const onKey = useCallback((key: { name: string }) => {
    if (key.name !== "tab") return false
    flip()
    return true
  }, [flip])

  const footer = (
    <box height={1} onMouseDown={flip}>
      <text fg={ctx.theme.textMuted}>
        <span>Mode: </span>
        <span fg={ctx.mode === "light" ? ctx.theme.warning : ctx.theme.accent}>{ctx.mode}</span>
        <span> · Tab/click: toggle</span>
      </text>
    </box>
  )

  return (
    <DialogSelect
      title="Switch Theme"
      options={options}
      current={ctx.name}
      onSelect={onSelect}
      onMove={onMove}
      onKey={onKey}
      placeholder="Search themes..."
      footer={footer}
    />
  )
}

/** Open the theme picker, reverting on close without selection */
export const openThemePicker = (dialog: ReturnType<typeof useDialog>, ctx: ReturnType<typeof useTheme>) => {
  const saved = ctx.name
  const mode = ctx.mode
  let confirmed = false
  dialog.replace(
    <ThemePickerDialog onConfirm={() => { confirmed = true }} />,
    () => {
      if (confirmed) return
      ctx.set(saved)
      ctx.setMode(mode)
    }
  )
}
