import { test, expect } from "bun:test"
import { act } from "react"
import { writeFileSync } from "node:fs"
import { mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

// A minimal 2-frame 4×2 .eikon with source_url in the header. Studio
// has no source/ for it, so it must open in baked mode: playing the
// packed frames, PanBars/SpatialBar hidden, download row visible.
const make = (name: string, url?: string) => {
  const head = { eikon: 1, name, width: 4, height: 2, ...(url ? { source_url: url } : {}) }
  const st = { state: "idle", fps: 12, frame_count: 2, loop_from: 0 }
  const f0 = { f: 0, data: "AB@@\n@@@@" }, f1 = { f: 1, data: "CD@@\n@@@@" }
  return [head, st, f0, f1].map(x => JSON.stringify(x)).join("\n") + "\n"
}

test("baked mode: plays packed frames, hides spatial, shows download row", async () => {
  // Served manifest so peekSource resolves → size hint on the row.
  const srv = Bun.serve({
    port: 0,
    fetch: r => new URL(r.url).pathname.endsWith("manifest.json")
      ? Response.json({
        kind: "eikon.package",
        schemaVersion: "1.0",
        id: "liftaris/bake",
        name: "bake",
        version: "1.0.0",
        compatibility: { eikon: ">=1 <2" },
        entrypoints: { default: "bake.eikon" },
        source: { base: "base.png" },
      })
      : new Response(new Uint8Array(2048), { headers: { "content-length": "2048" } }),
  })
  const url = `http://localhost:${srv.port}/bake/`
  eikon.ensure("bake")  // source/ exists but empty → !live
  writeFileSync(eikon.file("bake"), make("bake", url))
  prefs.set("eikon", "bake")

  await using t = await mountNode(<EikonGroup focused sub={2} setSub={() => {}} />, { width: 180, height: 50 })
  await until(t, () => t.frame().includes("(baked)"))
  const f = t.frame()
  // Baked frame content is on screen; spatial rows are not.
  expect(f).toContain("AB@@")
  expect(f).not.toContain("zoom")
  // Knob panel collapsed: download row present, rasterizer-declared
  // knobs absent, fork/reset hidden.
  expect(f).toContain("Download source")
  // Live-only action rows absent in baked mode.
  expect(f).not.toMatch(/▸?\s+tune\s+◂/)
  expect(f).not.toMatch(/▸?\s+reset\s+▸ defaults/)
  // peek hint lands async.
  await until(t, () => t.frame().includes("1 files"))
  // Tab to preview, Space still toggles play (⏸ appears in title).
  act(() => t.keys.pressTab()); await t.settle()
  act(() => t.keys.pressKey(" ")); await t.settle()
  await until(t, () => t.frame().includes("⏸"))
  srv.stop()
})

test("baked mode: no url → 'attach' hint, no download row", async () => {
  eikon.ensure("noburl")
  writeFileSync(eikon.file("noburl"), make("noburl"))
  prefs.set("eikon", "noburl")
  await using t = await mountNode(<EikonGroup focused sub={2} setSub={() => {}} />, { width: 180, height: 50 })
  await until(t, () => t.frame().includes("(baked)"))
  const f = t.frame()
  expect(f).not.toContain("download source")
  expect(f).toContain("AB@@")
})

test("gallery badge: ○ available vs ● source", async () => {
  // One eikon with url + no source, one with source present.
  eikon.ensure("gal-a")
  writeFileSync(eikon.file("gal-a"), make("gal-a", "http://x/"))
  eikon.ensure("gal-b")
  writeFileSync(eikon.file("gal-b"), make("gal-b"))
  writeFileSync(eikon.sourceDir("gal-b") + "/base.png", "x")
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 180, height: 50 })
  await until(t, () => t.frame().includes("gal-a") && t.frame().includes("gal-b"))
  const lines = t.frame().split("\n")
  const y = lines.findIndex(l => l.includes("gal-a"))
  expect(y).toBeGreaterThanOrEqual(0)
  await act(async () => { await t.mouse.click(lines[y]!.indexOf("gal-a"), y) })
  await until(t, () => t.frame().includes("Preview — gal-a") && t.frame().includes("Source: http://x/"))
  expect(t.frame()).toContain("○ source available")
})
