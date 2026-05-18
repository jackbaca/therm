// Assembles the shared `HermPluginApi` from collected context values.
// Everything live (theme, keys, gateway) reads through a ref so the api
// object identity is stable while its getters track the latest React
// state. The per-plugin wrapper in runtime.tsx adds scope-tracked
// versions of `slots`/`route`/`event`/`command`/`kv`/`lifecycle`.

import type { MutableRefObject } from "react"
import type { CliRenderer } from "@opentui/core"
import type { Gateway } from "../context/gateway"
import type { GatewayEvent } from "../context/wire"
import type { DialogContext } from "../ui/dialog"
import type { Keys } from "../keys"
import { DialogSelect, type SelectOption } from "../ui/dialog-select"
import { openConfirm } from "../dialogs/confirm"
import { openTextPrompt } from "../dialogs/text-prompt"
import { openAlert } from "../dialogs/alert"
import { TAB_SLASH, TABS } from "../app/tabs"
import * as prefs from "../context/preferences"
import * as eikon from "../service/eikon"
import type { HermPluginApi, RouteDef } from "./types"

type ThemeSnap = {
  theme: import("../theme").Theme
  name: string
  mode: "dark" | "light"
  set: (name: string) => boolean
  has: (name: string) => boolean
}

export type ApiInput = {
  renderer: CliRenderer
  theme: MutableRefObject<ThemeSnap>
  keys: MutableRefObject<Keys>
  dialog: DialogContext
  toast: { show: (opts: { variant: "info" | "error" | "warning" | "success"; title?: string; message: string }) => void }
  gw: MutableRefObject<Gateway>
  cmd: { register: (cmds: ReadonlyArray<{ title: string; value: string; description?: string; category?: string; onSelect: () => void }>) => () => void }
  routes: Map<string, RouteDef>
  bump: () => void
  nav: MutableRefObject<((tab: number, sub: number) => void) | null>
  cur: MutableRefObject<(() => string | undefined) | null>
}

function select(dialog: DialogContext, opts: { title: string; options: ReadonlyArray<SelectOption>; placeholder?: string }) {
  return new Promise<SelectOption | null>(res => {
    let settled = false
    const done = (v: SelectOption | null) => { if (settled) return; settled = true; res(v); dialog.clear() }
    dialog.replace(
      <DialogSelect title={opts.title} options={opts.options} placeholder={opts.placeholder}
                    onSelect={o => done(o)} />,
      () => done(null),
    )
  })
}

/** Resolve a route name to a {tab, sub} pair using the built-in slash
 *  table first, then the plugin route registry (which appends after
 *  the four built-in tabs in registration order). */
function locate(routes: Map<string, RouteDef>, name: string) {
  const lower = name.toLowerCase()
  const hit = TAB_SLASH[lower]
  if (hit) return hit
  const names = [...routes.keys()]
  const i = names.findIndex(n => n.toLowerCase() === lower)
  if (i < 0) return undefined
  return { tab: TABS.length + i, sub: 0 }
}

export function createApi(input: ApiInput): HermPluginApi {
  return {
    renderer: input.renderer,
    theme: {
      get current() { return input.theme.current.theme },
      get name() { return input.theme.current.name },
      get mode() { return input.theme.current.mode },
      set: name => input.theme.current.set(name),
      has: name => input.theme.current.has(name),
    },
    get keys() { return input.keys.current },
    ui: {
      dialog: input.dialog,
      toast: o => input.toast.show({ variant: o.variant ?? "info", title: o.title, message: o.message }),
      confirm: o => openConfirm(input.dialog, o),
      prompt: o => openTextPrompt(input.dialog, o),
      alert: (title, body) => openAlert(input.dialog, title, body),
      select: o => select(input.dialog, o),
    },
    kv: {
      // Base kv is un-namespaced; the per-plugin wrapper prefixes `id`.
      get: (key, fallback) => {
        const bag = prefs.get("plugin") as Record<string, unknown> | undefined
        return (bag?.[key] as typeof fallback | undefined) ?? fallback
      },
      set: (key, value) => {
        const bag = (prefs.get("plugin") as Record<string, unknown> | undefined) ?? {}
        prefs.set("plugin", { ...bag, [key]: value })
      },
    },
    get client() { return input.gw.current },
    event: {
      on: fn => {
        const c = input.gw.current
        const h = (ev: GatewayEvent) => fn(ev)
        c.on("event", h)
        return () => c.off("event", h)
      },
    },
    route: {
      register: defs => {
        for (const d of defs) input.routes.set(d.name, d)
        input.bump()
        return () => {
          for (const d of defs) input.routes.delete(d.name)
          input.bump()
        }
      },
      navigate: (name, sub) => {
        const at = locate(input.routes, name)
        if (!at) return
        input.nav.current?.(at.tab, sub ?? at.sub)
      },
      get current() { return input.cur.current?.() },
    },
    command: {
      register: cmds => input.cmd.register(cmds),
    },
    // Real slots.register is supplied per-plugin (so the contribution
    // carries the plugin's id). The base throws to surface misuse.
    slots: {
      register() { throw new Error("slots.register is only available inside a plugin's tui() factory") },
    },
    eikon: {
      rasterizer: { register: r => eikon.register(r) },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose: () => () => {},
    },
  }
}
