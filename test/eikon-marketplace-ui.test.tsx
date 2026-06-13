import { describe, expect, test, afterEach } from "bun:test"
import { act } from "react"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { mount, mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
const launchBody = (name: string, author: string, frames: Record<string, string>) => {
  const rows = (line: string) => Array.from({ length: 24 }, (_, i) => (i === 0 ? line : "").padEnd(48))
  return [
    JSON.stringify({
      type: "header", eikon: 1, id: `liftaris/${name}`, version: "1.0", title: name,
      author: { name: author }, size: { cols: 48, rows: 24 }, defaultSignal: "state.idle",
      signals: Object.fromEntries(Object.keys(frames).map(state => [
        `state.${state}`,
        state === "idle" ? { clip: state } : { clip: state, fallback: "state.idle" },
      ])),
    }),
    ...Object.entries(frames).flatMap(([state, frame]) => [
      JSON.stringify({ type: "clip", name: state, fps: 1, frameCount: 1, loopFrom: 0 }),
      JSON.stringify({ type: "frame", clip: state, index: 0, rows: rows(frame) }),
    ]),
  ].join("\n") + "\n"
}
const body = launchBody("ares", "Kaio", { idle: "ARES-IDLE", thinking: "ARES-THINKING" })
const monoBody = launchBody("mono", "Nous", { idle: "MONO-IDLE" })
const nousBody = launchBody("nous", "Kaio", { idle: "NOUS-IDLE" })
const digest = (data: string | Uint8Array) => `sha256:${createHash("sha256").update(data).digest("hex")}`
const png = new Uint8Array([137, 80, 78, 71])
const servers = new Set<ReturnType<typeof Bun.serve>>()
const baseTestPerf = process.env.HERM_TEST_PERF
const baseAvatarTimerStarts = globalThis.__hermAvatarTimerStarts

type Route = { path: string; body: BodyInit | object; status?: number; headers?: HeadersInit }

function serve(routes: Route[]) {
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      const hit = routes.findLast(r => r.path === path)
      if (!hit) return new Response("404", { status: 404 })
      if (typeof hit.body === "object" && !(hit.body instanceof Uint8Array))
        return Response.json(hit.body, { status: hit.status ?? 200, headers: hit.headers })
      return new Response(hit.body as BodyInit, { status: hit.status ?? 200, headers: hit.headers })
    },
  })
  servers.add(srv)
  return srv
}

function catalog(extra: Route[] = []) {
  const aresManifest = {
    kind: "eikon.package", schemaVersion: "1.0", id: "liftaris/ares", name: "ares", version: "1.0.0",
    display: { title: "Ares", author: "Kaio", description: "red warrior" },
    compatibility: { eikon: ">=1 <2" }, entrypoints: { default: "ares.eikon" },
    files: [
      { path: "ares.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: body.length, digest: digest(body) },
      { path: "source/base.png", role: "source.base", mediaType: "image/png", size: png.length, digest: digest(png) },
    ],
    source: { base: "source/base.png" },
  }
  const monoManifest = {
    ...aresManifest,
    id: "liftaris/mono", name: "mono",
    display: { title: "Mono", author: "Nous", description: "quiet lines" },
    entrypoints: { default: "mono.eikon" },
    files: [
      { path: "mono.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: monoBody.length, digest: digest(monoBody) },
      { path: "source/base.png", role: "source.base", mediaType: "image/png", size: png.length, digest: digest(png) },
    ],
  }
  const srv = serve([
    { path: "/eikons/index.json", body: [
      { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", description: "red warrior" },
      { name: "mono", author: "Nous", width: 48, height: 24, poster: "MONO-POSTER", source: "mono/", description: "quiet lines" },
      { name: "delta", author: "Other", width: 48, height: 24, poster: "DELTA-POSTER", source: "delta/", description: "triangle field" },
      { name: "echo", author: "Echo", width: 48, height: 24, poster: "ECHO-POSTER", source: "echo/", description: "sound wall" },
      { name: "foxtrot", author: "Fox", width: 48, height: 24, poster: "FOX-POSTER", source: "foxtrot/", description: "fox field" },
      { name: "gamma", author: "Gamma", width: 48, height: 24, poster: "GAMMA-POSTER", source: "gamma/", description: "green field" },
    ] },
    { path: "/eikons/ares/ares.eikon", body },
    { path: "/eikons/ares/manifest.json", body: aresManifest },
    { path: "/eikons/ares/source/base.png", body: png },
    { path: "/eikons/mono/mono.eikon", body: monoBody },
    { path: "/eikons/mono/manifest.json", body: monoManifest },
    { path: "/eikons/mono/source/base.png", body: png },
    ...extra,
  ])
  return { srv, base: `http://localhost:${srv.port}/eikons` }
}

function local(name: string) {
  const p = eikon.ensure(name)
  writeFileSync(join(p.source, "base.png"), png)
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, author: "Local", width: 48, height: 24 }) + "\n")
}

function packageCatalog(extra: Route[] = []) {
  const runtime = {
    kind: "eikon.package", schemaVersion: "1.0", id: "liftaris/ares", name: "ares", version: "1.0.0",
    display: { title: "Ares", author: "Kaio", description: "red warrior" },
    compatibility: { eikon: ">=1 <2" }, entrypoints: { default: "ares.eikon" },
    files: [{ path: "ares.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: body.length, digest: digest(body) }], poster: "poster.txt",
  }
  const source = {
    ...runtime,
    id: "liftaris/mono",
    name: "mono",
    display: { title: "Mono", author: "Nous", description: "quiet lines" },
    entrypoints: { default: "mono.eikon" },
    files: [
      { path: "mono.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: monoBody.length, digest: digest(monoBody) },
      { path: "source/base.png", role: "source.base", mediaType: "image/png", size: png.length, digest: digest(png) },
    ],
    source: { base: "source/base.png" },
  }
  const srv = serve([
    { path: "/eikons/index.json", body: [
      {
        name: "ares", author: "Kaio", description: "red warrior", poster: "ARES-POSTER", source: "ares/",
        trust: { manifestDigest: "sha256:manifest", runtimeDigest: digest(body) },
      },
      { manifest: source, packageUrl: "mono/manifest.json" },
    ] },
    { path: "/eikons/ares/manifest.json", body: runtime },
    { path: "/eikons/ares/ares.eikon", body },
    { path: "/eikons/mono/manifest.json", body: source },
    { path: "/eikons/mono/mono.eikon", body: monoBody },
    { path: "/eikons/mono/source/base.png", body: png },
    ...extra,
  ])
  return { srv, base: `http://localhost:${srv.port}/eikons` }
}

function group(props: { sub?: number } = {}) {
  let sub = props.sub ?? 2
  return <EikonGroup focused sub={sub} setSub={i => { sub = i }} />
}

async function openMarketplaceTab(t: Awaited<ReturnType<typeof mount>>) {
  act(() => t.keys.pressKey("5", { meta: true }))
  await until(t, () => t.frame().includes("Library ("))
  act(() => t.keys.pressArrow("right", { shift: true }))
  act(() => t.keys.pressArrow("right", { shift: true }))
  await until(t, () => t.frame().includes("Catalog ("))
}

afterEach(() => {
  for (const srv of servers) {
    try { srv.stop() } catch {}
  }
  servers.clear()
  if (baseTestPerf === undefined) delete process.env.HERM_TEST_PERF
  else process.env.HERM_TEST_PERF = baseTestPerf
  if (baseAvatarTimerStarts === undefined) delete globalThis.__hermAvatarTimerStarts
  else globalThis.__hermAvatarTimerStarts = baseAvatarTimerStarts
  delete process.env.EIKON_URL
  prefs.set("eikon", undefined)
  rmSync(join(HH, "eikons"), { recursive: true, force: true })
})

describe("EikonMarketplace tab", () => {
  test("Library is separate from Marketplace tab", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group({ sub: 0 }), { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Library ("))
    expect(t.frame()).not.toContain("[ Catalog ]")
    expect(t.frame()).not.toContain("ARES-POSTER")
    fx.srv.stop()
  })

  test("poster grid does not fetch previews or start per-card avatar timers", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    const prevTestPerf = process.env.HERM_TEST_PERF
    process.env.HERM_TEST_PERF = "1"
    globalThis.__hermAvatarTimerStarts = 0
    const startsBefore = globalThis.__hermAvatarTimerStarts ?? 0
    await using t = await mountNode(group(), { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Catalog (6)") && t.frame().includes("ARES-POSTER"))

    expect((globalThis.__hermAvatarTimerStarts ?? 0) - startsBefore).toBe(0)
    delete globalThis.__hermAvatarTimerStarts
    if (prevTestPerf === undefined) delete process.env.HERM_TEST_PERF
    else process.env.HERM_TEST_PERF = prevTestPerf
    fx.srv.stop()
  })

  test("poster cards reserve the full ASCII thumbnail height", async () => {
    const poster = Array.from({ length: 24 }, (_, i) => `ARES-${String(i).padStart(2, "0")}`).join("\n")
    const fx = catalog([{ path: "/eikons/index.json", body: [
      { name: "ares", author: "Kaio", width: 48, height: 24, poster, source: "ares/", description: "red warrior" },
    ] }])
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 120, height: 36 })
    await until(t, () => t.frame().includes("Catalog (1)") && t.frame().includes("ARES-23"))
    expect(t.frame()).toContain("by Kaio")
    fx.srv.stop()
  })

  test("catalog grid wraps more than two cards when space allows", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 300, height: 36 })
    await until(t, () => t.frame().includes("Catalog (6)") && t.frame().includes("DELTA-POSTER"))
    const line = t.frame().split("\n").find(l => l.includes("ARES-POSTER")) ?? ""
    expect(line).toContain("MONO-POSTER")
    expect(line).toContain("DELTA-POSTER")
    fx.srv.stop()
  })

  test("searches by author and Escape exits search without leaving the tab", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Catalog (6)") && t.frame().includes("ARES-POSTER"))
    expect(t.frame()).toContain("red warrior")
    expect(t.frame()).toContain("Digest")
    expect(t.frame()).toContain("unknown")
    expect(t.frame()).toContain("Open actions")

    await act(async () => { await t.keys.typeText("/") })
    await until(t, () => t.frame().includes("Search:"))
    await act(async () => { await t.keys.typeText("nous") })
    await until(t, () => t.frame().includes("Catalog (1)") && t.frame().includes("mono"))
    expect(t.frame()).not.toContain("ares  Kaio")

    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Catalog (1)") && !t.frame().includes("Search:"))
    fx.srv.stop()
  })

  test("Enter opens install modal, default installs, then installed modal uses", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    mkdirSync(join(HH, "eikons"), { recursive: true })
    local("localone")
    prefs.set("eikon", "localone")
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Catalog (6)") && t.frame().includes("Open actions"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Eikon only"))
    act(() => t.keys.pressEnter())
    await until(t, () => eikon.list().some(x => x.name === "ares") && t.frame().includes("installed") && prefs.get("eikon") === "localone")
    expect(eikon.list().find(x => x.name === "ares")!.hasSource).toBe(false)

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("set as active avatar"))
    act(() => t.keys.pressEnter())
    await until(t, () => prefs.get("eikon") === "ares" && t.frame().includes("▸ ● ares"))
    expect(t.frame()).toContain("▸ ● ares")
    fx.srv.stop()
  })

  test("Marketplace details expose runtime-only package lifecycle truthfully", async () => {
    const fx = packageCatalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 120, height: 48 })
    await until(t, () => t.frame().includes("Catalog (2)") && t.frame().includes("Unverified"))
    expect(t.frame()).toContain("Source")
    expect(t.frame()).toContain("Compat: Compatible")
    expect(t.frame()).toContain("Open actions")

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Eikon only"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("installed") && t.frame().includes("removable"))
    expect(t.frame()).not.toContain("source downloadable")
    expect(prefs.get("eikon")).toBeUndefined()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("set as active avatar"))
    expect(t.frame()).not.toContain("Download Source")

    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Remove 'ares'?"))
    expect(t.frame()).toContain("This does not")
    expect(t.frame()).toContain("change the active avatar")
    expect(t.frame()).not.toContain("This cannot be undone")
    act(() => t.keys.pressKey("y"))
    await until(t, () => t.frame().includes("Install") && !eikon.list().some(x => x.name === "ares"))
    fx.srv.stop()
  })

  test("bundled Nous registry row is active without replace prompt", async () => {
    const man = {
      kind: "eikon.package", schemaVersion: "1.0", id: "liftaris/nous", name: "nous", version: "1.0.0",
      display: { title: "Nous", author: "Kaio" }, compatibility: { eikon: ">=1 <2" }, entrypoints: { default: "nous.eikon" },
      files: [{ path: "nous.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: nousBody.length, digest: digest(nousBody) }],
    }
    const srv = serve([
      { path: "/eikons/index.json", body: [{ manifest: man, packageUrl: "nous/manifest.json", sourceKey: "registry:eikon.liftaris.dev:liftaris/nous@1.0.0" }] },
      { path: "/eikons/nous/manifest.json", body: man },
      { path: "/eikons/nous/nous.eikon", body: nousBody },
    ])
    process.env.EIKON_URL = `http://localhost:${srv.port}/eikons`
    prefs.set("eikon", "nous")
    await using t = await mountNode(group(), { width: 140, height: 40 })

    await until(t, () => t.frame().includes("Catalog (1)") && t.frame().includes("▸ ● nous") && t.frame().includes("active"))
    expect(t.frame()).not.toContain("active name conflict")
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Download Source") || t.frame().includes("No available actions."))
    expect(t.frame()).not.toContain("Replace active 'nous'?")
    expect(t.frame()).not.toContain("Eikon only")
    srv.stop()
  })

  test("detail preview does not claim runtime-only installed packages have source", async () => {
    const fx = packageCatalog()
    process.env.EIKON_URL = fx.base
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), body)
    writeFileSync(join(eikon.dir("ares"), "manifest.json"), JSON.stringify({
      kind: "eikon.package", schemaVersion: "1.0", id: "liftaris/ares", name: "ares", version: "1.0.0",
      compatibility: { eikon: ">=1 <2" }, entrypoints: { default: "ares.eikon" },
      files: [{ path: "ares.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: body.length, digest: digest(body) }],
      origin: { sourceKey: `${fx.base}/ares/`, identityKey: `${fx.base}/ares/`, packageUrl: `${fx.base}/ares/manifest.json` },
    }, null, 2))
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Catalog (2)") && t.frame().includes("installed"))
    expect(t.frame()).toContain("installed")
    expect(t.frame()).not.toContain("source available")
    expect(t.frame()).not.toContain("source downloadable")
    fx.srv.stop()
  })

  test("source-bearing installed package offers source download action", async () => {
    const fx = packageCatalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 40 })
    await until(t, () => t.frame().includes("Catalog (2)") && t.frame().includes("mono"))
    act(() => t.keys.pressArrow("right"))
    await until(t, () => /▸ .*mono/.test(t.frame()))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Eikon only"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("source downloadable") && t.frame().includes("removable"))
    expect(eikon.list().find(x => x.name === "mono")!.hasSource).toBe(false)

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Download Source"))
    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressKey(" "))
    await until(t, () => eikon.list().find(x => x.name === "mono")!.hasSource)
    fx.srv.stop()
  })

  test("active package modal omits already-active and can download source", async () => {
    const fx = packageCatalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 40 })
    await until(t, () => t.frame().includes("Catalog (2)") && t.frame().includes("mono"))
    act(() => t.keys.pressArrow("right"))
    await until(t, () => /▸ .*mono/.test(t.frame()))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Eikon only"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("source downloadable") && t.frame().includes("removable"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("set as active avatar"))
    act(() => t.keys.pressEnter())
    await until(t, () => prefs.get("eikon") === "mono" && t.frame().includes("▸ ● mono"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Download Source") && t.frame().includes("Delete"))
    expect(t.frame()).not.toContain("already active")
    expect(t.frame()).not.toContain("asks before removing")
    act(() => t.keys.pressEnter())
    await until(t, () => eikon.list().find(x => x.name === "mono")!.hasSource)
    expect(eikon.list().some(x => x.name === "mono")).toBe(true)
    expect(prefs.get("eikon")).toBe("mono")
    fx.srv.stop()
  })

  test("installed package without source has no hidden key 2 delete route", async () => {
    const fx = packageCatalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 40 })
    await until(t, () => t.frame().includes("Catalog (2)") && t.frame().includes("Open actions"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Eikon only"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("installed") && t.frame().includes("removable"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Use") && t.frame().includes("Delete"))
    expect(t.frame()).not.toContain("Download Source")
    act(() => t.keys.pressKey("2"))
    await t.settle()
    expect(t.frame()).toContain("Delete")
    expect(t.frame()).not.toContain("Remove 'ares'?")
    expect(eikon.list().some(x => x.name === "ares")).toBe(true)
    fx.srv.stop()
  })

  test("grid navigation clamps and Space does not install", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 180, height: 28 })
    await until(t, () => t.frame().includes("Catalog (6)") && /▸ .*ares/.test(t.frame()))
    expect(t.frame()).toContain("[Space] preview")

    act(() => t.keys.pressArrow("right"))
    await until(t, () => /▸ .*mono/.test(t.frame()))
    act(() => t.keys.pressArrow("down"))
    await until(t, () => /▸ .*echo/.test(t.frame()))
    act(() => t.keys.pressArrow("left"))
    await until(t, () => /▸ .*delta/.test(t.frame()))
    act(() => t.keys.pressArrow("up"))
    await until(t, () => /▸ .*ares/.test(t.frame()))

    act(() => t.keys.pressKey("END"))
    await until(t, () => /▸ .*gamma/.test(t.frame()))
    act(() => t.keys.pressArrow("down"))
    await t.settle()
    expect(t.frame()).toMatch(/▸ .*gamma/)
    act(() => t.keys.pressKey("HOME"))
    await until(t, () => /▸ .*ares/.test(t.frame()))
    await act(async () => { await t.keys.pressKey(" ") })
    await t.settle()
    expect(eikon.list().some(x => x.name === "ares")).toBe(false)
    fx.srv.stop()
  })

  test("detail preview preserves state across selections and falls back when unsupported", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("ARES-IDLE"))

    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => t.frame().includes("ARES-THINKING"))
    expect(t.frame()).toContain("[Space] preview")

    act(() => t.keys.pressArrow("right"))
    await until(t, () => /▸ .*mono/.test(t.frame()) && t.frame().includes("MONO-IDLE"))
    expect(t.frame()).not.toContain("MONO-THINKING")
    expect(prefs.get("eikon")).toBeUndefined()
    fx.srv.stop()
  })

  test("detail pane is keyboard navigable", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("ARES-IDLE") && t.frame().includes("[Tab] details"))
    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("[Tab] catalog"))
    act(() => t.keys.pressArrow("right"))
    await until(t, () => t.frame().includes("ARES-THINKING"))
    act(() => t.keys.pressArrow("down"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Eikon only"))
    fx.srv.stop()
  })

  test("detail preview is omitted on load failure", async () => {
    const fx = catalog([{ path: "/eikons/ares/ares.eikon", body: "missing", status: 500 }])
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Catalog (6)") && t.frame().includes("red warrior"))
    expect(t.frame()).not.toContain("ARES-IDLE")
    fx.srv.stop()
  })

  test("late preview load does not overwrite newer selection", async () => {
    let releaseAres!: (value: Response) => void
    const delayedAres = new Promise<Response>(resolve => { releaseAres = resolve })
    const fx = catalog([{ path: "/eikons/ares/ares.eikon", body: delayedAres as unknown as BodyInit }])
    const stop = fx.srv.stop.bind(fx.srv)
    fx.srv.stop()
    const srv = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname
        if (path === "/eikons/ares/ares.eikon") return delayedAres
        const hit = [
          { path: "/eikons/index.json", body: [
            { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", description: "red warrior" },
            { name: "mono", author: "Nous", width: 48, height: 24, poster: "MONO-POSTER", source: "mono/", description: "quiet lines" },
          ] },
          { path: "/eikons/mono/mono.eikon", body: monoBody },
        ].find(r => r.path === path)
        if (!hit) return new Response("404", { status: 404 })
        if (typeof hit.body === "object" && !(hit.body instanceof Uint8Array)) return Response.json(hit.body)
        return new Response(hit.body as BodyInit)
      },
    })
    servers.add(srv)
    process.env.EIKON_URL = `http://localhost:${srv.port}/eikons`
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Catalog (2)"))
    act(() => t.keys.pressArrow("right"))
    await until(t, () => t.frame().includes("MONO-IDLE"))
    releaseAres(new Response(body))
    await t.settle(); await t.settle()
    expect(t.frame()).toContain("MONO-IDLE")
    expect(t.frame()).not.toContain("ARES-IDLE")
    srv.stop()
    stop()
  })

  test("narrow marketplace renders selected preview in detail pane", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 100, height: 40 })
    await until(t, () => t.frame().includes("Catalog (6)") && t.frame().includes("ARES-IDLE"))
    const lines = t.frame().split("\n")
    const desc = lines.findIndex(l => l.includes("red warrior"))
    const chip = lines.findIndex((l, i) => i > desc && l.includes("idle") && l.includes("thinking"))
    const status = lines.findIndex(l => l.includes("Status"))
    expect(desc).toBeGreaterThan(-1)
    expect(chip).toBeGreaterThan(desc)
    expect(chip).toBeLessThan(status)
    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => t.frame().includes("ARES-THINKING"))
    fx.srv.stop()
  })

  test("wide marketplace always renders detail preview beside the app sidebar", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mount({ width: 180, height: 48 })
    await until(t, () => t.frame().includes("Ready"))
    await openMarketplaceTab(t)

    await until(t, () => t.frame().includes("ARES-IDLE") && t.frame().includes("Profile"))
    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("[Tab] catalog"))
    act(() => t.keys.pressArrow("right"))
    await until(t, () => t.frame().includes("ARES-THINKING"))
    fx.srv.stop()
  })

  test("marketplace row click activates the clicked card without hover", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Catalog (6)") && /▸ .*ares/.test(t.frame()))

    const pos = () => {
      const lines = t.frame().split("\n")
      const y = lines.findIndex(l => l.includes("mono"))
      return { x: Math.max(0, lines[y]?.indexOf("mono") ?? 0), y }
    }
    await act(async () => { const p = pos(); await t.mouse.click(p.x, p.y) })
    await until(t, () => t.frame().includes("Eikon only") && /▸ .*mono/.test(t.frame()))
    expect(eikon.list().some(x => x.name === "ares")).toBe(false)
    expect(eikon.list().some(x => x.name === "mono")).toBe(false)
    fx.srv.stop()
  })
})
