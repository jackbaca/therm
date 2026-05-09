/**
 * Dialog overlay system — modal stack with backdrop.
 *
 * Usage:
 *   <DialogProvider><App /></DialogProvider>
 *
 *   const dialog = useDialog()
 *   dialog.replace(<MyContent />, () => revert())
 *   dialog.clear()
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef } from "react"
import type { ReactNode } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { RGBA } from "@opentui/core"
import { useKeys } from "../keys"
import { useTheme } from "../theme"

type DialogEntry = {
  readonly element: ReactNode
  readonly onClose?: () => void
  /** When true, DialogProvider does NOT auto-close this entry on the
   *  cancel key — the dialog owns Esc itself (e.g. a multi-view form
   *  where Esc first backs out of a sub-picker). */
  readonly ownCancel?: boolean
}

export type DialogContext = {
  readonly replace: (element: ReactNode, onClose?: () => void, opts?: { ownCancel?: boolean }) => void
  readonly clear: () => void
  readonly stack: ReadonlyArray<DialogEntry>
  /** Scheduling-independent open probe. `stack.length > 0` is only
   *  reliable once React has committed the provider's setState; a
   *  keypress arriving between replace() and that commit would read
   *  stack=[] (stale closure in the tab's useKeyboard) and leak
   *  through. `open()` reads a ref set synchronously inside
   *  replace()/clear(), so key-guards are correct from the same
   *  microtask the dialog was requested in. */
  readonly open: () => boolean
}

const Ctx = createContext<DialogContext | null>(null)

const BACKDROP = RGBA.fromInts(0, 0, 0, 150)

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const [stack, setStack] = useState<DialogEntry[]>([])
  // Mirror of stack.length > 0, written synchronously from the
  // setters so callers observing through open() never see a gap.
  const gate = useRef(false)

  const replace = useCallback((element: ReactNode, onClose?: () => void, opts?: { ownCancel?: boolean }) => {
    gate.current = true
    setStack([{ element, onClose, ownCancel: opts?.ownCancel }])
  }, [])

  const clear = useCallback(() => {
    gate.current = false
    setStack(prev => {
      const top = prev[prev.length - 1]
      if (top?.onClose) top.onClose()
      return []
    })
  }, [])

  const open = useCallback(() => gate.current, [])

  const keys = useKeys()
  useKeyboard((key) => {
    if (stack.length === 0) return
    const top = stack[stack.length - 1]
    if (top?.ownCancel) return // dialog handles its own Esc
    if (keys.match("dialog.cancel", key)) clear()
  })

  const value = useMemo<DialogContext>(
    () => ({ replace, clear, stack, open }),
    [replace, clear, stack, open])
  const top = stack.length > 0 ? stack[stack.length - 1] : undefined

  return (
    <Ctx.Provider value={value}>
      {children}
      {top ? <Overlay entry={top} onClose={clear} /> : null}
    </Ctx.Provider>
  )
}

const Overlay = ({ entry, onClose }: { entry: DialogEntry; onClose: () => void }) => {
  const dims = useTerminalDimensions()
  const theme = useTheme().theme

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dims.width}
      height={dims.height}
      zIndex={100}
      backgroundColor={BACKDROP}
      justifyContent="center"
      alignItems="center"
      onMouseDown={onClose}
    >
      <box
        backgroundColor={theme.backgroundPanel}
        borderStyle="single"
        border={true}
        borderColor={theme.border}
        padding={1}
        flexDirection="column"
        onMouseDown={(e) => { e.stopPropagation() }}
      >
        {entry.element}
      </box>
    </box>
  )
}

export const useDialog = (): DialogContext => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useDialog() must be inside <DialogProvider>")
  return ctx
}
