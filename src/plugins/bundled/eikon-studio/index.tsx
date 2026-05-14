// eikon-studio plugin — sidebar avatar preview + full-width editor tab.
//
// Surfaces:
//   - sidebar_avatar slot (replace): whenever a WIP doc exists, the live
//     eikon is supplanted by the preview. Present in watching and editing.
//   - "Eikon" route: the knob editor. Owns keyboard only while focused.
//
// Store.ts holds the single Snap both subtrees read via useSyncExternalStore,
// so the slot and the tab stay in sync without re-registering the slot on
// every knob tick.
//
// Bridge: ~/.hermes/herm/eikon-wip.eikon is stat-checked on every
// tool.complete / message.complete gateway event. A `studio:{src,...}`
// header in that file enters editing and navigates to the tab.

import { statSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { AnimatedAvatar } from "../../../components/avatar/AnimatedAvatar"
import { parseEikon, type ParsedEikon, type EikonState } from "../../../components/avatar/eikon"
import { hermesPath } from "../../../service/hermes-home"
import * as prefs from "../../../context/preferences"
import type { HermPlugin, HermPluginApi } from "../../types"
import { render, probe, caps, K0, W, H, reset as resetCache, type Knobs } from "./render"
import { STATES, fresh, eff, type Session } from "./knobs"
import { Tab } from "./Tab"
import * as store from "./store"
import * as layout from "./layout"

export const WIP_PATH = () => hermesPath("herm/eikon-wip.eikon")

/** Render each distinct knob-set once; fan to all six states. */
function build(s: Session): { doc: ParsedEikon; err?: string } {
  const seen = new Map<string, string[]>()
  const states = new Map<string, EikonState>()
  for (const st of STATES) {
    const k = eff(s, st)
    const key = JSON.stringify(k)
    let lines = seen.get(key)
    if (!lines) {
      const r = render(s.src, k)
      if ("err" in r) return { doc: blank(s), err: r.err }
      lines = r.lines
      seen.set(key, lines)
    }
    states.set(st, { fps: 12, frames: [lines], loopFrom: 1 })
  }
  return {
    doc: {
      meta: { version: 1, name: s.name, width: W, height: H, states: [...STATES],
              studio: { src: s.src, base: s.base, per: s.per, name: s.name, glyph: s.glyph } },
      states,
    },
  }
}

const blank = (s: Session): ParsedEikon => ({
  meta: { version: 1, name: s.name, width: W, height: H, states: [...STATES] },
  states: new Map(STATES.map(x => [x, { fps: 12, frames: [[""]], loopFrom: 1 }])),
})

function serialize(e: ParsedEikon, author: string, glyph: string, keep = true): string {
  const out: string[] = [JSON.stringify({
    eikon: 1, name: e.meta.name, width: W, height: H, author, glyph,
    created: new Date().toISOString(),
    ...(keep && e.meta.studio ? { studio: e.meta.studio } : {}),
  })]
  for (const s of STATES) {
    const c = e.states.get(s)!
    out.push(JSON.stringify({ state: s, fps: c.fps, frame_count: c.frames.length, loop_from: c.loopFrom }))
    c.frames.forEach((f, i) => out.push(JSON.stringify({ f: i, data: f.join("\n") })))
  }
  return out.join("\n") + "\n"
}

function Badge(props: { api: HermPluginApi; name: string; editing: boolean }) {
  const t = props.api.theme.current
  return (
    <box position="absolute" right={0} bottom={0} height={1} paddingX={1} backgroundColor={t.backgroundElement}>
      <text fg={t.accent}>{`${props.editing ? "◉" : "◌"} wip · ${props.name}`}</text>
    </box>
  )
}

function AvatarSlot(props: { api: HermPluginApi; hostState: import("../../../components/avatar/states").AvatarState }) {
  const snap = store.useStore()
  if (!snap.doc) return null  // shouldn't mount without a doc, but defensive
  return (
    <box position="relative" flexDirection="column" height={H} overflow="hidden">
      <AnimatedAvatar state={snap.sess?.state ?? props.hostState} eikon={snap.doc} />
      <Badge api={props.api} name={snap.doc.meta.name} editing={snap.mode === "editing"} />
    </box>
  )
}

const plugin: HermPlugin = {
  id: "herm.eikon-studio",
  enabled: false,

  tui(api) {
    let mtime = 0
    let dropSlot: (() => void) | undefined

    // Avatar slot follows store.doc — register once, unregister when empty.
    const sync = () => {
      const has = !!store.get().doc
      if (has && !dropSlot) dropSlot = api.slots.register({
        order: 0,
        slots: { sidebar_avatar: (_, p) => <AvatarSlot api={api} hostState={p.state} /> },
      })
      if (!has && dropSlot) { dropSlot(); dropSlot = undefined }
    }
    const unsub = store.sub(sync)

    const rebuild = (s: Session) => {
      const { doc, err } = build(s)
      if (err) api.ui.toast({ variant: "error", message: err })
      store.set({ mode: "editing", sess: s, doc: err ? store.get().doc : doc })
    }

    const open = (path: string) => {
      resetCache()
      const sess = fresh(path, probe(path))
      rebuild(sess)
      api.route.navigate("Eikon")
    }

    // Reopen an installed eikon for editing: resolve its source/ image,
    // or fall back on studio.src from the header if source/ is empty.
    const reopen = (name: string) => {
      const src = layout.findSource(name)
      if (src) return open(src)
      const f = layout.file(name)
      if (!existsSync(f)) return api.ui.toast({ variant: "error", message: `${name}: not installed` })
      Bun.file(f).text().then(t => {
        const doc = parseEikon(t)
        const meta = doc.meta.studio as { src?: string } | undefined
        if (meta?.src && existsSync(meta.src)) return open(meta.src)
        // No source → watching-only; knobs can't re-rasterize.
        store.set({ mode: "watching", doc })
        api.route.navigate("Eikon")
        api.ui.toast({ variant: "info", message: `${name}: no source/ image — preview only` })
      })
    }

    const onSess = (fn: (s: Session) => Session) => {
      const cur = store.get().sess
      if (!cur) return
      rebuild(fn(cur))
    }

    const commit = async () => {
      const snap = store.get()
      if (!snap.doc) return
      mkdirSync(hermesPath("herm"), { recursive: true })
      await Bun.write(WIP_PATH(), serialize(snap.doc, process.env.USER ?? "unknown", snap.sess?.glyph ?? "◆"))
      mtime = statSync(WIP_PATH()).mtimeMs
      store.set({ mode: "watching", doc: snap.doc })
      api.ui.toast({ message: "Committed to WIP" })
    }

    const bake = async () => {
      const snap = store.get()
      if (!snap.doc || !snap.sess) return
      const s = snap.sess
      const paths = layout.ensure(s.name)
      // Preserve the source so this eikon can be reopened without the
      // user re-supplying the image. Written as `base.<ext>`.
      const src = layout.adopt(s.name, s.src, "base")
      const body = serialize(
        { ...snap.doc, meta: { ...snap.doc.meta, name: s.name, studio: { ...snap.doc.meta.studio as object, src } } },
        process.env.USER ?? "unknown", s.glyph, true,
      )
      await Bun.write(paths.file, body)
      prefs.set("eikonPath", paths.file)
      api.kv.set("last", paths.file)
      rmSync(WIP_PATH(), { force: true }); mtime = 0
      store.set({ mode: "off" })
      api.ui.toast({ variant: "success", message: `Installed ${s.name} → sidebar` })
      api.route.navigate("chat")
    }

    const discard = () => {
      rmSync(WIP_PATH(), { force: true }); mtime = 0
      store.set({ mode: "off" })
    }

    const fromWipFile = () => {
      if (store.get().mode === "editing") return
      const p = WIP_PATH()
      const st = statSync(p, { throwIfNoEntry: false })
      if (!st) { if (store.get().doc) store.set({ mode: "off" }); mtime = 0; return }
      if (st.mtimeMs === mtime) return
      mtime = st.mtimeMs
      Bun.file(p).text()
        .then(t => {
          const doc = parseEikon(t)
          const meta = doc.meta.studio as Partial<Session> & { src?: string } | undefined
          if (meta?.src && caps.chafa) {
            const s: Session = {
              src: meta.src, dims: probe(meta.src),
              base: meta.base ?? { ...K0 }, per: meta.per ?? {},
              state: "idle", name: meta.name ?? doc.meta.name, glyph: meta.glyph ?? "◆",
            }
            rebuild(s)
            api.route.navigate("Eikon")
            return
          }
          store.set({ mode: "watching", doc })
        })
        .catch(e => api.ui.toast({ variant: "error", message: `eikon-wip: ${e}` }))
    }

    api.event.on(ev => {
      if (ev.type === "tool.complete" || ev.type === "message.complete") fromWipFile()
    })
    fromWipFile()

    api.route.register([{
      name: "Eikon",
      description: "Eikon studio",
      render: () => <Tab api={api} onOpen={open} onSess={onSess} onCommit={() => void commit()} onBake={() => void bake()} onDiscard={discard} />,
    }])

    api.command.register([
      { title: "Eikon: open studio…", value: "eikon.studio.open", category: "Eikon",
        onSelect: async () => {
          const p = await api.ui.prompt({ title: "Source image", label: "path (png/jpg/webp/gif)" })
          if (p) open(p)
        } },
      { title: "Eikon: edit installed…", value: "eikon.studio.edit", category: "Eikon",
        onSelect: async () => {
          const xs = layout.list()
          if (xs.length === 0) return api.ui.toast({ message: "No installed eikons" })
          const pick = await api.ui.select({
            title: "Edit eikon",
            options: xs.map(x => ({ title: x.name, value: x.name, hint: x.hasSource ? undefined : "no source" })),
          })
          if (pick) reopen(pick.value)
        } },
      { title: "Eikon: go to tab", value: "eikon.studio.tab", category: "Eikon",
        onSelect: () => api.route.navigate("Eikon") },
      { title: "Eikon: clear preview", value: "eikon.studio.clear", category: "Eikon",
        onSelect: discard },
    ])

    api.lifecycle.onDispose(() => { unsub(); dropSlot?.(); store.set({ mode: "off" }) })
  },
}

export default plugin
export const studio = { build, serialize }
