import { test, expect } from "bun:test"
import { act } from "react"
import { writeFileSync } from "node:fs"
import { mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

const make = (name: string) => {
  const head = {
    type: "header", eikon: 1, id: `test/${name}`, version: "1.0.0", title: name,
    size: { cols: 4, rows: 2 }, defaultSignal: "state.idle",
    signals: { "state.idle": { clip: "idle" } },
  }
  const clip = { type: "clip", name: "idle", fps: 12, frameCount: 2, loopFrom: 0 }
  const f0 = { type: "frame", clip: "idle", index: 0, rows: ["AB@@", "@@@@"] }
  const f1 = { type: "frame", clip: "idle", index: 1, rows: ["CD@@", "@@@@"] }
  return [head, clip, f0, f1].map(x => JSON.stringify(x)).join("\n") + "\n"
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
  writeFileSync(eikon.file("bake"), make("bake"))
  writeFileSync(`${eikon.dir("bake")}/manifest.json`, JSON.stringify({
    name: "bake", origin: { packageUrl: `${url}manifest.json`, kind: "catalog-package" },
  }))
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
