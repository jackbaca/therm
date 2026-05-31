import { loadCatalog, searchCatalog, publicCatalogUrl, type Catalog, type CatalogEntry, type CatalogOptions } from "eikon/catalog"
import { eikon } from "./eikon"
import * as prefs from "../context/preferences"

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type EntryState = "available" | "installed" | "active" | "legacy-name-match"
type LoadStatus = "ready" | "empty" | "error"

export type InstalledManifest = {
  name?: string
  license?: string
  provenance?: string
  origin?: { source?: string; at?: string; sha?: string }
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

export type PreviewOptions = { signal?: AbortSignal; timeoutMs?: number }
export type MarketplaceInstall = { name: string; n: number; bytes: number }

const DEFAULT_TIMEOUT = 5000
const DEFAULT_CACHE_LIMIT = 24

function keyUrl(s: string) {
  return s.replace(/\/?$/, "/")
}

function entryKeys(entry: CatalogEntry) {
  return [keyUrl(entry.identityKey), keyUrl(entry.sourceKey)]
}

function keysFor(inst: eikon.Installed): string[] {
  const keys = new Set<string>()
  const man = inst.manifest as InstalledManifest | undefined
  const origin = typeof man?.origin?.source === "string" ? man.origin.source : undefined
  const head = eikon.header(inst.file)
  const src = typeof head?.source_url === "string" ? head.source_url : inst.sourceUrl
  if (origin) keys.add(keyUrl(origin))
  if (src) keys.add(keyUrl(src))
  return [...keys]
}

export function installed(): InstalledMetadata[] {
  return eikon.list().map(inst => ({ ...inst, manifest: inst.manifest as InstalledManifest | undefined, identityKeys: keysFor(inst) }))
}

function match(entry: CatalogEntry, xs: InstalledMetadata[]) {
  const keys = entryKeys(entry)
  const exact = xs.find(x => x.identityKeys.some(k => keys.includes(k)))
  if (exact) return { inst: exact, legacy: false }
  const named = xs.find(x => x.name === entry.name)
  if (named) return { inst: named, legacy: true }
  return undefined
}

function row(entry: CatalogEntry, xs: InstalledMetadata[]): MarketplaceRow {
  const keyed = xs.some(x => x.identityKeys.length > 0)
  const hit = match(entry, xs)
  const usable = hit && !(hit.legacy && keyed) ? hit : undefined
  const active = prefs.get("eikon") === usable?.inst.name
  const installed = Boolean(usable)
  const installState: EntryState = active ? "active" : !usable ? "available" : usable.legacy ? "legacy-name-match" : "installed"
  return {
    entry,
    installed,
    active,
    installState,
    ...(usable?.inst.file ? { installedPath: usable.inst.file } : {}),
    ...(usable?.inst.manifest ? { installedManifest: usable.inst.manifest } : {}),
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
  private cache = new Map<string, string>()
  private inFlight = new Map<string, Promise<string>>()

  constructor(catalog: Catalog, opts: MarketplaceOptions = {}) {
    this.catalog = catalog
    this.fetcher = opts.fetcher ?? fetch
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
    this.previewCacheLimit = opts.previewCacheLimit ?? DEFAULT_CACHE_LIMIT
  }

  rows(query = ""): MarketplaceRow[] {
    const entries = searchCatalog(this.catalog.entries, query)
    const xs = installed()
    return entries.map(e => row(e, xs))
  }

  entry(id: string): CatalogEntry | undefined {
    return this.catalog.entries.find(e => e.identityKey === id || e.sourceKey === id || e.name === id)
  }

  async preview(id: string, opts: PreviewOptions = {}): Promise<string> {
    if (opts.signal?.aborted) throw abortErr()
    const entry = this.entry(id)
    if (!entry) throw new Error(`marketplace: unknown eikon "${id}"`)
    const hit = this.cache.get(entry.identityKey)
    if (hit !== undefined) return hit
    const active = this.inFlight.get(entry.identityKey)
    if (active) return active
    const p = this.loadPreview(entry, opts).finally(() => this.inFlight.delete(entry.identityKey))
    this.inFlight.set(entry.identityKey, p)
    return p
  }

  async install(id: string): Promise<MarketplaceInstall> {
    const entry = this.entry(id)
    if (!entry) throw new Error(`marketplace: unknown eikon "${id}"`)
    const before = prefs.get("eikon")
    const out = await eikon.fetchSource(entry.installUrl, { name: entry.name })
    if (prefs.get("eikon") !== before) prefs.set("eikon", before)
    return out
  }

  private async loadPreview(entry: CatalogEntry, opts: PreviewOptions) {
    const ctl = new AbortController()
    const timeout = setTimeout(() => ctl.abort(), opts.timeoutMs ?? this.timeoutMs)
    const off = () => ctl.abort()
    opts.signal?.addEventListener("abort", off, { once: true })
    try {
      const res = await this.fetcher(entry.previewUrl, { signal: ctl.signal })
      if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`)
      const text = await res.text()
      this.cache.set(entry.identityKey, text)
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
