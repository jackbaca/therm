import { resolve as resolveSource, type Resolved } from "eikon"
import * as svc from "../service/eikon"
import * as market from "../service/eikon-marketplace"
import * as prefs from "../context/preferences"

export const EIKON_CLI_USAGE = `\
herm eikon — install and manage Herm avatars

Usage:
  herm eikon search [query] [--json]
  herm eikon browse [query] [--json]
  herm eikon inspect <name|url|dir> [--json]
  herm eikon info <name> [--json]
  herm eikon install <name|url|dir> [--name N] [--no-source] [--json]
  herm eikon list [--json]
  herm eikon use <name> [--json]
  herm eikon update <name> [--active-ok] [--json]
  herm eikon remove <name> [--active-ok] [--json]
  herm eikon -h, --help
`

type FetchOpts = { name?: string; media?: boolean; progress?: (d: number, t: number) => void }

type SearchRow = {
  name: string
  title?: string
  author?: string
  version?: string
  sourceIdentity?: string
  trust: svc.LifecycleInfo["trust"]
  installed: boolean
  active: boolean
  compatibility?: Record<string, unknown> | string
}

type InspectResult = {
  source: string
  name: string
  title?: string
  author?: string
  version?: string
  sourceKind: svc.SourceInfo["kind"]
  sourceIdentity?: string
  compatibility?: Record<string, unknown> | string
  preview: boolean
  poster: boolean
  installed: boolean
  active: boolean
  trust: svc.LifecycleInfo["trust"]
  trustReason?: string
}

export type EikonCliDeps = {
  fetchSource: (source: string, opts?: FetchOpts) => Promise<svc.Fetched>
  peekSource: typeof svc.peekSource
  search: (query: string) => Promise<SearchRow[]>
  inspect: (source: string) => Promise<InspectResult>
  info: (name: string) => svc.LifecycleInfo
  update: typeof svc.update
  remove: typeof svc.remove
  list: typeof svc.list
  baked: typeof svc.baked
  has: (name: string) => boolean
  setActive: (name: string) => void
  getActive: () => string | undefined
}

export type EikonCliIO = {
  stdout: (s: string) => void
  stderr: (s: string) => void
}

type ResolvedManifestInfo = {
  name?: string
  display?: { title?: string; author?: string }
  version?: string
  compatibility?: Record<string, unknown> | string
  preview?: string
  poster?: string
}

function manifestInfo(x: unknown): ResolvedManifestInfo | undefined {
  if (!x || typeof x !== "object") return undefined
  return x as ResolvedManifestInfo
}

function inspectFromResolved(source: string, r: Resolved): InspectResult {
  const man = manifestInfo(r.manifest)
  return {
    source,
    name: r.name,
    title: man?.display?.title ?? man?.name,
    author: man?.display?.author,
    version: man?.version,
    sourceKind: r.origin.kind ?? "legacy",
    sourceIdentity: r.origin.identityKey ?? r.origin.sourceKey ?? r.origin.repo ?? r.origin.source,
    compatibility: man?.compatibility,
    preview: Boolean(man?.preview),
    poster: Boolean(man?.poster),
    installed: svc.list().some(e => e.name === r.name),
    active: prefs.get("eikon") === r.name,
    trust: r.trust.state,
    ...(r.trust.reason ? { trustReason: r.trust.reason } : {}),
  }
}

function searchRow(row: market.MarketplaceRow): SearchRow {
  const lifecycle = row.lifecycle
  return {
    name: row.entry.name,
    ...(row.entry.title ? { title: row.entry.title } : {}),
    ...(row.entry.author ? { author: row.entry.author } : {}),
    ...(row.entry.version ? { version: row.entry.version } : {}),
    ...(row.sourceIdentity ? { sourceIdentity: row.sourceIdentity } : {}),
    trust: row.trust,
    installed: row.installed,
    active: row.active,
    compatibility: lifecycle.compatibility,
  }
}

const defaultDeps = (): EikonCliDeps => ({
  fetchSource: svc.fetchSource,
  peekSource: svc.peekSource,
  search: async query => {
    const state = await market.load({ query })
    if (state.status === "error") throw new Error(state.error ?? "marketplace failed")
    return state.rows.map(searchRow)
  },
  inspect: async source => inspectFromResolved(source, await resolveSource(source)),
  info: svc.lifecycle,
  update: svc.update,
  remove: svc.remove,
  list: svc.list,
  baked: svc.baked,
  has: name => svc.list().some(e => e.name === name),
  setActive: name => prefs.set("eikon", name),
  getActive: () => prefs.get("eikon"),
})

const defaultIO = (): EikonCliIO => ({
  stdout: s => process.stdout.write(s),
  stderr: s => process.stderr.write(s),
})

type Parsed = {
  values: string[]
  json: boolean
  name?: string
  media?: boolean
  activeOk?: boolean
  error?: string
}

function parse(rest: readonly string[]): Parsed {
  const out: Parsed = { values: [], json: false, media: true, activeOk: false }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === "--json") { out.json = true; continue }
    if (a === "--no-source") { out.media = false; continue }
    if (a === "--active-ok") { out.activeOk = true; continue }
    if (a === "--no-use") continue
    if (a === "--name") {
      const v = rest[++i]
      if (!v || v.startsWith("-")) return { ...out, error: "--name requires a value" }
      out.name = v
      continue
    }
    if (a.startsWith("-")) return { ...out, error: `unknown option ${a}` }
    out.values.push(a)
  }
  return out
}

function activeMessage(x: svc.ActiveConsequence) {
  if (x.action === "remove") return `Removing '${x.name}' will clear the active avatar. Pass --active-ok to remove it.`
  return `Updating '${x.name}' will change the active avatar's backing package. Pass --active-ok to update it.`
}

function emitError(io: EikonCliIO, msg: string, json: boolean, extra?: Record<string, unknown>): 1 {
  io.stderr(json ? JSON.stringify({ ok: false, error: msg, ...extra }) + "\n" : `error: ${msg}\n`)
  return 1
}

function isActiveConsequence(x: svc.Fetched | svc.ActiveConsequence): x is svc.ActiveConsequence {
  return "type" in x && x.type === "active-consequence"
}

function emit(io: EikonCliIO, text: string): 0 {
  io.stdout(text.endsWith("\n") ? text : text + "\n")
  return 0
}

export async function handleEikonCli(
  argv: readonly string[],
  deps: EikonCliDeps = defaultDeps(),
  io: EikonCliIO = defaultIO(),
): Promise<number | null> {
  if (argv[0] !== "eikon") return null
  const cmd = argv[1]
  if (!cmd || cmd === "-h" || cmd === "--help") return emit(io, EIKON_CLI_USAGE)

  const p = parse(argv.slice(2))
  if (p.error) return emitError(io, p.error, p.json)

  try {
    if (cmd === "install") {
      const source = p.values[0]
      if (!source) return emitError(io, "usage: herm eikon install <name|url|dir>", p.json)
      const out = await deps.fetchSource(source, { name: p.name, media: p.media })
      const active = deps.getActive() ?? null
      if (p.json) return emit(io, JSON.stringify({ ok: true, name: out.name, n: out.n, bytes: out.bytes, sources: out.sources, active }))
      return emit(io, `Installed '${out.name}' (${out.n} files)\nRun 'herm eikon use ${out.name}' to activate.`)
    }

    if (cmd === "search" || cmd === "browse") {
      const query = p.values.join(" ")
      const eikons = await deps.search(query)
      if (p.json) return emit(io, JSON.stringify({ ok: true, query, eikons }))
      return emit(io, eikons.length ? eikons.map(e => `${e.name}\t${e.title ?? e.name}\t${e.trust}${e.active ? "\tactive" : e.installed ? "\tinstalled" : ""}`).join("\n") : "No eikons found")
    }

    if (cmd === "inspect" || cmd === "peek") {
      const source = p.values[0]
      if (!source) return emitError(io, `usage: herm eikon ${cmd} <name|url|dir>`, p.json)
      if (cmd === "peek") {
        const out = await deps.peekSource(source)
        if (!out) return emitError(io, `Could not peek '${source}'`, p.json)
        if (p.json) return emit(io, JSON.stringify({ ok: true, source, n: out.n, bytes: out.bytes }))
        return emit(io, `${source}: ${out.n} files, ${out.bytes} bytes`)
      }
      const out = await deps.inspect(source)
      if (p.json) return emit(io, JSON.stringify({ ok: true, ...out }))
      return emit(io, `${out.name}  ${out.title ?? ""}\n  source: ${out.sourceKind} ${out.sourceIdentity ?? out.source}\n  trust: ${out.trust}\n  installed: ${out.installed}`)
    }

    if (cmd === "info") {
      const name = p.values[0]
      if (!name) return emitError(io, "usage: herm eikon info <name>", p.json)
      const out = deps.info(name)
      if (p.json) return emit(io, JSON.stringify({ ok: true, ...out }))
      return emit(io, `${out.name}${out.version ? ` v${out.version}` : ""}${out.active ? " active" : " installed"}\n  source: ${out.source.kind} ${out.source.identity ?? out.source.origin ?? "unknown"}\n  trust: ${out.trust}`)
    }

    if (cmd === "list") {
      const rows = deps.list().map(e => ({ name: e.name, file: e.file, hasSource: e.hasSource, sourceUrl: e.sourceUrl, lifecycle: e.lifecycle }))
      const active = deps.getActive() ?? null
      if (p.json) return emit(io, JSON.stringify({ ok: true, active, eikons: rows }))
      return emit(io, rows.length ? rows.map(e => `${e.name}${e.name === active ? " *" : ""}`).join("\n") : "No installed eikons")
    }

    if (cmd === "use") {
      const name = p.values[0]
      if (!name) return emitError(io, "usage: herm eikon use <name>", p.json)
      if (!deps.baked(name)) return emitError(io, `No installed or bundled eikon named '${name}'`, p.json)
      deps.setActive(name)
      if (p.json) return emit(io, JSON.stringify({ ok: true, active: name }))
      return emit(io, `Avatar → ${name}`)
    }

    if (cmd === "remove") {
      const name = p.values[0]
      if (!name) return emitError(io, "usage: herm eikon remove <name>", p.json)
      if (!deps.has(name)) return emitError(io, `No installed eikon named '${name}'`, p.json)
      const wasActive = deps.getActive() === name
      const result = deps.remove(name, { confirmActive: p.activeOk })
      if (result?.type === "active-consequence") return emitError(io, activeMessage(result), p.json, { consequence: "active", action: result.action, name: result.name })
      if (p.json) return emit(io, JSON.stringify({ ok: true, name, removed: true, activeCleared: wasActive }))
      return emit(io, `Removed '${name}'${wasActive ? " and cleared active avatar" : ""}`)
    }

    if (cmd === "update") {
      const name = p.values[0]
      if (!name) return emitError(io, "usage: herm eikon update <name>", p.json)
      const out = await deps.update(name, { confirmActive: p.activeOk })
      if (isActiveConsequence(out)) return emitError(io, activeMessage(out), p.json, { consequence: "active", action: out.action, name: out.name })
      const active = deps.getActive() ?? null
      if (p.json) return emit(io, JSON.stringify({ ok: true, name: out.name, n: out.n, bytes: out.bytes, active }))
      return emit(io, `Updated '${out.name}' (${out.n} files)`)
    }

    return emitError(io, `unknown eikon command '${cmd}'`, p.json)
  } catch (e) {
    return emitError(io, e instanceof Error ? e.message : String(e), p.json)
  }
}
