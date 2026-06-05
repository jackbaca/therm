import { afterEach, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
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

test("Eikon sub-tabs put Gallery before Studio and preserve slash routes", () => {
  expect(SUB_TABS[EIKON_TAB]).toEqual(["Gallery", "Studio"])
  expect(TAB_SLASH.gallery).toEqual({ tab: EIKON_TAB, sub: 0 })
  expect(TAB_SLASH.studio).toEqual({ tab: EIKON_TAB, sub: 1 })
})

test("Marketplace gallery action matches the M shortcut", async () => {
  useCatalog()
  await using t = await mountNode(<EikonGallery focused />, { width: 160, height: 48 })
  await until(t, () => t.frame().includes("[ Marketplace ]"))

  expect(t.frame()).toContain("▸ [ Marketplace ]")
  act(() => t.keys.pressArrow("down")); await t.settle()
  expect(t.frame()).toContain("  [ Marketplace ]")
  act(() => t.keys.pressArrow("up")); await t.settle()
  expect(t.frame()).toContain("▸ [ Marketplace ]")

  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes("Marketplace (1)") && t.frame().includes("ARES-POSTER"))

  act(() => t.keys.pressEscape())
  await until(t, () => t.frame().includes("Gallery (") && t.frame().includes("[ Marketplace ]"))
  const lines = t.frame().split("\n")
  const y = lines.findIndex(l => l.includes("[ Marketplace ]"))
  expect(y).toBeGreaterThanOrEqual(0)
  await act(async () => { await t.mouse.pressDown(lines[y]!.indexOf("Marketplace") + 1, y) })
  await until(t, () => t.frame().includes("Marketplace (1)") && t.frame().includes("ARES-POSTER"))
})

test("Gallery title remains readable beside marketplace action at narrow widths", async () => {
  await using t = await mountNode(<EikonGallery focused />, { width: 80, height: 32 })
  await until(t, () => t.frame().includes("[ Marketplace ]"))

  const row = t.frame().split("\n").find(l => l.includes("[ Marketplace ]")) ?? ""
  expect(row).toContain("Gallery (")
})
