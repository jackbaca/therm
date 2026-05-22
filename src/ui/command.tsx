/**
 * Command palette — registry of named commands, each optionally bound
 * to a catalog ActionId. The palette (palette.open) is just one way to
 * reach them; any command with an `action` also fires when that chord
 * is pressed, so the registry doubles as the dispatch table for global
 * actions that don't need useAppKeys' composer/renderer state.
 *
 *   const cmd = useCommand()
 *   useEffect(() => cmd.register([
 *     { title: "Help", value: "help", action: "help.open", onSelect: ... },
 *   ]), [])
 *
 * The registry is a pure ref — no setState on (un)register. `open()`
 * and `useKeyboard` read it lazily at press time, so nothing
 * downstream needs to re-render when callers add or drop commands.
 * Bumping state here caused an infinite commit loop when a caller's
 * register effect depended on a value that itself changed during the
 * commit (e.g. theme context mid-theme-picker navigation).
 */

import { createContext, useCallback, useRef, useMemo } from "react"
import { makeUse } from "../context/helper"
import type { ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
import { useKeys, type ActionId } from "../keys"
import { useDialog } from "./dialog"
import { DialogSelect, type SelectOption } from "./dialog-select"

type Command = {
  readonly title: string
  readonly value: string
  readonly action?: ActionId
  readonly description?: string
  readonly category?: string
  readonly onSelect: () => void
}

type CommandContext = {
  readonly register: (cmds: ReadonlyArray<Command>) => () => void
  readonly setEnabled: (val: boolean) => void
}

const Ctx = createContext<CommandContext | null>(null)

export const CommandProvider = ({ children }: { children: ReactNode }) => {
  const registry = useRef<Map<string, ReadonlyArray<Command>>>(new Map())
  const enabled = useRef(true)
  const dialog = useDialog()
  const keys = useKeys()

  const all = useCallback((): Command[] => {
    const out: Command[] = []
    registry.current.forEach(cmds => cmds.forEach(c => out.push(c)))
    return out
  }, [])

  const register = useCallback((cmds: ReadonlyArray<Command>) => {
    const id = String(Date.now()) + Math.random()
    registry.current.set(id, cmds)
    return () => { registry.current.delete(id) }
  }, [])

  const setEnabled = useCallback((val: boolean) => {
    enabled.current = val
  }, [])

  const open = useCallback(() => {
    const cmds = all()
    const options: SelectOption[] = cmds.map(c => ({
      title: c.title,
      value: c.value,
      description: c.description,
      hint: c.action ? keys.print(c.action) : undefined,
      category: c.category,
    }))
    dialog.replace(
      <DialogSelect
        title="Command Palette"
        options={options}
        onSelect={(opt) => {
          dialog.clear()
          const found = cmds.find(c => c.value === opt.value)
          if (found) found.onSelect()
        }}
        placeholder="Search commands..."
      />
    )
  }, [all, dialog, keys])

  useKeyboard((key) => {
    if (!enabled.current || dialog.open()) return
    if (keys.match("palette.open", key)) return open()
    for (const c of all()) {
      if (c.action && keys.match(c.action, key)) return c.onSelect()
    }
  })

  const value = useMemo<CommandContext>(() => ({ register, setEnabled }), [register, setEnabled])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useCommand = makeUse(Ctx, "useCommand")
