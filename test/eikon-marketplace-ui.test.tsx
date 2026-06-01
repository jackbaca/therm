import { describe, expect, test, afterEach } from "bun:test"
import { act } from "react"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mount, mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
const body = [
  JSON.stringify({ eikon: 1, name: "ares", author: "Kaio", width: 48, height: 24, states: ["idle", "thinking"] }),
  JSON.stringify({ state: "idle", fps: 1, frame_count: 1, loop_from: 1 }),
  JSON.stringify({ f: 0, data: "ARES-IDLE" }),
  JSON.stringify({ state: "thinking", fps: 1, frame_count: 1, loop_from: 1 }),
  JSON.stringify({ f: 0, data: "ARES-THINKING" }),
].join("\n") + "\n"
const monoBody = [
  JSON.stringify({ eikon: 1, name: "mono", author: "Nous", width: 48, height: 24, states: ["idle"] }),
  JSON.stringify({ state: "idle", fps: 1, frame_count: 1, loop_from: 1 }),
  JSON.stringify({ f: 0, data: "MONO-IDLE" }),
].join("\n") + "\n"
const png = new Uint8Array([137, 80, 78, 71])

type Route = { path: string; body: BodyInit | object; status?: number; headers?: HeadersInit }

function serve(routes: Route[]) {
  return Bun.serve({
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
}

function catalog(extra: Route[] = []) {
  const srv = serve([
    { path: "/eikons/index.json", body: [
      { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", preview_url: "ares.eikon", install_url: "", description: "red warrior", license: "MIT", provenance: "registry", review_status: "reviewed" },
      { name: "mono", author: "Nous", width: 48, height: 24, poster: "MONO-POSTER", source: "mono/", preview_url: "mono.eikon", install_url: "", description: "quiet lines", license: "CC0", provenance: "mirror", review_status: "pending" },
      { name: "delta", author: "Other", width: 48, height: 24, poster: "DELTA-POSTER", source: "delta/", preview_url: "delta.eikon", install_url: "", description: "triangle field", reviewed: false },
      { name: "echo", author: "Echo", width: 48, height: 24, poster: "ECHO-POSTER", source: "echo/", preview_url: "echo.eikon", install_url: "", description: "sound wall" },
      { name: "foxtrot", author: "Fox", width: 48, height: 24, poster: "FOX-POSTER", source: "foxtrot/", preview_url: "foxtrot.eikon", install_url: "", description: "fox field" },
      { name: "gamma", author: "Gamma", width: 48, height: 24, poster: "GAMMA-POSTER", source: "gamma/", preview_url: "gamma.eikon", install_url: "", description: "green field" },
    ] },
    { path: "/eikons/ares/ares.eikon", body },
    { path: "/eikons/ares/manifest.json", body: { name: "ares", source: "source.png" } },
    { path: "/eikons/ares/source.png", body: png },
    { path: "/eikons/mono/mono.eikon", body: monoBody },
    { path: "/eikons/mono/manifest.json", body: { name: "mono", source: "source.png" } },
    { path: "/eikons/mono/source.png", body: png },
    ...extra,
  ])
  return { srv, base: `http://localhost:${srv.port}/eikons` }
}

function local(name: string) {
  const p = eikon.ensure(name)
  writeFileSync(join(p.source, "base.png"), png)
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, author: "Local", width: 48, height: 24 }) + "\n")
}

afterEach(() => {
  delete process.env.EIKON_URL
  prefs.set("eikon", undefined)
  rmSync(join(HH, "eikons"), { recursive: true, force: true })
})

describe("EikonGallery marketplace mode", () => {
  test("poster grid does not fetch previews or start per-card avatar timers", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    let sub = 0
    const prevTestPerf = process.env.HERM_TEST_PERF
    process.env.HERM_TEST_PERF = "1"
    globalThis.__hermAvatarTimerStarts = 0
    await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Gallery ("))
    const startsBefore = globalThis.__hermAvatarTimerStarts ?? 0

    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("ARES-POSTER"))

    expect((globalThis.__hermAvatarTimerStarts ?? 0) - startsBefore).toBe(0)
    delete globalThis.__hermAvatarTimerStarts
    if (prevTestPerf === undefined) delete process.env.HERM_TEST_PERF
    else process.env.HERM_TEST_PERF = prevTestPerf
    fx.srv.stop()
  })

  test("enters marketplace, searches by author, Escape exits search then marketplace", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    let sub = 0
    await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Gallery ("))

    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("ARES-POSTER"))
    expect(t.frame()).toContain("red warrior")
    expect(t.frame()).toContain("reviewed")
    expect(t.frame()).toContain("MIT")
    expect(t.frame()).toContain("registry")
    expect(t.frame()).toContain("Install")
    expect(t.frame()).toContain("[Esc] back")

    await act(async () => { await t.keys.typeText("/") })
    await until(t, () => t.frame().includes("Search:"))
    await act(async () => { await t.keys.typeText("nous") })
    await until(t, () => t.frame().includes("Marketplace (1)") && t.frame().includes("mono"))
    expect(t.frame()).not.toContain("ares  Kaio")

    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Marketplace (1)") && !t.frame().includes("Search:"))
    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Gallery (") && !t.frame().includes("Marketplace ("))
    fx.srv.stop()
  })

  test("Enter installs, stays selected, then Enter uses; local gallery can restore prior active", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    mkdirSync(join(HH, "eikons"), { recursive: true })
    local("localone")
    prefs.set("eikon", "localone")
    let sub = 0
    await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Gallery ("))

    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("Install"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Use") && prefs.get("eikon") === "localone")
    expect(t.frame()).toContain("installed")
    expect(t.frame()).toContain("ares")

    act(() => t.keys.pressEnter())
    await until(t, () => prefs.get("eikon") === "ares" && t.frame().includes("Active"))
    expect(t.frame()).toContain("▸ ● ares")

    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Gallery ("))
    for (let i = 0; i < 20; i++) {
      if (t.frame().split("\n").some(l => l.includes("▸") && l.includes("localone"))) break
      act(() => t.keys.pressArrow("down"))
      await t.settle()
    }
    act(() => t.keys.pressEnter())
    await until(t, () => prefs.get("eikon") === "localone")
    fx.srv.stop()
  })

  test("list navigation clamps and Space does not install", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    let sub = 0
    await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Gallery ("))
    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)"))
    expect(t.frame()).toContain("[Space] preview state")

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


  test("sidebar preview preserves state across selections and falls back when unsupported", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    const previews: string[] = []
    let sub = 0
    await using t = await mountNode(
      <EikonGroup focused sub={sub} setSub={i => { sub = i }} sidebarPreview={p => previews.push(p ? `${p.eikon.meta.name}:${p.state}` : "clear")} />,
      { width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Gallery ("))
    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => previews.includes("ares:idle"))

    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => previews.includes("ares:thinking"))
    expect(t.frame()).toContain("[Space] preview state")

    act(() => t.keys.pressArrow("down"))
    await until(t, () => previews.includes("mono:idle"))
    expect(previews).not.toContain("mono:thinking")
    expect(prefs.get("eikon")).toBeUndefined()
    fx.srv.stop()
  })

  test("sidebar preview clears on load failure", async () => {
    const fx = catalog([{ path: "/eikons/ares/ares.eikon", body: "missing", status: 500 }])
    process.env.EIKON_URL = fx.base
    const previews: string[] = []
    let sub = 0
    await using t = await mountNode(
      <EikonGroup focused sub={sub} setSub={i => { sub = i }} sidebarPreview={p => previews.push(p ? p.eikon.meta.name : "clear")} />,
      { width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Gallery ("))
    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)"))
    await until(t, () => previews.includes("clear"))
    expect(previews).not.toContain("ares")
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
            { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", preview_url: "ares.eikon", install_url: "", description: "red warrior" },
            { name: "mono", author: "Nous", width: 48, height: 24, poster: "MONO-POSTER", source: "mono/", preview_url: "mono.eikon", install_url: "", description: "quiet lines" },
          ] },
          { path: "/eikons/mono/mono.eikon", body: monoBody },
        ].find(r => r.path === path)
        if (!hit) return new Response("404", { status: 404 })
        if (typeof hit.body === "object" && !(hit.body instanceof Uint8Array)) return Response.json(hit.body)
        return new Response(hit.body as BodyInit)
      },
    })
    process.env.EIKON_URL = `http://localhost:${srv.port}/eikons`
    const previews: string[] = []
    let sub = 0
    await using t = await mountNode(
      <EikonGroup focused sub={sub} setSub={i => { sub = i }} sidebarPreview={p => previews.push(p ? p.eikon.meta.name : "clear")} />,
      { width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Gallery ("))
    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (2)"))
    act(() => t.keys.pressArrow("down"))
    await until(t, () => previews.includes("mono"))
    releaseAres(new Response(body))
    await t.settle(); await t.settle()
    expect(previews.at(-1)).toBe("mono")
    srv.stop()
    stop()
  })

  test("narrow marketplace renders selected preview in detail pane", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    let sub = 0
    await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 100, height: 40 })
    await until(t, () => t.frame().includes("Gallery ("))
    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("ARES-IDLE"))
    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => t.frame().includes("ARES-THINKING"))
    fx.srv.stop()
  })
  test("wide marketplace renders detail preview when the app sidebar is hidden", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mount({ width: 160, height: 48 })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.keys.pressKey("5", { meta: true }))
    await until(t, () => t.frame().includes("Gallery ("))

    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)"))

    act(() => t.keys.pressKey("x", { ctrl: true }))
    await t.settle()
    await act(async () => { await t.keys.typeText("b") })
    await until(t, () => t.frame().includes("ARES-IDLE"))
    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => t.frame().includes("ARES-THINKING"))
    fx.srv.stop()
  })


  test("Back button exits marketplace by mouse", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    let sub = 0
    await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Gallery ("))

    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("‹ Back"))

    const y = () => t.frame().split("\n").findIndex(l => l.includes("‹ Back"))
    await act(async () => { await t.mouse.click(3, y()) })
    await until(t, () => t.frame().includes("Gallery (") && !t.frame().includes("Marketplace ("))
    fx.srv.stop()
  })

  test("marketplace row click activates the clicked row without hover", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    let sub = 0
    await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Gallery ("))

    await act(async () => { await t.keys.typeText("m") })
    await until(t, () => t.frame().includes("Marketplace (6)") && /▸ .*ares/.test(t.frame()))

    const y = () => t.frame().split("\n").findIndex(l => l.includes("mono") && l.includes("Nous"))
    await act(async () => { await t.mouse.click(4, y()) })
    await until(t, () => eikon.list().some(x => x.name === "mono"))
    expect(eikon.list().some(x => x.name === "ares")).toBe(false)
    expect(t.frame()).toMatch(/▸ .*mono/)
    fx.srv.stop()
  })
})
