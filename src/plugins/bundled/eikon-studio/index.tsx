// eikon-studio plugin — live sidebar preview + knob editor.
//
// States:
//   watching  — plugin active, no editor session. The avatar slot shows
//               whatever's in ~/.hermes/herm/eikon-wip.eikon (stat on
//               tool.complete / message.complete). sidebar_content untouched.
//   editing   — both slots occupied. Keyboard captured (see `grab`).
//               Arrow/hjkl drive knobs; every change re-rasterizes via
//               render.ts and repaints the avatar slot.
//
// Entry: palette "Eikon: open studio…" or a WIP file whose header carries
// `studio:{src,base,per}` (skill-written). Exit: Esc discard, Enter commit
// to WIP file (→ watching), `b` bake to ~/.hermes/eikons/.

import { useState, useEffect } from "react"
import { useKeyboard } from "@opentui/react"
import { statSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { AnimatedAvatar } from "../../../components/avatar/AnimatedAvatar"
import { parseEikon, type ParsedEikon, type EikonState } from "../../../components/avatar/eikon"
import type { AvatarState } from "../../../components/avatar/states"
import { hermesPath } from "../../../service/hermes-home"
import * as prefs from "../../../context/preferences"
import type { HermPlugin, HermPluginApi } from "../../types"
import { render, probe, caps, K0, W, H, type Knobs } from "./render"
import { Panel } from "./Panel"
import { STATES, ROWS, type Row, type Session, fresh, eff, edit, step, pan, cycle, fork, reset as resetK } from "./knobs"

export const WIP_PATH = () => hermesPath("herm/eikon-wip.eikon")

type Snap = { doc: ParsedEikon; sess?: Session; row: Row }

/** Turn a session into a ParsedEikon by rendering each distinct knob-set once. */
function build(s: Session): { doc: ParsedEikon; err?: string } {
  const cache = new Map<string, string[]>()
  const states = new Map<string, EikonState>()
  for (const st of STATES) {
    const k = eff(s, st)
    const key = JSON.stringify(k)
    let lines = cache.get(key)
    if (!lines) {
      const r = render(s.src, k)
      if ("err" in r) return { doc: empty(s.src), err: r.err }
      lines = r.lines
      cache.set(key, lines)
    }
    states.set(st, { fps: 12, frames: [lines], loopFrom: 1 })
  }
  return {
    doc: {
      meta: { version: 1, name: nameOf(s.src), width: W, height: H, states: [...STATES], studio: { src: s.src, base: s.base, per: s.per } },
      states,
    },
  }
}

const nameOf = (p: string) =>
  p.replace(/^.*\//, "").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "wip"

const empty = (src: string): ParsedEikon => ({
  meta: { version: 1, name: nameOf(src), width: W, height: H, states: [...STATES] },
  states: new Map(STATES.map(s => [s, { fps: 12, frames: [[""]], loopFrom: 1 }])),
})

function serialize(e: ParsedEikon, author: string, glyph: string): string {
  const out: string[] = [JSON.stringify({ eikon: 1, name: e.meta.name, width: W, height: H, author, glyph, created: new Date().toISOString(), ...(e.meta.studio ? { studio: e.meta.studio } : {}) })]
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

// Keyboard capture lives in its own renderable so it mounts/unmounts with
// the panel slot — `useKeyboard` inside a component is the only sanctioned
// way to grab keys in the plugin API.
function Keys(props: { on: (name: string, shift: boolean) => void }) {
  useKeyboard(k => props.on(k.name ?? "", !!k.shift))
  return null
}

const plugin: HermPlugin = {
  id: "herm.eikon-studio",
  enabled: false,

  tui(api) {
    let snap: Snap | undefined
    let dropAvatar: (() => void) | undefined
    let dropPanel: (() => void) | undefined
    let mtime = 0
    let debounce: ReturnType<typeof setTimeout> | null = null

    const mount = () => {
      dropAvatar?.(); dropPanel?.()
      dropAvatar = dropPanel = undefined
      if (!snap) return
      const cur = snap
      dropAvatar = api.slots.register({
        order: 0,
        slots: {
          sidebar_avatar: (_, p) => (
            <box position="relative" flexDirection="column" height={H} overflow="hidden">
              <AnimatedAvatar state={cur.sess?.state ?? p.state} eikon={cur.doc} />
              <Badge api={api} name={cur.doc.meta.name} editing={!!cur.sess} />
            </box>
          ),
        },
      })
      if (!cur.sess) return
      dropPanel = api.slots.register({
        order: 0,
        slots: {
          sidebar_content: () => (
            <box flexDirection="column" flexGrow={1}>
              <Keys on={key} />
              <Panel api={api} sess={cur.sess!} row={cur.row} />
            </box>
          ),
        },
      })
    }

    const show = (doc: ParsedEikon | undefined, sess?: Session) => {
      snap = doc ? { doc, sess, row: snap?.row ?? "symbols" } : undefined
      mount()
    }

    const rerender = () => {
      if (!snap?.sess) return
      const { doc, err } = build(snap.sess)
      if (err) { api.ui.toast({ variant: "error", message: err }); return }
      snap = { ...snap, doc }
      mount()
    }

    const schedule = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => { debounce = null; rerender() }, 40)
    }

    const open = (src: string) => {
      const dims = probe(src)
      const sess = fresh(src, dims)
      const { doc, err } = build(sess)
      if (err) { api.ui.toast({ variant: "error", message: err }); return }
      snap = { doc, sess, row: "symbols" }
      mount()
    }

    const commit = async () => {
      if (!snap) return
      mkdirSync(hermesPath("herm"), { recursive: true })
      await Bun.write(WIP_PATH(), serialize(snap.doc, process.env.USER ?? "unknown", "◆"))
      mtime = statSync(WIP_PATH()).mtimeMs
      // Drop to watching (panel gone, avatar stays).
      snap = { doc: snap.doc, sess: undefined, row: snap.row }
      mount()
      api.ui.toast({ message: "Committed to WIP" })
    }

    const bake = async () => {
      if (!snap) return
      const name = await api.ui.prompt({ title: "Eikon name", initial: snap.doc.meta.name })
      if (!name) return
      const glyph = (await api.ui.prompt({ title: "Glyph (1 char, or blank → I pick)", initial: "" }))?.trim()
      snap.doc.meta.name = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
      delete snap.doc.meta.studio
      const body = serialize(snap.doc, process.env.USER ?? "unknown", (glyph || "◆").slice(0, 2))
      mkdirSync(hermesPath("eikons"), { recursive: true })
      const dst = join(hermesPath("eikons"), `${snap.doc.meta.name}.eikon`)
      await Bun.write(dst, body)
      prefs.set("eikonPath", dst)
      api.kv.set("last", dst)
      rmSync(WIP_PATH(), { force: true }); mtime = 0
      show(undefined)
      api.ui.toast({ variant: "success", message: `Installed ${name} → sidebar` })
    }

    // Keyboard router — only reachable while the panel is mounted.
    const key = (name: string, shift: boolean) => {
      if (!snap?.sess) return
      const s = snap.sess
      if (name === "escape") { show(undefined); rmSync(WIP_PATH(), { force: true }); mtime = 0; return }
      if (name === "return") { void commit(); return }
      if (name === "b") { void bake(); return }
      if (name === "r") { snap.sess = resetK(s); schedule(); mount(); return }
      if (name === "=") { snap.sess = fork(s); mount(); return }
      if (name === "tab") { snap.sess = cycle(s, shift ? -1 : 1); mount(); return }

      if (name === "j" || name === "k") {
        const i = ROWS.indexOf(snap.row)
        snap.row = ROWS[Math.max(0, Math.min(ROWS.length - 1, i + (name === "j" ? 1 : -1)))]!
        return mount()
      }

      const row = snap.row
      if (row === "state" && (name === "h" || name === "l" || name === "left" || name === "right")) {
        snap.sess = cycle(s, name === "h" || name === "left" ? -1 : 1); return mount()
      }
      if (row === "pan" && caps.ffmpeg) {
        const d: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], h: [-1, 0], l: [1, 0] }
        const v = d[name]; if (!v) return
        snap.sess = edit(s, k => pan(k, v[0], v[1], shift)); schedule(); return mount()
      }
      if ((name === "h" || name === "l" || name === "left" || name === "right")) {
        if ((row === "contrast" || row === "zoom") && !caps.ffmpeg) return
        const d = name === "h" || name === "left" ? -1 : 1
        snap.sess = edit(s, k => step(k, row, d)); schedule(); return mount()
      }
      if (name === "space" && row === "invert") {
        snap.sess = edit(s, k => step(k, "invert", 1)); schedule(); return mount()
      }
    }

    const fromWipFile = () => {
      if (snap?.sess) return  // editing wins over file-driven
      const p = WIP_PATH()
      const st = statSync(p, { throwIfNoEntry: false })
      if (!st) { if (snap) show(undefined); mtime = 0; return }
      if (st.mtimeMs === mtime) return
      mtime = st.mtimeMs
      Bun.file(p).text()
        .then(t => {
          const doc = parseEikon(t)
          const meta = doc.meta.studio as { src?: string; base?: Knobs; per?: Session["per"] } | undefined
          if (meta?.src && caps.chafa) {
            const sess: Session = { src: meta.src, dims: probe(meta.src), base: meta.base ?? { ...K0 }, per: meta.per ?? {}, state: "idle" }
            const b = build(sess)
            if (!b.err) { snap = { doc: b.doc, sess, row: "symbols" }; return mount() }
          }
          show(doc)
        })
        .catch(e => api.ui.toast({ variant: "error", message: `eikon-wip: ${e}` }))
    }

    api.event.on(ev => {
      if (ev.type === "tool.complete" || ev.type === "message.complete") fromWipFile()
    })
    fromWipFile()

    api.command.register([
      { title: "Eikon: open studio…", value: "eikon.studio.open", category: "Eikon",
        onSelect: async () => {
          const p = await api.ui.prompt({ title: "Source image", label: "path (png/jpg/webp/gif)" })
          if (p) open(p)
        } },
      { title: "Eikon: clear preview", value: "eikon.studio.clear", category: "Eikon",
        onSelect: () => { show(undefined); rmSync(WIP_PATH(), { force: true }); mtime = 0 } },
      { title: "Eikon: bake & install", value: "eikon.studio.bake", category: "Eikon",
        onSelect: () => void bake() },
    ])

    api.lifecycle.onDispose(() => {
      if (debounce) clearTimeout(debounce)
      dropAvatar?.(); dropPanel?.()
    })
  },
}

export default plugin
export const studio = { build, serialize, nameOf }
