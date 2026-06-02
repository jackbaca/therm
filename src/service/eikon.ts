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
// counter so the sidebar reloads even when the active name is unchanged.
//
// The rasterizer registry is a module-level Map. Built-ins self-insert
// at import; herm plugins register via `api.eikon.rasterizer.register`
// (scope-tracked — deactivate unregisters). Studio reads the registry
// live on every open of the rasterizer picker.

import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join, extname, basename } from "node:path"
import { install, peek, header as peekHeader, type Installed as Got } from "eikon"
import { hermesPath } from "./hermes-home"
import * as prefs from "../context/preferences"
import { parseEikon } from "../components/avatar/eikon"
import { BUNDLED_EIKON_DIR } from "../components/avatar/bundled"
import type { AvatarState } from "../components/avatar/states"
import { BUILTIN, cached, probe, W, H, type Rasterizer, type Frame } from "../utils/eikon-render"
import { STATES, eff, toStudio, fresh, type Session, type Studio } from "../utils/eikon-knobs"

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

/** Folder names under eikons/ regardless of whether they've been
 *  saved yet — used by the Open picker so a fresh `ensure()`d draft
 *  (which `list()` skips until it has a .eikon) is still reachable. */
export function raw(): string[] {
  const root = ROOT()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name)
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
  return peekHeader(path) ?? undefined
}

/** Locate the packed `.eikon` for a name — installed folder-form
 *  first, then the bundled flat dir. Studio falls back to this for
 *  baked-frame preview + header `source_url` when `source/` is empty. */
export function baked(name: string): string | undefined {
  const local = file(name)
  if (existsSync(local)) return local
  for (const f of [`${name}.eikon`, "default.eikon"]) {
    const p = join(BUNDLED_EIKON_DIR, f)
    const head = header(p)
    if (head && String(head.name).toLowerCase() === name.toLowerCase()) return p
  }
  return undefined
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

function serialize(name: string, glyph: string, fps: number,
                   clips: Map<AvatarState, Frame[]>, url?: string): string {
  const out: string[] = [JSON.stringify({
    eikon: 1, name, width: W, height: H, glyph,
    author: process.env.USER ?? "unknown",
    created: new Date().toISOString(),
    ...(url ? { source_url: url } : {}),
  })]
  for (const st of STATES) {
    const fs = clips.get(st)!
    out.push(JSON.stringify({ state: st, fps, frame_count: fs.length, loop_from: 0 }))
    fs.forEach((f, i) => out.push(JSON.stringify({ f: i, data: f.join("\n") })))
  }
  return out.join("\n") + "\n"
}

/** Render all six states (all frames) and write `.eikon` + `studio.json`.
 *  External sources referenced in `s.sources` as absolute paths are
 *  adopted into `source/` and rewritten to bare filenames. Returns the
 *  written `.eikon` path. Sets the `eikon` pref and bumps revision. */
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
  const seen = new Map<string, Frame[]>()
  const clips = new Map<AvatarState, Frame[]>()
  const blank = [Array.from({ length: H }, (_, i) => (i === H >> 1 ? s.glyph.padStart(W >> 1) : "").padEnd(W))]
  for (const st of STATES) {
    const src = findSource(s.name, st)
    const k = eff(s, st)
    const key = `${src ?? ""}|${JSON.stringify(k)}`
    let fs = seen.get(key)
    if (!fs) {
      if (!src) fs = blank
      else {
        const out = await cached(r, src, s.spatial, s.tone, s.fps, k)
        if ("err" in out) throw new Error(out.err)
        fs = out.frames
      }
      seen.set(key, fs)
    }
    clips.set(st, fs)
  }
  const url = header(paths.file)?.source_url as string | undefined
  await Bun.write(paths.file, serialize(s.name, s.glyph, s.fps, clips, url))
  writeStudio(s.name, { ...toStudio(s), sources })
  prefs.set("eikon", s.name)
  bump()
  return paths.file
}

/** Delete an installed eikon's folder. */
export function remove(name: string) {
  rmSync(dir(name), { recursive: true, force: true })
  if (prefs.get("eikon") === name) prefs.set("eikon", undefined)
  bump()
}

// ── Install / fetch ──────────────────────────────────────────────────

export type Sources = Partial<Record<AvatarState | "base", string>>
export type Fetched = { name: string; sources: Sources; n: number; bytes: number }
export type LifecycleState = AvatarState
export type PackageState = "available" | "invalid" | "installed" | "active" | "update-available" | "incompatible"
export type PackageManifest = {
  kind: "eikon.package"
  schemaVersion: string
  id: string
  name: string
  version?: string
  display?: { title?: string; author?: string; description?: string; glyph?: string; tags?: string[] }
  compatibility: { eikon: string; hosts?: Record<string, string> }
  entrypoints: { default: string; [key: string]: string }
  files?: Array<{ path: string; mediaType?: string; size?: number; digest?: string; role?: string }>
  source?: { base?: string; states?: Partial<Record<string, { file: string; role?: string }>> }
  poster?: string
  preview?: string
  signals?: Record<string, { clip?: string; state?: string; decorator?: string; fallback: string }>
  triggers?: Array<{ signal: string; when: string; fallback?: string }>
  extensions?: { used?: string[]; required?: string[] }
  legacy?: { sourceFormat?: ".eikon"; migration?: "adapt" | "converted"; notes?: string[] }
  origin?: Record<string, unknown>
}
export type CatalogPackage = {
  kind: "eikon.catalog.entry"
  schemaVersion: string
  id: string
  sourceKey: string
  name: string
  title?: string
  author?: string
  description?: string
  glyph?: string
  tags?: string[]
  poster?: string
  preview?: string
  packageUrl: string
  detailUrl?: string
  installUrl?: string
  compatibility: { eikon: string; hosts?: Record<string, string>; available?: boolean; reason?: string }
  trust?: Record<string, unknown>
  state: PackageState
}
export type AdaptedPackage = {
  manifest: PackageManifest
  eikon: ReturnType<typeof parseEikon>
  states: LifecycleState[]
  signals?: PackageManifest["signals"]
  triggers?: PackageManifest["triggers"]
  extensions?: PackageManifest["extensions"]
}

export const peekSource = peek

/** Install an eikon from any resolvable source (catalog name, git
 *  URL, local dir, http manifest base) into <profile>/eikons/<name>/.
 *  Seeds studio.json from the returned sources map and bumps the
 *  revision counter so the sidebar + Gallery reload. */
export async function fetchSource(src: string, opts?: { name?: string;
                                   progress?: (d: number, t: number) => void }): Promise<Fetched> {
  const out: Got = await install(src, ROOT(), opts)
  const prev = readStudio(out.name)
  writeStudio(out.name, { ...(prev ?? toStudio(fresh(out.name, pick()))),
                          sources: { ...prev?.sources, ...out.sources } })
  bump()
  return { name: out.name, sources: out.sources, n: out.n, bytes: out.bytes }
}

const OBJ = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const SAFE = /^[a-zA-Z0-9._/-]+$/
const LEGACY = /\.eikon$/i

function safePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("./") || path.includes("../") || path === "..") return false
  if (!SAFE.test(path)) return false
  return !path.split("/").includes("..")
}

function pkgErr(path: string, msg: string): Error {
  return new Error(`${path}: ${msg}`)
}

function launchOk(range: string): boolean {
  const lower = range.match(/>=?\s*(\d+)/)
  if (lower && Number(lower[1]) > 2) return false
  const exact = range.match(/^\s*(\d+)(?:\.\d+)?\s*$/)
  if (exact && Number(exact[1]) !== 2) return false
  return !/^\s*>=?\s*99/.test(range)
}

function validatePkg(value: unknown): PackageManifest {
  if (!OBJ(value)) throw pkgErr("manifest", "object required")
  const man = value as PackageManifest
  if (man.kind !== "eikon.package") throw pkgErr("kind", "must be eikon.package")
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(String(man.name ?? ""))) throw pkgErr("name", "safe package name required")
  if (!man.id || typeof man.id !== "string") throw pkgErr("id", "safe id required")
  if (!OBJ(man.compatibility) || typeof man.compatibility.eikon !== "string") throw pkgErr("compatibility.eikon", "required")
  if (!launchOk(man.compatibility.eikon)) throw pkgErr("compatibility.eikon", "must support launch major version 2")
  if (!OBJ(man.entrypoints) || typeof man.entrypoints.default !== "string" || !safePath(man.entrypoints.default)) throw pkgErr("entrypoints.default", "safe relative path required")
  for (const [k, p] of Object.entries(man.entrypoints)) {
    if (typeof p !== "string" || !safePath(p)) throw pkgErr(`entrypoints.${k}`, "safe relative path required")
  }
  for (const f of man.files ?? []) {
    if (!f || typeof f.path !== "string" || !safePath(f.path)) throw pkgErr("files.path", "safe relative path required")
  }
  if (man.poster && !safePath(man.poster)) throw pkgErr("poster", "safe relative path required")
  if (man.preview && !safePath(man.preview)) throw pkgErr("preview", "safe relative path required")
  for (const [k, mapping] of Object.entries(man.signals ?? {})) {
    if (!mapping || typeof mapping.fallback !== "string") throw pkgErr(`signals.${k}.fallback`, "fallback required")
  }
  return man
}

function asUrl(value: string, base?: string): string {
  if (/^file:\/\//.test(value)) return value
  const out = new URL(value, base)
  if (out.protocol !== "http:" && out.protocol !== "https:") throw pkgErr("packageUrl", "http(s) URL required")
  return out.toString()
}

function relUrl(base: string, path?: string): string | undefined {
  if (!path) return undefined
  if (/^(https?|file):\/\//.test(path)) return asUrl(path)
  if (!safePath(path)) throw pkgErr("path", "safe relative path required")
  return new URL(path, base).toString()
}

function entryState(name: string, available = true): PackageState {
  if (!available) return "incompatible"
  if (prefs.get("eikon") === name) return "active"
  if (existsSync(file(name))) return "installed"
  return "available"
}

function normalize(input: unknown, base?: string): CatalogPackage {
  if (!OBJ(input)) throw pkgErr("catalog", "entry object required")
  if (input.kind === "eikon.catalog.entry") {
    const entry = input as CatalogPackage
    return { ...entry, state: entryState(entry.name, entry.compatibility?.available !== false) }
  }
  if (OBJ(input.manifest) && typeof input.packageUrl === "string") {
    const man = validatePkg(input.manifest)
    const packageUrl = asUrl(input.packageUrl, base)
    const root = packageUrl.slice(0, packageUrl.lastIndexOf("/") + 1)
    return {
      kind: "eikon.catalog.entry", schemaVersion: "1.0",
      id: man.id, sourceKey: typeof input.sourceKey === "string" ? input.sourceKey : packageUrl,
      name: man.name, title: man.display?.title, author: man.display?.author,
      description: man.display?.description, glyph: man.display?.glyph, tags: man.display?.tags,
      poster: relUrl(root, man.poster), preview: relUrl(root, man.preview ?? man.entrypoints.default),
      packageUrl, detailUrl: typeof input.detailUrl === "string" ? asUrl(input.detailUrl, root) : undefined,
      installUrl: typeof input.installUrl === "string" ? asUrl(input.installUrl, root) : packageUrl,
      compatibility: { eikon: man.compatibility.eikon, hosts: man.compatibility.hosts, available: launchOk(man.compatibility.eikon) },
      state: entryState(man.name, launchOk(man.compatibility.eikon)),
    }
  }
  const name = String(input.name ?? "")
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) throw pkgErr("name", "safe catalog name required")
  const source = typeof input.source === "string" ? input.source : `${name}/`
  const packageUrl = /^(https?|file):\/\//.test(source) ? asUrl(source) : base ? new URL(source, base).toString() : source
  const manifest = packageUrl.endsWith("manifest.json") ? packageUrl : new URL("manifest.json", packageUrl.endsWith("/") ? packageUrl : `${packageUrl}/`).toString()
  return {
    kind: "eikon.catalog.entry", schemaVersion: "1.0", id: name,
    sourceKey: packageUrl, name, author: typeof input.author === "string" ? input.author : undefined,
    glyph: typeof input.glyph === "string" ? input.glyph : undefined,
    poster: typeof input.poster === "string" ? input.poster : undefined,
    packageUrl: manifest, compatibility: { eikon: ">=1 <3", available: true },
    state: entryState(name),
  }
}

async function loadText(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (url.startsWith("file://")) return readFileSync(new URL(url), "utf8")
  const res = await fetcher(url)
  if (!res.ok) throw new Error(`fetch: ${res.status} ${url}`)
  return await res.text()
}

async function loadJson(url: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  return JSON.parse(await loadText(url, fetcher))
}

export async function loadCatalog(index: string, fetcher: typeof fetch = fetch): Promise<CatalogPackage[]> {
  const url = index.endsWith("index.json") ? index : `${index.replace(/\/$/, "")}/index.json`
  const raw = await loadJson(url, fetcher)
  if (!Array.isArray(raw)) throw pkgErr("catalog", "index array required")
  const base = url.slice(0, url.lastIndexOf("/") + 1)
  return raw.map(item => normalize(item, base))
}

function legacyToLaunch(raw: string): ReturnType<typeof parseEikon> {
  return parseEikon(raw)
}

export async function adaptPackage(manifest: unknown, streamText?: string, legacyText?: string): Promise<AdaptedPackage> {
  const man = validatePkg(manifest)
  const entry = man.entrypoints.default
  const body = streamText ?? legacyText
  if (!body) throw pkgErr("entrypoints.default", "stream data required")
  const eik = LEGACY.test(entry) || man.legacy?.sourceFormat === ".eikon" ? legacyToLaunch(body) : parseLaunch(body)
  for (const st of STATES) if (!eik.states.has(st)) throw pkgErr(`states.${st}`, "canonical lifecycle state required")
  return { manifest: man, eikon: eik, states: [...STATES], signals: man.signals, triggers: man.triggers, extensions: man.extensions }
}

function parseLaunch(text: string): ReturnType<typeof parseEikon> {
  const lines = text.split("\n")
  const clips = new Map<string, { fps: number; frames: string[][]; loopFrom: number }>()
  let name = "unnamed", glyph: string | undefined, width = 0, height = 0
  let cur: { name: string; fps: number; frameCount?: number; loopFrom: number; frames: string[][] } | undefined
  const seal = () => {
    if (!cur) return
    if (cur.frameCount != null && cur.frameCount !== cur.frames.length) throw pkgErr(`clip.${cur.name}`, `frameCount=${cur.frameCount} but got ${cur.frames.length}`)
    clips.set(cur.name, { fps: cur.fps, frames: cur.frames, loopFrom: Math.max(0, Math.min(cur.loopFrom, cur.frames.length)) })
    cur = undefined
  }
  for (const line of lines) {
    if (!line.trim()) continue
    const rec = JSON.parse(line)
    if (rec.type === "header") {
      const major = Number(String(rec.asset?.version ?? "").split(".")[0])
      if (!major || major > 2) throw pkgErr("header.asset.version", "unsupported Eikon stream version")
      name = typeof rec.name === "string" ? rec.name : name
      glyph = typeof rec.glyph === "string" ? rec.glyph : undefined
      width = Number(rec.asset?.width ?? 0)
      height = Number(rec.asset?.height ?? 0)
      continue
    }
    if (rec.type === "clip") {
      seal()
      cur = { name: rec.name, fps: rec.fps, frameCount: rec.frameCount, loopFrom: rec.loopFrom ?? 0, frames: [] }
      continue
    }
    if (rec.type === "frame") {
      if (!cur || cur.name !== rec.clip || rec.index !== cur.frames.length) throw pkgErr("frame", "frame order mismatch")
      cur.frames.push(rec.rows)
    }
  }
  seal()
  return { meta: { version: 2, name, glyph, width, height, states: [...clips.keys()] }, states: clips }
}

async function loadPackage(url: string, fetcher: typeof fetch = fetch): Promise<{ man: PackageManifest; base: string }> {
  const man = validatePkg(await loadJson(url, fetcher))
  return { man, base: url.slice(0, url.lastIndexOf("/") + 1) }
}

export async function previewPackage(entry: CatalogPackage, fetcher: typeof fetch = fetch): Promise<AdaptedPackage> {
  const { man, base } = await loadPackage(entry.packageUrl, fetcher)
  const streamUrl = new URL(man.entrypoints.default, base).toString()
  return adaptPackage(man, await loadText(streamUrl, fetcher))
}

async function installLaunch(url: string, opts: { name?: string; fetcher?: typeof fetch } = {}): Promise<Fetched> {
  const { man, base } = await loadPackage(url, opts.fetcher)
  const name = opts.name ?? man.name
  const streamUrl = new URL(man.entrypoints.default, base).toString()
  const text = await loadText(streamUrl, opts.fetcher)
  const adapted = await adaptPackage(man, LEGACY.test(man.entrypoints.default) ? undefined : text, LEGACY.test(man.entrypoints.default) ? text : undefined)
  const paths = ensure(name)
  const clips = new Map<AvatarState, Frame[]>()
  for (const st of STATES) clips.set(st, adapted.eikon.states.get(st)?.frames ?? [[""]])
  const packed = serialize(name, adapted.manifest.display?.glyph ?? adapted.eikon.meta.glyph ?? "◆", adapted.eikon.states.get("idle")?.fps ?? 12, clips, base)
  await Bun.write(paths.file, packed)
  await Bun.write(join(paths.dir, "manifest.json"), JSON.stringify({ ...man, origin: { source: url, at: new Date().toISOString() } }, null, 2) + "\n")
  writeStudio(name, { ...toStudio(fresh(name, pick())), sources: {} })
  bump()
  return { name, sources: {}, n: 1, bytes: text.length }
}

export async function installPackage(src: string | CatalogPackage, opts: { name?: string; fetcher?: typeof fetch } = {}): Promise<Fetched> {
  const url = typeof src === "string" ? src : (src.installUrl ?? src.packageUrl)
  if (url.endsWith("manifest.json") || url.startsWith("file://")) return installLaunch(url, opts)
  return fetchSource(url, { name: opts.name })
}

export function useInstalled(name: string): void {
  if (!existsSync(file(name))) throw new Error(`eikon '${name}' is not installed`)
  prefs.set("eikon", name)
  bump()
}

export { parseEikon, probe }
export * as eikon from "./eikon"
