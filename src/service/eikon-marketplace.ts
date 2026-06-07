import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadCatalog, searchCatalog, publicCatalogUrl, type Catalog, type PublicCatalogEntry as CatalogEntry, type CatalogOptions } from "eikon"
import { eikon } from "./eikon"
import * as prefs from "../context/preferences"

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type EntryState = "available" | "installed" | "active" | "legacy-name-match" | "incompatible" | "mismatch"
type LoadStatus = "ready" | "empty" | "error"

export type InstalledManifest = {
  name?: string
  kind?: string
  id?: string
  version?: string
  origin?: { source?: string; at?: string; sha?: string; kind?: string; trust?: string; sourceKey?: string; identityKey?: string; packageUrl?: string; repo?: string; selector?: string; catalogRoot?: string }
  [key: string]: unknown
}

export type InstalledMetadata = eikon.Installed & {
  manifest?: InstalledManifest
  identityKeys: string[]
}

export type MarketplaceRow = {
  entry: CatalogEntry
  installed: boolean
  active: boolean
  installState: EntryState
  preview?: string
  installedManifest?: InstalledManifest
  installedPath?: string
  lifecycle: eikon.LifecycleInfo
  trust: eikon.LifecycleInfo["trust"]
  updateable: boolean
  updateAvailable: boolean
  removable: boolean
  sourceIdentity?: string
  reason?: string
  action: "install" | "use" | "active" | "retry"
}

export type MarketplaceState = {
  status: LoadStatus
  query: string
  rows: MarketplaceRow[]
  selected?: MarketplaceRow
  error?: string
  service?: MarketplaceService
}

export type MarketplaceOptions = CatalogOptions & {
  catalog?: string
  fetcher?: Fetcher
  query?: string
  timeoutMs?: number
  previewCacheLimit?: number
  concurrency?: number
}

type PreviewOptions = { signal?: AbortSignal; timeoutMs?: number }
export type MarketplaceInstall = { name: string; n: number; bytes: number }

type Job<T> = {
  run: () => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (err: unknown) => void
}

const DEFAULT_TIMEOUT = 5000
const DEFAULT_CACHE_LIMIT = 24

function keyIdentity(s: string) {
  try {
    const u = new URL(s)
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:") return u.href.replace(/\/?$/, "/")
  } catch {}
  return s
}

function manifestBaseKey(s: string) {
  try {
    const u = new URL(s)
    if ((u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:") && u.pathname.endsWith("/manifest.json")) {
      return new URL(".", u).href
    }
  } catch {}
  return undefined
}

function registryKey(man: InstalledManifest | undefined, source: string | undefined) {
  if (man?.kind !== "eikon.package" || typeof man.id !== "string") return undefined
  const sourceKey = man.origin?.sourceKey ?? man.origin?.identityKey
  if (sourceKey) return keyIdentity(sourceKey)
  try {
    const host = source ? new URL(source).host : undefined
    if (!host) return undefined
    return `registry:${host}:${man.id}${typeof man.version === "string" && man.version ? `@${man.version}` : ""}`
  } catch {
    return undefined
  }
}

function entryKeys(entry: CatalogEntry) {
  return [...new Set([entry.identityKey, entry.sourceKey].filter(Boolean).map(keyIdentity))]
}

function keysFor(inst: eikon.Installed): string[] {
  const keys = new Set<string>()
  const man = inst.manifest as InstalledManifest | undefined
  const origin = typeof man?.origin?.source === "string" ? man.origin.source : undefined
  const head = eikon.header(inst.file)
  const src = typeof head?.source_url === "string" ? head.source_url : inst.sourceUrl
  const registry = registryKey(man, origin)
  if (registry) keys.add(registry)
  if (origin) {
    keys.add(keyIdentity(origin))
    const base = manifestBaseKey(origin)
    if (base) keys.add(keyIdentity(base))
  }
  if (src) {
    keys.add(keyIdentity(src))
    const base = manifestBaseKey(src)
    if (base) keys.add(keyIdentity(base))
  }
  return [...keys]
}

function cacheKey(entry: CatalogEntry) {
  return entry.identityKey || entry.sourceKey || entry.id
}

function previewTarget(entry: CatalogEntry) {
  return entry.preview || entry.runtimeUrl
}

export function installed(): InstalledMetadata[] {
  return eikon.list().map(inst => ({ ...inst, manifest: inst.manifest as InstalledManifest | undefined, identityKeys: keysFor(inst) }))
}

function match(entry: CatalogEntry, xs: InstalledMetadata[]) {
  const keys = entryKeys(entry)
  const exact = xs.find(x => x.identityKeys.some(k => keys.includes(k)))
  if (exact) return { inst: exact, legacy: false }
  const named = xs.find(x => x.name === entry.name && x.identityKeys.length === 0)
  if (named) return { inst: named, legacy: true }
  return undefined
}

function row(entry: CatalogEntry, xs: InstalledMetadata[]): MarketplaceRow {
  const usable = match(entry, xs)
  const active = usable ? prefs.get("eikon") === usable.inst.name : false
  const installed = Boolean(usable)
  const blocked = entry.compatibility?.available === false
  const mismatch = usable?.inst.lifecycle.trust === "mismatch"
  const installState: EntryState = mismatch ? "mismatch" : blocked ? "incompatible" : active ? "active" : !usable ? "available" : usable.legacy ? "legacy-name-match" : "installed"
  const lifecycle = usable?.inst.lifecycle ?? {
    name: entry.name,
    title: entry.title,
    author: entry.author,
    version: entry.version,
    source: { kind: "default-catalog" as const, identity: entry.sourceKey, packageUrl: entry.packageUrl },
    trust: entry.trust ? "verified" as const : "unverified" as const,
    active: false,
    removable: false,
    updateable: false,
    updateAvailable: false,
    dirty: false,
    ...(entry.poster ? { poster: entry.poster } : {}),
    ...(entry.preview ? { preview: entry.preview } : {}),
    compatibility: entry.compatibility as Record<string, unknown>,
  }
  return {
    entry,
    installed,
    active,
    installState,
    ...(usable?.inst.file ? { installedPath: usable.inst.file } : {}),
    ...(usable?.inst.manifest ? { installedManifest: usable.inst.manifest } : {}),
    lifecycle,
    trust: lifecycle.trust,
    updateable: lifecycle.updateable,
    updateAvailable: lifecycle.updateAvailable,
    removable: lifecycle.removable,
    sourceIdentity: lifecycle.source.identity,
    reason: blocked ? entry.compatibility?.reason ?? "incompatible" : mismatch ? "trust mismatch" : undefined,
    action: active ? "active" : installed ? "use" : "install",
  }
}

function abortErr() {
  return new DOMException("aborted", "AbortError")
}

export class MarketplaceService {
  private catalog: Catalog
  private fetcher: Fetcher
  private timeoutMs: number
  private previewCacheLimit: number
  private concurrency: number
  private activeLoads = 0
  private queue: Job<string>[] = []
  private cache = new Map<string, string>()
  private inFlight = new Map<string, Promise<string>>()

  constructor(catalog: Catalog, opts: MarketplaceOptions = {}) {
    this.catalog = catalog
    this.fetcher = opts.fetcher ?? fetch
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
    this.previewCacheLimit = opts.previewCacheLimit ?? DEFAULT_CACHE_LIMIT
    this.concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4))
  }

  rows(query = ""): MarketplaceRow[] {
    const entries = searchCatalog(this.catalog.entries, query)
    const xs = installed()
    return entries.map(e => row(e, xs))
  }

  entry(id: string): CatalogEntry | undefined {
    const key = keyIdentity(id)
    return this.catalog.entries.find(e => keyIdentity(e.identityKey) === key || keyIdentity(e.sourceKey) === key || e.id === id || e.name === id)
  }

  async preview(id: string, opts: PreviewOptions = {}): Promise<string> {
    if (opts.signal?.aborted) throw abortErr()
    const entry = this.entry(id)
    if (!entry) throw new Error(`marketplace: unknown eikon "${id}"`)
    const key = cacheKey(entry)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const active = this.inFlight.get(key)
    if (active) return active
    const p = this.enqueue(() => this.loadPreview(entry, opts)).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, p)
    return p
  }

  async install(id: string): Promise<MarketplaceInstall> {
    const entry = this.entry(id)
    if (!entry) throw new Error(`marketplace: unknown eikon "${id}"`)
    if (entry.compatibility?.available === false) throw new Error(entry.compatibility.reason ?? "eikon is incompatible")
    const out = await eikon.fetchSource(entry.packageUrl, { name: entry.name })
    const ef = eikon.file(out.name)
    if (!existsSync(ef)) {
      const text = await this.preview(entry.identityKey)
      writeFileSync(ef, text)
      eikon.notifyRevision()
    }
    const mf = join(eikon.dir(out.name), "manifest.json")
    const man = JSON.parse(readFileSync(mf, "utf8")) as Record<string, unknown>
    const origin = man.origin && typeof man.origin === "object" && !Array.isArray(man.origin) ? man.origin as Record<string, unknown> : {}
    writeFileSync(mf, JSON.stringify({ ...man, origin: { ...origin, sourceKey: entry.sourceKey, identityKey: entry.identityKey, packageUrl: entry.packageUrl } }, null, 2) + "\n")
    return out
  }

  private enqueue(run: () => Promise<string>) {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ run, resolve, reject })
      this.pump()
    })
  }

  private pump() {
    if (this.activeLoads >= this.concurrency) return
    const job = this.queue.shift()
    if (!job) return
    this.activeLoads += 1
    job.run()
      .then(job.resolve, job.reject)
      .finally(() => {
        this.activeLoads -= 1
        this.pump()
      })
  }

  private async loadPreview(entry: CatalogEntry, opts: PreviewOptions) {
    const ctl = new AbortController()
    const timeout = setTimeout(() => ctl.abort(), opts.timeoutMs ?? this.timeoutMs)
    const off = () => ctl.abort()
    opts.signal?.addEventListener("abort", off, { once: true })
    try {
      const res = await this.fetcher(previewTarget(entry), { signal: ctl.signal })
      if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`)
      const text = await res.text()
      this.cache.set(cacheKey(entry), text)
      while (this.cache.size > this.previewCacheLimit) this.cache.delete(this.cache.keys().next().value!)
      return text
    } finally {
      clearTimeout(timeout)
      opts.signal?.removeEventListener("abort", off)
    }
  }
}

export async function load(opts: MarketplaceOptions = {}): Promise<MarketplaceState> {
  const query = opts.query ?? ""
  try {
    if (opts.catalog) publicCatalogUrl(opts.catalog, undefined, opts)
    const cat = await loadCatalog(opts.catalog, opts.fetcher ?? fetch, opts)
    const service = new MarketplaceService(cat, opts)
    const rows = service.rows(query)
    return { status: rows.length > 0 ? "ready" : "empty", query, rows, selected: rows[0], service }
  } catch (err) {
    return { status: "error", query, rows: [], error: err instanceof Error ? err.message : String(err) }
  }
}
