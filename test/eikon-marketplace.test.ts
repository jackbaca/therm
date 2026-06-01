import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Catalog, CatalogIndexEntry } from "eikon"
import * as market from "../src/service/eikon-marketplace"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

const body = "{\"eikon\":1,\"name\":\"ares\",\"author\":\"Kaio\",\"width\":48,\"height\":24}\n"
const png = new Uint8Array([137, 80, 78, 71])

type Route = { path: string; body: BodyInit | object; status?: number; headers?: HeadersInit }

function serve(routes: Route[], seen: string[] = []) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      seen.push(path)
      const hit = routes.find(r => r.path === path)
      if (!hit) return new Response("404", { status: 404 })
      if (typeof hit.body === "object" && !(hit.body instanceof Uint8Array))
        return Response.json(hit.body, { status: hit.status ?? 200, headers: hit.headers })
      return new Response(hit.body as BodyInit, { status: hit.status ?? 200, headers: hit.headers })
    },
  })
}

function fixture() {
  const seen: string[] = []
  const srv = serve([
    { path: "/eikons/index.json", body: [
      { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES", source: "ares/", preview_url: "ares.eikon", install_url: "", license: "MIT", provenance: "repo", reviewed: true },
      { name: "mono", author: "Nous", width: 48, height: 24, poster: "MONO", source: "mono/", preview_url: "mono.eikon", install_url: "" },
      { name: "ares", author: "Other", width: 48, height: 24, poster: "ALT", source: "alt/", preview_url: "ares.eikon", install_url: "" },
    ] },
    { path: "/eikons/ares/ares.eikon", body },
    { path: "/eikons/ares/manifest.json", body: { name: "ares", source: "source.png" } },
    { path: "/eikons/ares/source.png", body: png },
    { path: "/eikons/mono/mono.eikon", body: body.replace("ares", "mono") },
    { path: "/eikons/mono/manifest.json", body: { name: "mono", source: "source.png" } },
    { path: "/eikons/mono/source.png", body: png },
    { path: "/eikons/alt/ares.eikon", body: body.replace("Kaio", "Other") },
    { path: "/eikons/alt/manifest.json", body: { name: "ares", source: "source.png" } },
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
      license: "Apache-2.0",
      provenance: "fixture",
    }, null, 2))
    prefs.set("eikon", "ares")

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const byPoster = new Map(state.rows.map(r => [r.entry.poster, r]))
    expect(byPoster.get("ALT")!.installed).toBe(true)
    expect(byPoster.get("ALT")!.active).toBe(true)
    expect(byPoster.get("ARES")!.installed).toBe(false)
    expect(byPoster.get("ALT")!.installedManifest?.license).toBe("Apache-2.0")
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
    writeFileSync(join(HH, "eikons", "mono.eikon"), body.replace("ares", "mono"))

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

    expect(await svc.preview(row.entry.identityKey)).toBe(body)
    expect(await svc.preview(row.entry.identityKey)).toBe(body)
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
    expect(left).toBe(body)
    expect(right).toBe(body)
    expect(fx.seen.filter(p => p.endsWith("ares.eikon"))).toHaveLength(1)

    expect(await svc.preview(mono.entry.identityKey)).toContain("mono")
    expect(await svc.preview(ares.entry.identityKey)).toBe(body)
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
      entries: ["one", "two", "three"].map(name => ({
        name,
        author: "Kaio",
        width: 48,
        height: 24,
        w: 48,
        h: 24,
        poster: name,
        trust: {},
        identityKey: `https://example.com/${name}/`,
        sourceKey: `https://example.com/${name}/`,
        raw: { name } satisfies CatalogIndexEntry,
        installUrl: `https://example.com/${name}/manifest.json`,
        previewUrl: `https://example.com/${name}/${name}.eikon`,
      })),
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
    expect(existsSync(join(eikon.sourceDir("ares"), "base.png"))).toBe(true)
    expect(prefs.get("eikon")).toBe("old")
    expect(eikon.revision()).toBe(before + 1)
    const man = JSON.parse(readFileSync(join(eikon.dir("ares"), "manifest.json"), "utf8"))
    expect(man.origin.source).toBe(`${fx.base}/ares/`)
    fx.srv.stop()
  })

  test("failed marketplace install is retryable and does not activate or mark installed", async () => {
    const srv = serve([
      { path: "/eikons/index.json", body: [{ name: "bad", poster: "B", source: "bad/", install_url: "", preview_url: "bad.eikon" }] },
      { path: "/eikons/bad/manifest.json", body: "missing", status: 404 },
    ])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    await expect(state.service!.install(state.rows[0]!.entry.identityKey)).rejects.toThrow(/manifest: HTTP 404/)
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

  test("unsafe public catalog URLs are rejected before fetch", async () => {
    const state = await market.load({ catalog: "http://127.0.0.1/eikons" })
    expect(state.status).toBe("error")
    expect(state.error).toContain("private host")
  })
})
