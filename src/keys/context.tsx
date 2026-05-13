// KeysProvider — resolves the action catalog (DEFAULTS ← user overrides),
// owns leader-armed state, and exposes match()/print()/chord()/all.
//
// Leader flow: the provider's own useKeyboard sees the leader chord first
// (global listeners fire before renderable handlers). It arms, blurs the
// focused renderable so the follow-up bare letter isn't eaten by a textarea
// or tab handler, and starts a 2s window. The next keypress is evaluated
// with leader=true by callers' match(); on any keypress while armed the
// provider disarms in a microtask (after other useKeyboard subscribers on
// the same event have read `leader`) and restores focus.

import { createContext, useMemo, useRef, useCallback, useState, type ReactNode } from "react"
import { makeUse } from "../context/helper"
import { useKeyboard, useRenderer } from "@opentui/react"
import type { ParsedKey, Renderable } from "@opentui/core"
import { usePref } from "../context/preferences"
import { DEFAULTS, type ActionId, type Scope } from "./catalog"
import { parse, match as chordMatch, print as chordPrint, type Chord } from "./chord"

const LEADER_MS = 2000

export type Entry = { id: ActionId; desc: string; scope: Scope; chord: ReadonlyArray<Chord> }

export type Keys = {
  /** True while the leader prefix is armed (between Ctrl+X and the next key). */
  readonly leader: boolean
  /** Does `key` match the action's resolved chord? Uses current leader state. */
  match(id: ActionId, key: ParsedKey): boolean
  /** Display string for an action's first chord, with <leader> substituted. */
  print(id: ActionId): string
  /** Resolved Chord[] for an action. */
  chord(id: ActionId): ReadonlyArray<Chord>
  /** All actions in a scope, resolved. */
  all(scope: Scope): ReadonlyArray<Entry>
  /** Full resolved id→Chord[] table (for conflict detection / rebind UI). */
  readonly table: ReadonlyMap<ActionId, ReadonlyArray<Chord>>
}

const Ctx = createContext<Keys | null>(null)

const NO_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({})

export const KeysProvider = ({ children }: { children: ReactNode }) => {
  const renderer = useRenderer()
  const overrides = usePref("keys") ?? NO_OVERRIDES

  // id → Chord[] computed once per overrides identity. Leader's own chord
  // is looked up from the same table so it's rebindable.
  const table = useMemo(() => {
    const t = new Map<ActionId, Chord[]>()
    for (const id of Object.keys(DEFAULTS) as ActionId[])
      t.set(id, parse(overrides[id] ?? DEFAULTS[id].chord))
    return t
  }, [overrides])

  const lead = table.get("leader")!
  const leadLabel = chordPrint(lead)

  // Leader arm state. `armed` is a ref so match() reads the value at
  // key-time without the provider re-rendering every consumer on arm.
  const armed = useRef(false)
  const stolen = useRef<Renderable | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, bump] = useState(0)

  const disarm = useCallback(() => {
    if (!armed.current) return
    armed.current = false
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const f = stolen.current
    stolen.current = null
    if (f && !f.isDestroyed && !renderer.currentFocusedRenderable) f.focus()
    bump(n => n + 1)
  }, [renderer])

  const arm = useCallback(() => {
    armed.current = true
    stolen.current = renderer.currentFocusedRenderable ?? null
    stolen.current?.blur()
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(disarm, LEADER_MS)
    bump(n => n + 1)
  }, [renderer, disarm])

  useKeyboard((key) => {
    if (!armed.current && chordMatch(lead, key)) {
      arm()
      key.stopPropagation()
      return
    }
    if (armed.current) queueMicrotask(disarm)
  })

  const value = useMemo<Keys>(() => ({
    get leader() { return armed.current },
    match: (id, key) => chordMatch(table.get(id) ?? [], key, armed.current),
    print: (id) => chordPrint(table.get(id) ?? [], leadLabel),
    chord: (id) => table.get(id) ?? [],
    all: (scope) =>
      (Object.keys(DEFAULTS) as ActionId[])
        .filter(id => DEFAULTS[id].scope === scope)
        .map(id => ({ id, desc: DEFAULTS[id].desc, scope, chord: table.get(id) ?? [] })),
    table,
  }), [table, leadLabel])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useKeys = makeUse(Ctx, "useKeys")
