// ~/.hermes/eikons/ folder layout + Studio persistence + rasterizer
// registry. Each eikon lives in its own folder:
//
//   eikons/<name>/
//     <name>.eikon    packed NDJSON — shippable, no local paths
//     studio.json     workspace state (rasterizer, spatial, knobs, sources)
//     source/         base.<ext>, <state>.<ext>
//
// `save()` is the single write action (Ctrl+S): render all six states
// through the active rasterizer, write `.eikon` + `studio.json`, adopt
// any external source paths into `source/`, and bump the revision
// counter so the sidebar reloads even when `eikonPath` is unchanged.
//
// The rasterizer registry is a module-level Map. Built-ins self-insert
// at import; herm plugins register via `api.eikon.rasterizer.register`
// (scope-tracked — deactivate unregisters). Studio reads the registry
// live on every open of the rasterizer picker.

import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname, extname, basename } from "node:path"
import { hermesPath } from "./hermes-home"
import * as prefs from "../context/preferences"
import { parseEikon } from "../components/avatar/eikon"
import type { AvatarState } from "../components/avatar/states"
import { BUILTIN, cached, probe, W, H, type Rasterizer, type Frame } from "../utils/eikon-render"
import { STATES, eff, toStudio, type Session, type Studio } from "../utils/eikon-knobs"

const ROOT = () => hermesPath("eikons")

export const dir = (name: string) => join(ROOT(), name)
export const file = (name: string) => join(dir(name), `${name}.eikon`)
export const sourceDir = (name: string) => join(dir(name), "source")
export const studioFile = (name: string) => join(dir(name), "studio.json")

export function ensure(name: string) {
  mkdirSync(sourceDir(name), { recursive: true })
  return { dir: dir(name), file: file(name), source: sourceDir(name) }
}

export type Installed = {
  name: string; file: string; source: string
  hasSource: boolean; sourceUrl?: string
}

/** List folder-form eikons under ~/.hermes/eikons/. Flat legacy
 *  <name>.eikon at the root is still readable by listEikons() in
 *  components/avatar/eikon.ts but doesn't appear here (no studio). */
export function list(): Installed[] {
  const root = ROOT()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(root, e.name, `${e.name}.eikon`)))
    .map(e => {
      const src = join(root, e.name, "source")
      const has = existsSync(src) && readdirSync(src).length > 0
      const head = header(join(root, e.name, `${e.name}.eikon`))
      return {
        name: e.name, file: join(root, e.name, `${e.name}.eikon`),
        source: src, hasSource: has,
        sourceUrl: typeof head?.source_url === "string" ? head.source_url : undefined,
      }
    })
}

const IMG = /\.(png|jpe?g|webp|gif|bmp)$/i
const VID = /\.(mp4|webm|mov|mkv)$/i

/** Resolve the effective source path for a state: per-state file →
 *  base.* → idle.* → first image → first video. Returns absolute path. */
export function findSource(name: string, state?: AvatarState): string | undefined {
  const src = sourceDir(name)
  if (!existsSync(src)) return undefined
  const files = readdirSync(src).filter(f => IMG.test(f) || VID.test(f))
  if (files.length === 0) return undefined
  const by = (stem: string) => files.find(f => basename(f, extname(f)).toLowerCase() === stem)
  const pick = (state && by(state)) ?? by("base") ?? by("idle") ?? by(name)
    ?? files.find(f => IMG.test(f)) ?? files[0]!
  return join(src, pick)
}

/** Copy an external file into <name>/source/ as <role>.<ext>. No-op if
 *  already there. Returns the filename (not the full path) for storing
 *  in `studio.sources`. */
export function adopt(name: string, from: string, role: AvatarState | "base" = "base"): string {
  const fname = `${role}${extname(from).toLowerCase()}`
  const dst = join(ensure(name).source, fname)
  if (from !== dst) copyFileSync(from, dst)
  return fname
}

export function readStudio(name: string): Studio | undefined {
  const p = studioFile(name)
  if (!existsSync(p)) return undefined
  const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<Studio>
  // Minimal shape-check; absent fields fall back at fresh() time.
  if (!raw || typeof raw !== "object") return undefined
  return raw as Studio
}

export function writeStudio(name: string, s: Studio) {
  ensure(name)
  writeFileSync(studioFile(name), JSON.stringify(s, null, 2) + "\n", "utf8")
}

/** Read just the NDJSON header (line 1). */
export function header(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  const first = readFileSync(path, "utf8").split("\n", 1)[0]
  if (!first) return undefined
  try { return JSON.parse(first) as Record<string, unknown> } catch { return undefined }
}

// ── Rasterizer registry ──────────────────────────────────────────────

const registry = new Map<string, Rasterizer>(BUILTIN.map(r => [r.name, r]))
const subs = new Set<() => void>()

export function register(r: Rasterizer): () => void {
  registry.set(r.name, r)
  for (const f of subs) f()
  return () => {
    if (registry.get(r.name) === r) registry.delete(r.name)
    for (const f of subs) f()
  }
}

export const rasterizers = (): Rasterizer[] => [...registry.values()]
export const rasterizer = (name: string): Rasterizer | undefined => registry.get(name)
export const onRegistry = (fn: () => void) => { subs.add(fn); return () => subs.delete(fn) }

/** First registered rasterizer whose `available()` is true. */
export function pick(prefer?: string): Rasterizer {
  const want = prefer && registry.get(prefer)
  if (want && want.available() === true) return want
  for (const r of registry.values()) if (r.available() === true) return r
  // Fall back to native even if unavailable — render() will surface the
  // error string, but the tab has *something* to show in the picker.
  return registry.get("native")!
}

// ── Revision counter (sidebar reload signal) ─────────────────────────

let rev = 0
const revSubs = new Set<() => void>()
export const revision = () => rev
export const onRevision = (fn: () => void) => { revSubs.add(fn); return () => revSubs.delete(fn) }
const bump = () => { rev++; for (const f of revSubs) f() }

// ── Save / pack ──────────────────────────────────────────────────────

function serialize(name: string, glyph: string, frames: Map<AvatarState, Frame>, url?: string): string {
  const out: string[] = [JSON.stringify({
    eikon: 1, name, width: W, height: H, glyph,
    author: process.env.USER ?? "unknown",
    created: new Date().toISOString(),
    ...(url ? { source_url: url } : {}),
  })]
  for (const st of STATES) {
    const f = frames.get(st)!
    out.push(JSON.stringify({ state: st, fps: 12, frame_count: 1, loop_from: 1 }))
    out.push(JSON.stringify({ f: 0, data: f.join("\n") }))
  }
  return out.join("\n") + "\n"
}

/** Render all six states and write `.eikon` + `studio.json`. External
 *  sources referenced in `s.sources` as absolute paths are adopted into
 *  `source/` and rewritten to bare filenames. Returns the written
 *  `.eikon` path. Sets `eikonPath` pref and bumps revision. */
export async function save(s: Session): Promise<string> {
  const r = rasterizer(s.rasterizer) ?? pick(s.rasterizer)
  const paths = ensure(s.name)
  // Adopt any external-path sources into source/.
  const sources: Session["sources"] = {}
  for (const [role, p] of Object.entries(s.sources) as Array<[AvatarState | "base", string]>) {
    if (!p) continue
    const abs = p.includes("/") ? p : join(paths.source, p)
    sources[role] = existsSync(abs) ? adopt(s.name, abs, role) : p
  }
  // Render each distinct (src, knobs) pair once; fan to states.
  const seen = new Map<string, Frame>()
  const frames = new Map<AvatarState, Frame>()
  for (const st of STATES) {
    const src = findSource(s.name, st)
    const k = eff(s, st)
    const key = `${src ?? ""}|${JSON.stringify(k)}`
    let f = seen.get(key)
    if (!f) {
      if (!src) f = Array.from({ length: H }, (_, i) => (i === H >> 1 ? s.glyph.padStart(W >> 1) : "").padEnd(W))
      else {
        const out = await cached(r, src, s.spatial, k)
        if ("err" in out) throw new Error(out.err)
        f = out.frames[0]!
      }
      seen.set(key, f)
    }
    frames.set(st, f)
  }
  const url = header(paths.file)?.source_url as string | undefined
  await Bun.write(paths.file, serialize(s.name, s.glyph, frames, url))
  writeStudio(s.name, { ...toStudio(s), sources })
  prefs.set("eikonPath", paths.file)
  bump()
  return paths.file
}

/** Delete an installed eikon's folder. */
export function remove(name: string) {
  rmSync(dir(name), { recursive: true, force: true })
  if (prefs.get("eikonPath") === file(name)) prefs.set("eikonPath", undefined)
  bump()
}

// ── Bundled source fetch ─────────────────────────────────────────────

type Manifest = { files: string[] }

/** Fetch `manifest.json` + listed files from a header `source_url` into
 *  <name>/source/. Relative URLs resolve against the manifest's dir. */
export async function fetchSource(name: string, url: string): Promise<number> {
  const base = url.endsWith("/") ? url : url + "/"
  const res = await fetch(base + "manifest.json")
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`)
  const man = await res.json() as Manifest
  if (!Array.isArray(man.files)) throw new Error("manifest: missing files[]")
  ensure(name)
  let n = 0
  for (const f of man.files) {
    const r = await fetch(base + f)
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`)
    await Bun.write(join(sourceDir(name), basename(f)), await r.arrayBuffer())
    n++
  }
  bump()
  return n
}

export { parseEikon, probe }
export * as eikon from "./eikon"

// Keep `dirname` referenced so a future bundler tree-shake doesn't
// drop the node:path import when only `join/extname/basename` survive.
void dirname
