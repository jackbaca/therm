import { createContext, useState, useCallback, useMemo, useRef } from "react"
import { makeUse } from "../context/helper"
import type { ReactNode } from "react"
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/react"
import { RGBA, type Renderable } from "@opentui/core"
import { useKeys } from "../keys"
import { useTheme } from "../theme"

type Entry = {
  readonly element: ReactNode
  readonly onClose?: () => void
  /** When true, the provider does not auto-close this entry on the
   *  cancel key — the dialog owns Esc itself (e.g. a multi-view form
   *  where Esc first backs out of a sub-picker). */
  readonly ownCancel?: boolean
}

export type DialogContext = {
  readonly replace: (element: ReactNode, onClose?: () => void, opts?: { ownCancel?: boolean }) => void
  readonly clear: () => void
  readonly stack: ReadonlyArray<Entry>
  /** Scheduling-independent open probe. `stack.length > 0` is only
   *  reliable once React has committed the provider's setState; a
   *  keypress arriving between replace() and that commit reads stack=[]
   *  (stale closure in the tab's useKeyboard) and leaks through.
   *  `open()` reads a ref set synchronously by replace()/clear(). */
  readonly open: () => boolean
}

const Ctx = createContext<DialogContext | null>(null)

const BACKDROP = RGBA.fromInts(0, 0, 0, 150)

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const renderer = useRenderer()
  const [stack, setStack] = useState<Entry[]>([])
  const gate = useRef(false)
  const prev = useRef<Renderable | null>(null)

  // Refocus whatever held focus before the first dialog opened. The
  // renderable may have been destroyed (tab switched underneath) or
  // detached from the tree, so walk from root to confirm it's still
  // reachable before calling focus(). setTimeout lets the closing
  // dialog's own <input focused> unmount first — focusing into a node
  // that's about to be removed is a no-op in OpenTUI but still bumps
  // currentFocusedRenderable, which would then go stale.
  const refocus = useCallback(() => {
    setTimeout(() => {
      if (gate.current) return
      const target = prev.current
      if (!target || target.isDestroyed) { prev.current = null; return }
      const reachable = (node: Renderable): boolean => {
        for (const c of node.getChildren()) {
          if (c === target || reachable(c)) return true
        }
        return false
      }
      if (reachable(renderer.root)) target.focus()
      prev.current = null
    }, 0)
  }, [renderer])

  const replace = useCallback((element: ReactNode, onClose?: () => void, opts?: { ownCancel?: boolean }) => {
    // Capture focus only on the first open of a chain; a dialog that
    // replaces another (or opens immediately after clear()) should
    // restore to the original composer/textarea, not to whatever the
    // intermediate dialog's <input> happened to focus.
    if (!gate.current && !prev.current) {
      prev.current = renderer.currentFocusedRenderable
      prev.current?.blur()
    }
    gate.current = true
    setStack(cur => {
      for (const e of cur) e.onClose?.()
      return [{ element, onClose, ownCancel: opts?.ownCancel }]
    })
  }, [renderer])

  const clear = useCallback(() => {
    gate.current = false
    setStack(cur => {
      for (const e of cur) e.onClose?.()
      return []
    })
    refocus()
  }, [refocus])

  const open = useCallback(() => gate.current, [])

  const keys = useKeys()
  useKeyboard((key) => {
    if (stack.length === 0) return
    // An active text selection owns Esc (clear highlight) before the
    // dialog does. Selection.key in useAppKeys handles the general
    // case; this guard covers dialogs whose own <input> grabbed focus.
    if (renderer.getSelection()?.getSelectedText()) return
    const top = stack[stack.length - 1]
    if (top?.ownCancel) return
    if (keys.match("dialog.cancel", key)) clear()
  })

  const value = useMemo<DialogContext>(
    () => ({ replace, clear, stack, open }),
    [replace, clear, stack, open])
  const top = stack[stack.length - 1]

  return (
    <Ctx.Provider value={value}>
      {children}
      {top ? <Overlay entry={top} onClose={clear} /> : null}
    </Ctx.Provider>
  )
}

const Overlay = ({ entry, onClose }: { entry: Entry; onClose: () => void }) => {
  const dims = useTerminalDimensions()
  const theme = useTheme().theme
  const renderer = useRenderer()
  // Dismiss only when both halves of the click land on the backdrop
  // with no selection in between. A mouseup alone (e.g. the tail of
  // the click that opened this dialog, or a drag-select that ended
  // over the scrim) must not close.
  const armed = useRef(false)

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
      onMouseDown={() => { armed.current = !renderer.getSelection() }}
      onMouseUp={() => {
        if (!armed.current) return
        armed.current = false
        onClose()
      }}
    >
      <box
        backgroundColor={theme.backgroundPanel}
        borderStyle="single"
        border={true}
        borderColor={theme.border}
        padding={1}
        flexDirection="column"
        onMouseDown={(e) => { e.stopPropagation() }}
        onMouseUp={(e) => { armed.current = false; e.stopPropagation() }}
      >
        {entry.element}
      </box>
    </box>
  )
}

export const useDialog = makeUse(Ctx, "useDialog")
