import { test, expect } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import type { Rasterizer } from "../src/utils/eikon-render"

const HH = process.env.HERMES_HOME!
const stub: Rasterizer = {
  name: "stub", spatial: true, video: false, knobs: {
    symbols: { kind: "cycle", options: ["a", "b"], default: "a" },
    invert:  { kind: "toggle", default: false },
    gain:    { kind: "slider", min: 0, max: 10, step: 1, default: 5 },
  },
  available: () => true,
  probe: () => ({ w: 100, h: 100 }),
  render: async () => ({ frames: [Array.from({ length: 24 }, (_, y) =>
    Array.from({ length: 48 }, (_, x) => ((x + y) % 10 === 0 ? "#" : "·")).join(""))] }),
}

function seed(name: string) {
  const p = eikon.ensure(name)
  writeFileSync(join(p.source, "base.png"), "x")
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, width: 48, height: 24 }) + "\n")
  eikon.writeStudio(name, { rasterizer: "stub", spatial: { zoom: 0.6, ox: 0.3, oy: 0.7 }, base: {}, per: {}, glyph: "◆", sources: { base: "base.png" } })
}

test("layout probe (wide)", async () => {
  const un = eikon.register(stub); seed("probe")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikonPath", eikon.file("probe"))
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("rasterizer"))
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
  const iPan  = top.findIndex(l => /│ pan\b/.test(l))
  const iMini = top.findIndex(l => /[▀▄█]{4,}/.test(l))
  expect(iZoom).toBeGreaterThan(iFrameEnd)
  expect(iPan).toBe(iZoom + 1)
  expect(iMini).toBeGreaterThan(iFrameEnd)
  expect(iStrip).toBeGreaterThan(iZoom)
  // Knobs title is on the same line as Preview title (side-by-side).
  expect(lines.find(l => l.includes("Preview"))!).toContain("Knobs")
  un()
})

test("layout probe (narrow)", async () => {
  const un = eikon.register(stub); seed("probe2")
  const prefs = await import("../src/context/preferences")
  prefs.set("eikonPath", eikon.file("probe2"))
  await using t = await mountNode(<EikonGroup focused sub={0} setSub={() => {}} />, { width: 90, height: 60 })
  await until(t, () => t.frame().includes("Preview"))
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
