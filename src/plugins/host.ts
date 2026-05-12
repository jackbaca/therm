// Plugin host — MVP.
//
// One extension point: the bottom gutter. A plugin that wants to appear
// there implements `gutter(props) => ReactNode`. Returning null skips it
// for this tick; the shell picks the first plugin that returns non-null.
//
// Registration is side-effectful at import time. Keep it that way — the
// loader in ./index.ts imports each bundled plugin for its side effect,
// which is simpler than shipping a manifest for MVP.
//
// Out of scope here: filesystem discovery, config, lifecycle hooks,
// error sandboxing, multi-slot layouts. Land those in follow-ups.

import type { ReactNode } from "react"
import type { Theme } from "../theme"

export type GutterProps = {
  theme: Theme
  sid: string
  tab: number
  streaming: boolean
}

export type TabDef = {
  name: string
  component: () => ReactNode
}

export type Plugin = {
  id: string
  name: string
  gutter?: (p: GutterProps) => ReactNode
  tab?: TabDef
}

const reg: Plugin[] = []

export const register = (p: Plugin) => {
  if (reg.some(x => x.id === p.id)) return
  reg.push(p)
}

export const list = (): readonly Plugin[] => reg

export const tabs = (): readonly { id: string; tab: TabDef }[] =>
  reg.flatMap(p => p.tab ? [{ id: p.id, tab: p.tab }] : [])

// Test-only — resets the registry between bun test cases.
export const _reset = () => { reg.length = 0 }
