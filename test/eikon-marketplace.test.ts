import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { Catalog } from "eikon"
import * as market from "../src/service/eikon-marketplace"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

const launch = [
  JSON.stringify({ type: "header", eikon: 1, size: { cols: 4, rows: 2 }, defaultSignal: "state.idle", signals: { "state.idle": { clip: "idle" } } }),
  JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd", "efgh"] }),
].join("\n") + "\n"
const png = new Uint8Array([137, 80, 78, 71])
const digest = (data: string | Uint8Array) => `sha256:${createHash("sha256").update(data).digest("hex")}`

function pack(name: string, text = launch) {
  return {
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: `liftaris/${name}`,
    name,
    compatibility: { eikon: ">=1 <2" },
    entrypoints: { default: `${name}.eikon` },
    files: [
      { path: `${name}.eikon`, role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: text.length, digest: digest(text) },
      { path: "source.png", role: "source.base", mediaType: "image/png", size: png.length, digest: digest(png) },
    ],
    source: { base: "source.png" },
  }
}

type RouteBody = BodyInit | object | ((req: Request) => BodyInit | object)
type Route = { path: string; body: RouteBody; status?: number; headers?: HeadersInit }
type CatalogEntrySeed = {
  name: string
  id?: string
  version?: string
  author?: string
  description?: string
  poster?: string
  source?: string
  sourceKey?: string
  preview?: string
  runtimeUrl?: string
  packageUrl?: string
  trust?: Record<string, unknown>
}

function url(raw: string, base: string) {
  return new URL(raw, base.endsWith("/") ? base : `${base}/`).toString()
}

function catalogRow(seed: CatalogEntrySeed, base: string) {
  const dir = url(seed.source ?? `${seed.name}/`, base)
  const runtimeUrl = seed.runtimeUrl ? url(seed.runtimeUrl, dir) : url(`${seed.name}.eikon`, dir)
  const packageUrl = seed.packageUrl ? url(seed.packageUrl, dir) : url("manifest.json", dir)
  return {
    kind: "eikon.catalog.entry",
    schemaVersion: "1.0",
    id: seed.id ?? seed.name,
    version: seed.version ?? "1.0.0",
    sourceKey: seed.sourceKey ?? dir,
    name: seed.name,
    title: seed.name,
    ...(seed.author ? { author: seed.author } : {}),
    ...(seed.description ? { description: seed.description } : {}),
    poster: seed.poster ?? seed.name,
    preview: seed.preview ? url(seed.preview, dir) : runtimeUrl,
    runtimeUrl,
    packageUrl,
    compatibility: { eikon: ">=1 <2", available: true },
    trust: seed.trust ?? {},
  }
}

function entry(seed: CatalogEntrySeed): Catalog["entries"][number] {
  const raw = catalogRow(seed, "https://example.com/eikons/")
  return {
    ...raw,
    w: 48,
    h: 24,
    width: 48,
    height: 24,
    trust: raw.trust,
    identityKey: raw.sourceKey,
    raw,
  } as Catalog["entries"][number]
}

function serve(routes: Route[], seen: string[] = []) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      seen.push(path)
      const hit = routes.find(r => r.path === path)
      if (!hit) return new Response("404", { status: 404 })
      const body = typeof hit.body === "function" ? hit.body(req) : hit.body
      if (typeof body === "object" && !(body instanceof Uint8Array))
        return Response.json(body, { status: hit.status ?? 200, headers: hit.headers })
      return new Response(body as BodyInit, { status: hit.status ?? 200, headers: hit.headers })
    },
  })
}

function fixture() {
  const seen: string[] = []
  const srv = serve([
    { path: "/eikons/index.json", body: req => {
      const base = `${new URL(req.url).origin}/eikons/`
      return [
        catalogRow({ name: "ares", author: "Kaio", poster: "ARES", source: "ares/" }, base),
        catalogRow({ name: "mono", author: "Nous", poster: "MONO", source: "mono/" }, base),
        catalogRow({ name: "ares", author: "Other", poster: "ALT", source: "alt/" }, base),
      ]
    } },
    { path: "/eikons/ares/ares.eikon", body: launch },
    { path: "/eikons/ares/manifest.json", body: pack("ares") },
    { path: "/eikons/ares/source.png", body: png },
    { path: "/eikons/mono/mono.eikon", body: launch },
    { path: "/eikons/mono/manifest.json", body: pack("mono") },
    { path: "/eikons/mono/source.png", body: png },
    { path: "/eikons/alt/ares.eikon", body: launch },
    { path: "/eikons/alt/manifest.json", body: pack("ares") },
    { path: "/eikons/alt/source.png", body: png },
  ], seen)
  return { srv, seen, base: `http://localhost:${srv.port}/eikons` }
}

afterEach(() => {
  prefs.set("eikon", undefined)
  rmSync(join(HH, "eikons"), { recursive: true, force: true })
})

describe("service/eikon-marketplace", () => {
  test("loads and searches remote rows without full preview fetches", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true, query: "kaio" })
    expect(state.status).toBe("ready")
    expect(state.query).toBe("kaio")
    expect(state.rows.map(r => r.entry.name)).toEqual(["ares"])
    expect(state.rows[0]!.entry.poster).toBe("ARES")
    expect(state.rows[0]!.installed).toBe(false)
    expect(fx.seen).toEqual(["/eikons/index.json"])
    fx.srv.stop()
  })

  test("returns recoverable error state for catalog load failure", async () => {
    const srv = serve([{ path: "/eikons/index.json", body: "nope", status: 503 }])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    expect(state.status).toBe("error")
    expect(state.error).toContain("catalog: HTTP 503")
    expect(state.rows).toEqual([])
    srv.stop()
  })

  test("maps installed and active state by catalog identity before name fallback", async () => {
    const fx = fixture()
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), `${JSON.stringify({ eikon: 1, name: "ares", source_url: `${fx.base}/alt/` })}\n`)
    writeFileSync(join(eikon.dir("ares"), "manifest.json"), JSON.stringify({
      name: "ares",
      origin: { source: `${fx.base}/alt/`, at: "2026-05-31T00:00:00.000Z" },
    }, null, 2))
    prefs.set("eikon", "ares")

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const byPoster = new Map(state.rows.map(r => [r.entry.poster, r]))
    expect(byPoster.get("ALT")!.installed).toBe(true)
    expect(byPoster.get("ALT")!.active).toBe(true)
    expect(byPoster.get("ARES")!.installed).toBe(false)
    expect(byPoster.get("ALT")!.installedManifest?.origin?.source).toBe(`${fx.base}/alt/`)
    fx.srv.stop()
  })

  test("legacy name fallback is deliberate and colliding names stay ambiguous", async () => {
    const fx = fixture()
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), `${JSON.stringify({ eikon: 1, name: "ares" })}\n`)

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const rows = state.rows.filter(r => r.entry.name === "ares")
    expect(rows.every(r => r.installed)).toBe(true)
    expect(rows.every(r => r.installState === "legacy-name-match")).toBe(true)
    fx.srv.stop()
  })

  test("flat legacy files do not satisfy marketplace installed state", async () => {
    const fx = fixture()
    mkdirSync(join(HH, "eikons"), { recursive: true })
    writeFileSync(join(HH, "eikons", "mono.eikon"), launch)

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    expect(state.rows.find(r => r.entry.name === "mono")!.installed).toBe(false)
    fx.srv.stop()
  })

  test("available rows are installable when no eikon is active", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const row = state.rows.find(r => r.entry.name === "mono")!

    expect(row.installed).toBe(false)
    expect(row.active).toBe(false)
    expect(row.installState).toBe("available")
    expect(row.action).toBe("install")
    fx.srv.stop()
  })

  test("legacy name fallback is not suppressed by unrelated keyed installs", async () => {
    const fx = fixture()
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), `${JSON.stringify({ eikon: 1, name: "ares", source_url: `${fx.base}/alt/` })}\n`)
    eikon.ensure("mono")
    writeFileSync(eikon.file("mono"), `${JSON.stringify({ eikon: 1, name: "mono" })}\n`)

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const mono = state.rows.find(r => r.entry.name === "mono")!
    const alt = state.rows.find(r => r.entry.poster === "ALT")!
    const ares = state.rows.find(r => r.entry.poster === "ARES")!

    expect(mono.installed).toBe(true)
    expect(mono.installState).toBe("legacy-name-match")
    expect(alt.installed).toBe(true)
    expect(ares.installed).toBe(false)
    fx.srv.stop()
  })

  test("preview loads selected entry with cache and abort support", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const svc = state.service!
    const row = state.rows[0]!

    expect(await svc.preview(row.entry.identityKey)).toBe(launch)
    expect(await svc.preview(row.entry.identityKey)).toBe(launch)
    expect(fx.seen.filter(p => p.endsWith("ares.eikon"))).toHaveLength(1)

    const ctl = new AbortController()
    ctl.abort()
    await expect(svc.preview(state.rows[1]!.entry.identityKey, { signal: ctl.signal })).rejects.toThrow(/aborted/i)
    fx.srv.stop()
  })

  test("preview deduplicates concurrent requests and caps cached entries", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true, previewCacheLimit: 1 })
    const svc = state.service!
    const ares = state.rows.find(r => r.entry.poster === "ARES")!
    const mono = state.rows.find(r => r.entry.name === "mono")!

    const [left, right] = await Promise.all([
      svc.preview(ares.entry.identityKey),
      svc.preview(ares.entry.identityKey),
    ])
    expect(left).toBe(launch)
    expect(right).toBe(launch)
    expect(fx.seen.filter(p => p.endsWith("ares.eikon"))).toHaveLength(1)

    expect(await svc.preview(mono.entry.identityKey)).toBe(launch)
    expect(await svc.preview(ares.entry.identityKey)).toBe(launch)
    expect(fx.seen.filter(p => p.endsWith("ares.eikon"))).toHaveLength(2)
    fx.srv.stop()
  })

  test("preview limits concurrent network loads", async () => {
    let active = 0
    let peak = 0
    const pending: (() => void)[] = []
    const waits: (() => void)[] = []
    const waitForFetch = () => pending.length > 0 ? Promise.resolve() : new Promise<void>(resolve => waits.push(resolve))
    const cat: Catalog = {
      base: "https://example.com/eikons",
      entries: ["one", "two", "three"].map(name => entry({ name })),
      load: async () => "",
    }
    const svc = new market.MarketplaceService(cat, {
      concurrency: 1,
      fetcher: async input => {
        active += 1
        peak = Math.max(peak, active)
        const done = waits.shift()
        if (done) done()
        await new Promise<void>(resolve => pending.push(resolve))
        active -= 1
        return new Response(String(input))
      },
    })

    const xs = cat.entries.map(e => svc.preview(e.identityKey))
    await waitForFetch()
    expect(active).toBe(1)
    pending.shift()!()
    await waitForFetch()
    expect(active).toBe(1)
    pending.shift()!()
    await waitForFetch()
    expect(active).toBe(1)
    pending.shift()!()

    await Promise.all(xs)
    expect(peak).toBe(1)
  })

  test("marketplace install writes files, bumps revision, and does not activate", async () => {
    const fx = fixture()
    prefs.set("eikon", "old")
    const before = eikon.revision()
    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const out = await state.service!.install(state.rows[0]!.entry.identityKey)

    expect(out.name).toBe("ares")
    expect(existsSync(eikon.file("ares"))).toBe(true)
    expect(existsSync(join(eikon.sourceDir("ares"), "base.png"))).toBe(false)
    expect(prefs.get("eikon")).toBe("old")
    expect(eikon.revision()).toBe(before + 1)
    const man = JSON.parse(readFileSync(join(eikon.dir("ares"), "manifest.json"), "utf8"))
    expect(man.origin.source).toBe(`${fx.base}/ares/manifest.json`)
    fx.srv.stop()
  })

  test("marketplace installs launch package catalog entries from explicit manifest URLs", async () => {
    const pkgManifest = {
      kind: "eikon.package",
      schemaVersion: "1.0",
      id: "liftaris/pkg",
      version: "1.0.0",
      name: "pkg",
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "streams/pkg.eikon" },
      files: [
        { path: "streams/pkg.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: launch.length, digest: digest(launch) },
        { path: "source/base.png", role: "source.base", mediaType: "image/png", size: png.length, digest: digest(png) },
        { path: "source/idle.mp4", role: "source.clip", mediaType: "video/mp4", size: 8, digest: digest(new Uint8Array(8)) },
      ],
      source: { base: "source/base.png", states: { idle: { file: "source/idle.mp4" } } },
    }
    const srv = serve([
      { path: "/eikons/index.json", body: req => {
        const u = new URL(req.url)
        return [catalogRow({
          id: "liftaris/pkg",
          version: "1.0.0",
          name: "pkg",
          source: "packages/pkg/",
          sourceKey: `registry:${u.host}:liftaris/pkg@1.0.0`,
          runtimeUrl: "streams/pkg.eikon",
          packageUrl: "manifest.json",
        }, `${u.origin}/eikons/`)]
      } },
      { path: "/eikons/packages/pkg/manifest.json", body: pkgManifest },
      { path: "/eikons/packages/pkg/streams/pkg.eikon", body: launch },
      { path: "/eikons/packages/pkg/source/base.png", body: png },
      { path: "/eikons/packages/pkg/source/idle.mp4", body: new Uint8Array(8) },
    ])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    expect(state.status).toBe("ready")
    const out = await state.service!.install(state.rows[0]!.entry.identityKey, { media: true })

    expect(out.name).toBe("pkg")
    expect(existsSync(eikon.file("pkg"))).toBe(true)
    expect(existsSync(join(eikon.sourceDir("pkg"), "base.png"))).toBe(true)
    expect(existsSync(join(eikon.sourceDir("pkg"), "idle.mp4"))).toBe(true)
    expect(JSON.parse(readFileSync(eikon.file("pkg"), "utf8").split("\n", 1)[0]!).type).toBe("header")
    srv.stop()
  })

  test("marketplace install binds verified catalog trust to fetched package manifest", async () => {
    const good = pack("ares")
    const evil = pack("ares", launch.replace("abcd", "EVIL"))
    const srv = serve([
      { path: "/eikons/index.json", body: req => [catalogRow({
        name: "ares",
        source: "ares/",
        trust: { manifestDigest: digest(JSON.stringify(good)), runtimeDigest: digest(launch) },
      }, `${new URL(req.url).origin}/eikons/`)] },
      { path: "/eikons/ares/manifest.json", body: evil },
      { path: "/eikons/ares/ares.eikon", body: launch.replace("abcd", "EVIL") },
      { path: "/eikons/ares/source.png", body: png },
    ])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })

    await expect(state.service!.install(state.rows[0]!.entry.identityKey)).rejects.toThrow(/catalog trust mismatch: manifest digest/)
    expect(existsSync(eikon.file("ares"))).toBe(false)
    srv.stop()
  })

  test("marketplace install records verified trust after catalog digest binding", async () => {
    const man = pack("ares")
    const srv = serve([
      { path: "/eikons/index.json", body: req => [catalogRow({
        name: "ares",
        source: "ares/",
        trust: { manifestDigest: digest(JSON.stringify(man)), runtimeDigest: digest(launch) },
      }, `${new URL(req.url).origin}/eikons/`)] },
      { path: "/eikons/ares/manifest.json", body: man },
      { path: "/eikons/ares/ares.eikon", body: launch },
      { path: "/eikons/ares/source.png", body: png },
    ])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    await state.service!.install(state.rows[0]!.entry.identityKey)

    const got = JSON.parse(readFileSync(join(eikon.dir("ares"), "manifest.json"), "utf8"))
    expect(got.origin.trust).toBe("verified")
    srv.stop()
  })

  test("preview enforces private-host policy outside explicit private mode", async () => {
    let seen = 0
    const cat: Catalog = {
      base: "https://example.com/eikons",
      entries: [entry({ name: "secret", preview: "http://127.0.0.1:65530/secret.eikon" })],
      load: async () => "",
    }
    const svc = new market.MarketplaceService(cat, { fetcher: async () => { seen += 1; return new Response(launch) } })

    await expect(svc.preview(cat.entries[0]!.identityKey)).rejects.toThrow(/private host/)
    expect(seen).toBe(0)

    const dev = new market.MarketplaceService(cat, { allowPrivate: true, fetcher: async () => { seen += 1; return new Response(launch) } })
    expect(await dev.preview(cat.entries[0]!.identityKey)).toBe(launch)
    expect(seen).toBe(1)
  })

  test("rows expose installed record name instead of trusting manifest name", async () => {
    const fx = fixture()
    eikon.ensure("local")
    writeFileSync(eikon.file("local"), '{"eikon":1,"name":"local"}\n')
    writeFileSync(join(eikon.dir("local"), "manifest.json"), JSON.stringify({
      kind: "eikon.package",
      id: "liftaris/ares",
      name: "victim",
      origin: { sourceKey: `${fx.base}/ares/`, identityKey: `${fx.base}/ares/`, packageUrl: `${fx.base}/ares/manifest.json` },
    }))

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const row = state.rows.find(r => r.entry.poster === "ARES")!

    expect(row.installed).toBe(true)
    expect(row.installedName).toBe("local")
    expect(row.installedManifest?.name).toBe("victim")
    fx.srv.stop()
  })

  test("failed marketplace install is retryable and does not activate or mark installed", async () => {
    const srv = serve([
      { path: "/eikons/index.json", body: req => [catalogRow({ name: "bad", poster: "B", source: "bad/" }, `${new URL(req.url).origin}/eikons/`)] },
      { path: "/eikons/bad/manifest.json", body: "missing", status: 404 },
    ])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    await expect(state.service!.install(state.rows[0]!.entry.identityKey)).rejects.toThrow(/download failed 404/)
    expect(prefs.get("eikon")).toBeUndefined()
    expect(eikon.list().some(x => x.name === "bad")).toBe(false)
    srv.stop()
  })

  test("empty and no-results states are stable", async () => {
    const srv = serve([{ path: "/eikons/index.json", body: [] }])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true, query: "none" })
    expect(state.status).toBe("empty")
    expect(state.rows).toEqual([])
    expect(state.selected).toBeUndefined()
    srv.stop()
  })

  test("rows expose lifecycle source, trust, removable, and compatibility state", async () => {
    const fx = fixture()
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), '{"eikon":1,"name":"ares"}\n')
    writeFileSync(join(eikon.dir("ares"), "manifest.json"), JSON.stringify({
      kind: "eikon.package",
      id: "liftaris/ares",
      name: "ares",
      version: "2.0.0",
      display: { title: "Ares", author: "Kaio" },
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "ares.eikon" },
      origin: { source: `${fx.base}/ares/manifest.json`, at: "2026-06-07T00:00:00.000Z", kind: "default-catalog", trust: "verified", sourceKey: `${fx.base}/ares/`, packageUrl: `${fx.base}/ares/manifest.json` },
    }, null, 2))

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const row = state.rows.find(r => r.entry.poster === "ARES")!

    expect(row.installState).toBe("installed")
    expect(row.lifecycle.title).toBe("Ares")
    expect(row.lifecycle.version).toBe("2.0.0")
    expect(row.trust).toBe("verified")
    expect(row.sourceIdentity).toBe(`${fx.base}/ares/`)
    expect(row.removable).toBe(true)
    expect(row.updateable).toBe(true)
    fx.srv.stop()
  })

  test("installed source download state follows package source descriptors", async () => {
    const runtime = pack("runtime")
    delete (runtime as { source?: unknown }).source
    runtime.files = runtime.files.filter(f => f.role === "runtime")
    const sourced = pack("sourced")
    const cat: Catalog = {
      base: "https://example.com/eikons",
      entries: [
        entry({ name: "runtime", packageUrl: "https://example.com/eikons/runtime/manifest.json" }),
        {
          ...entry({ name: "sourced", packageUrl: "https://example.com/eikons/sourced/manifest.json" }),
          raw: { name: "sourced", manifest: sourced, packageUrl: "https://example.com/eikons/sourced/manifest.json" },
        },
      ],
      load: async () => "",
    }
    eikon.ensure("runtime")
    writeFileSync(eikon.file("runtime"), '{"eikon":1,"name":"runtime"}\n')
    writeFileSync(join(eikon.dir("runtime"), "manifest.json"), JSON.stringify({
      ...runtime,
      origin: { sourceKey: "https://example.com/eikons/runtime/", identityKey: "https://example.com/eikons/runtime/", packageUrl: "https://example.com/eikons/runtime/manifest.json" },
    }, null, 2))
    eikon.ensure("sourced")
    writeFileSync(eikon.file("sourced"), '{"eikon":1,"name":"sourced"}\n')
    writeFileSync(join(eikon.dir("sourced"), "manifest.json"), JSON.stringify({
      ...sourced,
      origin: { sourceKey: "https://example.com/eikons/sourced/", identityKey: "https://example.com/eikons/sourced/", packageUrl: "https://example.com/eikons/sourced/manifest.json" },
    }, null, 2))
    const svc = new market.MarketplaceService(cat, { fetcher: async () => new Response(JSON.stringify(runtime)) })
    const rows = svc.rows()
    const run = rows.find(r => r.entry.name === "runtime")!
    const src = rows.find(r => r.entry.name === "sourced")!

    expect(run.sourceAvailable).toBe(false)
    expect(run.sourceDownloadable).toBe(false)
    expect(src.sourceAvailable).toBe(true)
    expect(src.sourceDownloadable).toBe(true)
    await expect(svc.downloadSource(run.entry.identityKey)).rejects.toThrow(/no source media published/)
  })

  test("available catalog rows require descriptor digests for verified trust", async () => {
    const cat: Catalog = {
      base: "https://example.com/eikons",
      entries: [
        entry({ name: "legacy", trust: {} }),
        entry({ name: "partial", trust: { manifestDigest: digest("manifest") } }),
        entry({ name: "signed", trust: { manifestDigest: digest("manifest"), runtimeDigest: digest(launch) } }),
      ],
      load: async () => "",
    }
    const svc = new market.MarketplaceService(cat)
    const rows = svc.rows()

    expect(rows.find(r => r.entry.name === "legacy")!.trust).toBe("unverified")
    expect(rows.find(r => r.entry.name === "partial")!.trust).toBe("unverified")
    expect(rows.find(r => r.entry.name === "signed")!.trust).toBe("verified")
  })

  test("incompatible rows are blocked before install", async () => {
    const cat: Catalog = {
      base: "https://example.com/eikons",
      entries: [{ ...entry({ name: "future" }), compatibility: { eikon: ">=99", available: false, reason: "requires newer Herm" } }],
      load: async () => "",
    }
    const svc = new market.MarketplaceService(cat)
    const row = svc.rows()[0]!

    expect(row.installState).toBe("incompatible")
    expect(row.reason).toBe("requires newer Herm")
    await expect(svc.install(row.entry.identityKey)).rejects.toThrow(/requires newer Herm/)
  })
})
