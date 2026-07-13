import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import { createHash } from "node:crypto"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mount, mountNode, until } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

let server: ReturnType<typeof Bun.serve> | undefined
const HH = process.env.HERMES_HOME!

const runtime = (name: string, marker: string) => [
  JSON.stringify({
    type: "header", eikon: 1, id: `liftaris/${name}`, version: "1.0", title: name,
    author: { name: "Kaio" }, size: { cols: 48, rows: 24 }, defaultSignal: "state.idle",
    signals: { "state.idle": { clip: "idle" } },
  }),
  JSON.stringify({ type: "clip", name: "idle", fps: 1, frameCount: 1, loopFrom: 0 }),
  JSON.stringify({
    type: "frame", clip: "idle", index: 0,
    rows: Array.from({ length: 24 }, (_, i) => (i === 0 ? marker : "").padEnd(48)),
  }),
].join("\n") + "\n"

const catalog = () => {
  const body = runtime("ares", "ARES-IDLE")
  const seen: string[] = []
  const manifest = {
    kind: "eikon.package", schemaVersion: "1.0", id: "liftaris/ares", name: "ares", version: "1.0.0",
    display: { title: "Ares", author: "Kaio", description: "red warrior" },
    compatibility: { eikon: ">=1 <2" }, entrypoints: { default: "ares.eikon" },
    files: [{
      path: "ares.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl",
      size: body.length, digest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    }],
  }
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      seen.push(path)
      if (path === "/eikons/index.json") return Response.json([
        { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", description: "red warrior" },
      ])
      if (path === "/eikons/ares/manifest.json") return Response.json(manifest)
      if (path === "/eikons/ares/ares.eikon") return new Response(body)
      return new Response("404", { status: 404 })
    },
  })
  process.env.EIKON_URL = `http://localhost:${server.port}/eikons`
  return seen
}

const seed = (name: string, marker: string) => {
  eikon.ensure(name)
  writeFileSync(eikon.file(name), runtime(name, marker))
}

const point = (frame: string, name: string) => {
  const lines = frame.split("\n")
  const y = lines.findIndex(line => line.includes(name))
  if (y < 0) throw new Error(`missing seeded eikon ${name}`)
  return { x: lines[y]!.indexOf(name), y }
}

const count = (frame: string, marker: string) => frame.split(marker).length - 1

afterEach(() => {
  delete process.env.EIKON_URL
  server?.stop()
  server = undefined
  prefs.set("eikon", undefined)
  rmSync(join(HH, "eikons"), { recursive: true, force: true })
})

test("shell navigation reaches the catalog and installation preserves the active selection", async () => {
  const seen = catalog()
  await using t = await mount({ width: 160, height: 48 })

  act(() => t.keys.pressKey("5", { meta: true }))
  await until(t, () => t.frame().toLowerCase().includes("nous"))
  expect(t.frame()).not.toContain("ARES-IDLE")

  act(() => t.keys.pressArrow("right", { shift: true }))
  await until(t, () => t.frame().includes("ARES-IDLE") && t.frame().includes("ARES-POSTER"))

  const before = seen.length
  act(() => t.keys.pressEnter())
  await until(t, () => seen.length > before)
  await t.settle()
  act(() => t.keys.pressEnter())
  await until(t, () => eikon.list().some(row => row.name === "ares"))
  expect(prefs.get("eikon")).toBeUndefined()

  act(() => t.keys.pressArrow("left", { shift: true }))
  await until(t, () => !t.frame().includes("ARES-POSTER"))
})

test("library activation and confirmed deletion update persisted avatar state", async () => {
  seed("owned", "OWNED-FRAME")
  await using t = await mountNode(<EikonGallery focused />, { width: 160, height: 48 })
  await until(t, () => t.frame().includes("owned"))

  await act(async () => {
    const p = point(t.frame(), "owned")
    await t.mouse.pressDown(p.x, p.y)
  })
  await until(t, () => prefs.get("eikon") === "owned")
  expect(eikon.baked("owned")).toBe(eikon.file("owned"))

  act(() => t.keys.pressKey("d"))
  await t.settle()
  act(() => t.keys.pressEnter())
  await until(t, () => !existsSync(eikon.dir("owned")))

  expect(prefs.get("eikon")).toBeUndefined()
  expect(eikon.list().some(row => row.name === "owned")).toBe(false)
})

test("library grid collapses exactly below one card of available width", async () => {
  seed("cut", "CUT-FRAME")

  {
    await using shown = await mountNode(<EikonGallery focused />, { width: 124, height: 36 })
    await until(shown, () => shown.frame().includes("cut"))
    await act(async () => {
      const p = point(shown.frame(), "cut")
      await shown.mouse.moveTo(p.x, p.y)
    })
    await until(shown, () => count(shown.frame(), "CUT-FRAME") === 2)
  }

  {
    await using hidden = await mountNode(<EikonGallery focused />, { width: 123, height: 36 })
    await until(hidden, () => hidden.frame().includes("cut"))
    await act(async () => {
      const p = point(hidden.frame(), "cut")
      await hidden.mouse.moveTo(p.x, p.y)
    })
    await until(hidden, () => count(hidden.frame(), "CUT-FRAME") === 1)
  }
})
