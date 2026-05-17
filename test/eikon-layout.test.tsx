import { test, expect } from "bun:test"
import { act } from "react"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import { caps, type Rasterizer } from "../src/utils/eikon-render"

const HH = process.env.HERMES_HOME!
// 1×1 gray PNG — valid for the shared ffmpeg decode step.
const PX = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,0,0,0,0,58,126,155,85,0,0,0,10,73,68,65,84,120,156,99,104,0,0,0,130,0,129,119,205,114,182,0,0,0,0,73,69,78,68,174,66,96,130])
const run = caps.ffmpeg ? test : test.skip
const stub: Rasterizer = {
  name: "stub",
  knobs: {
    symbols: { kind: "cycle", options: ["a", "b"], default: "a" },
    invert:  { kind: "toggle", default: false },
    gain:    { kind: "slider", min: 0, max: 10, step: 1, default: 5 },
  },
  available: () => true,
  render: async () => ({ frames: [Array.from({ length: 24 }, (_, y) =>
    Array.from({ length: 48 }, (_, x) => ((x + y) % 10 === 0 ? "#" : "·")).join(""))] }),
}

function seed(name: string, sp = { zoom: 0.6, ox: 0.3, oy: 0.7 }) {
  const p = eikon.ensure(name)
  writeFileSync(join(p.source, "base.png"), PX)
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, width: 48, height: 24 }) + "\n")
  eikon.writeStudio(name, { rasterizer: "stub", spatial: sp, fps: 16, base: {}, per: {}, glyph: "◆", sources: { base: "base.png" } })
}

run("layout probe (wide)", async () => {
  const un = eikon.register(stub); seed("probe")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikon", "probe")
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("rasterizer") && t.frame().includes("#·········#"))
  const f = t.frame()
  if (process.env.DUMP) console.log(f)
  const lines = f.split("\n")
  const iStrip = lines.findIndex(l => l.includes("States"))
  const top = lines.slice(0, iStrip)
  // Full 48-col frame intact (pattern has 9 dots between hashes).
  expect(f).toMatch(/#·········#·········#·········#·········#/)
  // SpatialBar: zoom + pan sliders + minimap sit below the last
  // frame row and above States. Scope to above-strip so thumb
  // downsamples don't false-match.
  const iFrameEnd = top.findLastIndex(l => l.includes("#·········#"))
  const iZoom = top.findIndex(l => l.includes("zoom"))
  const iFps  = top.findIndex(l => l.includes("fps"))
  // pan-x bar is the row immediately below the frame (█-run, width
  // = zoom·48); pan-y is a 2-col half-block track on its right.
  const panx = top[iFrameEnd + 1]!
  expect(panx).toMatch(/█{29}/)               // round(0.6·48)
  expect(panx).not.toMatch(/█{48}/)
  // pan-y thumb sits inside the frame's row band (not above/below).
  expect(top.slice(iFrameEnd - 23, iFrameEnd + 1).some(l => /[#·]██/.test(l))).toBe(true)
  // Minimap renders below zoom, above States.
  const iMini = top.slice(iZoom).findIndex(l => /[▀▄█]{4,}/.test(l)) + iZoom
  expect(iZoom).toBeGreaterThan(iFrameEnd)
  expect(iFps).toBe(iZoom + 2)   // gap=1 between zoom/fps rows
  expect(iMini).toBeGreaterThanOrEqual(iZoom)
  expect(iStrip).toBeGreaterThan(iZoom)
  // Knobs title is on the same line as Preview title (side-by-side).
  expect(lines.find(l => l.includes("Preview"))!).toContain("Knobs")
  un()
})

run("SpatialBar nav: ↑↓ selects row, ←→ steps only that row", async () => {
  const un = eikon.register(stub); seed("nav")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikon", "nav")
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("zoom"))
  const row = (name: string) => t.frame().split("\n").find(l => l.includes(name))!
  // No caret when preview pane unfocused.
  expect(row("zoom")).not.toContain("▸")
  // Tab into preview → pan-x selected (idx 0). ↓↓ → zoom (idx 2).
  act(() => t.keys.pressTab()); await t.settle()
  act(() => t.keys.pressArrow("down")); await t.settle()
  act(() => t.keys.pressArrow("down")); await t.settle()
  await until(t, () => row("zoom").includes("▸"))
  expect(row("fps")).not.toContain("▸")
  // ←→ adjusts zoom only.
  const before = row("zoom")
  act(() => t.keys.pressArrow("left")); await t.settle()
  expect(row("zoom")).not.toBe(before)
  expect(row("fps")).toContain("16")     // unchanged
  // ↓↓ clamps at fps (4th row).
  act(() => t.keys.pressArrow("down")); await t.settle()
  act(() => t.keys.pressArrow("down")); await t.settle()
  expect(row("fps")).toContain("▸")
  un()
})

run("pan-bar thumb fills track at zoom=1", async () => {
  const un = eikon.register(stub); seed("full", { zoom: 1, ox: 0.5, oy: 0.5 })
  const prefs = await import("../src/context/preferences")
  prefs.set("eikon", "full")
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("#·········#"))
  const lines = t.frame().split("\n")
  const last = lines.findLastIndex(l => l.includes("#·········#"))
  // pan-x: full 48-cell █ run immediately below the frame.
  expect(lines[last + 1]).toMatch(/█{48}/)
  // pan-y: every frame row carries a ██ flank (no half-blocks, no gaps).
  for (let y = last - 23; y <= last; y++) expect(lines[y]).toMatch(/[#·]██/)
  un()
})

run("layout probe (narrow)", async () => {
  const un = eikon.register(stub); seed("probe2")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikon", "probe2")
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 90, height: 60 })
  await until(t, () => t.frame().includes("Preview") && t.frame().includes("#·········#"))
  const f = t.frame()
  const lines = f.split("\n")
  if (process.env.DUMP) console.log(f)
  const iPrev = lines.findIndex(l => l.includes("Preview"))
  const iZoom = lines.findIndex(l => l.includes("zoom"))
  const iKnob = lines.findIndex(l => l.includes("Knobs"))
  // Stacking order: preview (with SpatialBar) above knobs.
  expect(iPrev).toBeGreaterThanOrEqual(0)
  expect(iZoom).toBeGreaterThan(iPrev)
  expect(iKnob).toBeGreaterThan(iZoom)
  // Preview body (the '#' pattern) renders between its title and zoom.
  const iBody = lines.findIndex(l => l.includes("#·········#"))
  expect(iBody).toBeGreaterThan(iPrev)
  expect(iBody).toBeLessThan(iZoom)
  // Knobs rows render (not collapsed).
  expect(f).toContain("rasterizer")
  un()
})
