// Live-preview an in-progress eikon in the sidebar avatar slot while the
// user (or the hermes `eikon` skill) iterates on source images. No eikon
// repo dependency: rasterization is chafa → 48×24 braille → a synthetic
// ParsedEikon fanned to all six states.
//
// Activation bridges (both land in the same place):
//   - `~/.hermes/herm/eikon-wip.eikon` — stat-checked after every
//     tool.complete / message.complete gateway event. The skill writes
//     this file; we re-read on mtime change. Platform-invariant (no
//     fs.watch).
//   - Palette: "Eikon: preview image…" / "clear" / "bake".
//
// Off by default; the skill (or the user) flips it on.

import { spawnSync } from "node:child_process"
import { statSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { AnimatedAvatar } from "../../components/avatar/AnimatedAvatar"
import { parseEikon, type ParsedEikon, type EikonState } from "../../components/avatar/eikon"
import type { AvatarState } from "../../components/avatar/states"
import { chafaBin, resolveImage } from "../../utils/chafa"
import { hermesPath } from "../../service/hermes-home"
import * as prefs from "../../context/preferences"
import type { HermPlugin, HermPluginApi } from "../types"

const W = 48
const H = 24
const STATES: AvatarState[] = ["idle", "listening", "thinking", "speaking", "working", "error"]

export const WIP_PATH = () => hermesPath("herm/eikon-wip.eikon")

type Knobs = { invert: boolean; symbols: "braille" | "block" | "ascii" }
const K0: Knobs = { invert: true, symbols: "braille" }

/** chafa one image → H newline-joined rows, W cols each (padded). */
function raster(path: string, k: Knobs): string[] {
  const bin = chafaBin()
  if (!bin) throw new Error("chafa not found on PATH")
  const full = resolveImage(path)
  if (!full) throw new Error(`not found: ${path}`)
  const r = spawnSync(bin, [
    `--size=${W}x${H}`, "--format=symbols", "--stretch",
    `--symbols=${k.symbols}`, "--colors=none", "--dither=none",
    ...(k.invert ? ["--invert"] : []), full,
  ], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`chafa: ${r.stderr.trim() || "failed"}`)
  const rows = r.stdout.replace(/\n$/, "").split("\n")
  while (rows.length < H) rows.push("")
  return rows.slice(0, H).map(l => l.padEnd(W).slice(0, W))
}

/** Build a ParsedEikon whose every state points at the same 1-frame clip. */
function one(name: string, lines: string[]): ParsedEikon {
  const clip: EikonState = { fps: 12, frames: [lines], loopFrom: 1 }
  return {
    meta: { version: 1, name, width: W, height: H, states: [...STATES] },
    states: new Map(STATES.map(s => [s, clip])),
  }
}

/** Serialize a ParsedEikon back to .eikon NDJSON (single-frame states only). */
function write(e: ParsedEikon, author: string, glyph: string): string {
  const out: string[] = [JSON.stringify({ eikon: 1, name: e.meta.name, width: W, height: H, author, glyph, created: new Date().toISOString() })]
  for (const s of STATES) {
    const c = e.states.get(s)!
    out.push(JSON.stringify({ state: s, fps: c.fps, frame_count: c.frames.length, loop_from: c.loopFrom }))
    c.frames.forEach((f, i) => out.push(JSON.stringify({ f: i, data: f.join("\n") })))
  }
  return out.join("\n") + "\n"
}

function Badge(props: { api: HermPluginApi; name: string }) {
  const t = props.api.theme.current
  return (
    <box position="absolute" right={0} bottom={0} height={1} paddingX={1} backgroundColor={t.backgroundElement}>
      <text fg={t.accent}>{`◌ wip · ${props.name}`}</text>
    </box>
  )
}

const plugin: HermPlugin = {
  id: "herm.eikon-studio",
  enabled: false,

  tui(api) {
    let wip: ParsedEikon | undefined
    let knobs: Knobs = { ...K0 }
    let src: string | undefined          // last rasterized image path
    let mtime = 0
    let unslot: (() => void) | undefined

    const mount = () => {
      unslot?.()
      if (!wip) { unslot = undefined; return }
      const doc = wip
      unslot = api.slots.register({
        order: 0,
        slots: {
          sidebar_avatar: (_, p) => (
            <box position="relative" flexDirection="column" height={H} overflow="hidden">
              <AnimatedAvatar state={p.state} eikon={doc} />
              <Badge api={api} name={doc.meta.name} />
            </box>
          ),
        },
      })
    }

    const show = (doc: ParsedEikon | undefined) => { wip = doc; mount() }

    const fromImage = (path: string) => {
      src = path
      const lines = raster(path, knobs)
      show(one(path.replace(/^.*\//, "").replace(/\.[^.]+$/, "").toLowerCase(), lines))
    }

    const fromWipFile = () => {
      const p = WIP_PATH()
      const st = statSync(p, { throwIfNoEntry: false })
      if (!st) { if (wip) show(undefined); mtime = 0; return }
      if (st.mtimeMs === mtime) return
      mtime = st.mtimeMs
      Bun.file(p).text()
        .then(t => show(parseEikon(t)))
        .catch(e => api.ui.toast({ variant: "error", message: `eikon-wip: ${e}` }))
    }

    // Event-driven pickup (option C): stat after any tool/turn boundary.
    api.event.on(ev => {
      if (ev.type === "tool.complete" || ev.type === "message.complete") fromWipFile()
    })
    // And once on activate, so a pre-existing file shows immediately.
    fromWipFile()

    api.command.register([
      { title: "Eikon: preview image…", value: "eikon.studio.image", category: "Eikon",
        onSelect: async () => {
          const p = await api.ui.prompt({ title: "Preview image", label: "path (png/jpg/webp/gif)" })
          if (!p) return
          try { fromImage(p) }
          catch (e) { api.ui.toast({ variant: "error", message: String((e as Error).message ?? e) }) }
        } },
      { title: "Eikon: toggle invert", value: "eikon.studio.invert", category: "Eikon",
        onSelect: () => {
          knobs = { ...knobs, invert: !knobs.invert }
          if (src) try { fromImage(src) } catch {}
          api.ui.toast({ message: `invert: ${knobs.invert ? "on" : "off"}` })
        } },
      { title: "Eikon: clear preview", value: "eikon.studio.clear", category: "Eikon",
        onSelect: () => { show(undefined); rmSync(WIP_PATH(), { force: true }); mtime = 0 } },
      { title: "Eikon: bake & install", value: "eikon.studio.bake", category: "Eikon",
        onSelect: async () => {
          if (!wip) return api.ui.toast({ message: "Nothing to bake — preview an image first" })
          const name = await api.ui.prompt({ title: "Eikon name", initial: wip.meta.name })
          if (!name) return
          const glyph = await api.ui.prompt({ title: "Glyph (1 char)", initial: "◆" }) ?? "◆"
          wip.meta.name = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
          const body = write(wip, process.env.USER ?? "unknown", glyph.slice(0, 2))
          const dir = hermesPath("eikons")
          mkdirSync(dir, { recursive: true })
          const dst = join(dir, `${wip.meta.name}.eikon`)
          await Bun.write(dst, body)
          prefs.set("eikonPath", dst)
          api.kv.set("last", dst)
          show(undefined); rmSync(WIP_PATH(), { force: true }); mtime = 0
          api.ui.toast({ variant: "success", message: `Installed ${wip.meta.name} → sidebar` })
        } },
    ])

    api.lifecycle.onDispose(() => { unslot?.(); unslot = undefined })
  },
}

export default plugin
// Re-exported for tests / control endpoint.
export const studio = { one, raster, write }
