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

function seed(name: string) {
  const p = eikon.ensure(name)
  writeFileSync(join(p.source, "base.png"), PX)
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, width: 48, height: 24 }) + "\n")
  eikon.writeStudio(name, { rasterizer: "stub", spatial: { zoom: 0.6, ox: 0.3, oy: 0.7 }, fps: 16, base: {}, per: {}, glyph: "◆", sources: { base: "base.png" } })
}

run("layout probe (wide)", async () => {
  const un = eikon.register(stub); seed("probe")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikonPath", eikon.file("probe"))
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
  const iPanX = top.findIndex(l => l.includes("pan x"))
  const iPanY = top.findIndex(l => l.includes("pan y"))
  const iMini = top.findIndex(l => /[▀▄█]{4,}/.test(l))
  expect(iZoom).toBeGreaterThan(iFrameEnd)
  expect(iPanX).toBe(iZoom + 2)   // gap=1 between rows
  expect(iPanY).toBe(iPanX + 2)
  expect(iMini).toBeGreaterThan(iFrameEnd)
  expect(iStrip).toBeGreaterThan(iZoom)
  // Knobs title is on the same line as Preview title (side-by-side).
  expect(lines.find(l => l.includes("Preview"))!).toContain("Knobs")
  un()
})

run("SpatialBar nav: ↑↓ selects row, ←→ steps only that row", async () => {
  const un = eikon.register(stub); seed("nav")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikonPath", eikon.file("nav"))
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("zoom"))
  const row = (name: string) => t.frame().split("\n").find(l => l.includes(name))!
  // No caret when preview pane unfocused.
  expect(row("zoom")).not.toContain("▸")
  // Tab into preview → zoom row gets caret.
  act(() => t.keys.pressTab())
  await until(t, () => row("zoom").includes("▸"))
  expect(row("pan x")).not.toContain("▸")
  // ↓ → pan x selected; ←→ adjusts only ox.
  act(() => t.keys.pressArrow("down")); await t.settle()
  expect(row("pan x")).toContain("▸")
  expect(row("zoom")).not.toContain("▸")
  const before = row("pan x")
  act(() => t.keys.pressArrow("right")); await t.settle()
  expect(row("pan x")).not.toBe(before)
  expect(row("zoom")).toContain("0.60")     // unchanged
  // ↓↓↓ clamps at fps (4th row).
  act(() => t.keys.pressArrow("down")); await t.settle()
  act(() => t.keys.pressArrow("down")); await t.settle()
  act(() => t.keys.pressArrow("down")); await t.settle()
  expect(row("fps")).toContain("▸")
  expect(row("fps")).toContain("16")
  un()
})

run("layout probe (narrow)", async () => {
  const un = eikon.register(stub); seed("probe2")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikonPath", eikon.file("probe2"))
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
