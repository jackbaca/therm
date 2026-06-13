import { afterEach, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { EIKON_TAB, SUB_TABS, TAB_SLASH } from "../src/app/tabs"

let server: ReturnType<typeof Bun.serve> | undefined

const eikonBody = [
  JSON.stringify({
    type: "header", eikon: 1, id: "liftaris/ares", version: "1.0", title: "ares",
    author: { name: "Kaio" }, size: { cols: 48, rows: 24 }, defaultSignal: "state.idle",
    signals: { "state.idle": { clip: "idle" } },
  }),
  JSON.stringify({ type: "clip", name: "idle", fps: 1, frameCount: 1, loopFrom: 0 }),
  JSON.stringify({
    type: "frame", clip: "idle", index: 0,
    rows: Array.from({ length: 24 }, (_, i) => (i === 0 ? "ARES-IDLE" : "").padEnd(48)),
  }),
].join("\n") + "\n"

function useCatalog() {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === "/eikons/index.json") return Response.json([
        { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", description: "red warrior" },
      ])
      if (path === "/eikons/ares/ares.eikon") return new Response(eikonBody)
      return new Response("404", { status: 404 })
    },
  })
  process.env.EIKON_URL = `http://localhost:${server.port}/eikons`
}

afterEach(() => {
  delete process.env.EIKON_URL
  server?.stop()
  server = undefined
})

test("Eikon sub-tabs put Studio after Library and Catalog and preserve slash routes", () => {
  expect(SUB_TABS[EIKON_TAB]).toEqual(["Library", "Catalog", "Studio"])
  expect(TAB_SLASH.library).toEqual({ tab: EIKON_TAB, sub: 0 })
  expect(TAB_SLASH.catalog).toEqual({ tab: EIKON_TAB, sub: 1 })
  expect(TAB_SLASH.studio).toEqual({ tab: EIKON_TAB, sub: 2 })
  expect(Object.keys(TAB_SLASH).filter(k => ["gallery", "marketplace"].includes(k))).toEqual([])
})

test("Library no longer embeds a Catalog header action", async () => {
  await using t = await mountNode(<EikonGallery focused />, { width: 160, height: 48 })
  await until(t, () => t.frame().includes("Library ("))
  expect(t.frame()).not.toContain("[ Catalog ]")
  expect(t.frame()).not.toContain("Catalog (")
})

test("Catalog renders as its own Eikon sub-tab", async () => {
  useCatalog()
  let sub = 1
  await using t = await mountNode(<EikonGroup focused sub={sub} setSub={i => { sub = i }} />, { width: 160, height: 48 })
  await until(t, () => t.frame().includes("Catalog (1)") && t.frame().includes("ARES-IDLE"))
  expect(t.frame()).toContain("Details — ares")
})

test("Library title remains readable without catalog action at narrow widths", async () => {
  await using t = await mountNode(<EikonGallery focused />, { width: 80, height: 32 })
  await until(t, () => t.frame().includes("Library ("))
  const row = t.frame().split("\n").find(l => l.includes("Library (")) ?? ""
  expect(row).toContain("Library (")
  expect(row).not.toContain("Catalog")
})

test("Library action pane names management actions", async () => {
  await using t = await mountNode(<EikonGallery focused />, { width: 180, height: 48 })
  await until(t, () => t.frame().includes("Library (") && t.frame().includes("Actions"))
  expect(t.frame()).toContain("Use as active avatar")
  act(() => t.keys.pressTab())
  await until(t, () => t.frame().includes("[Tab] library"))
})
