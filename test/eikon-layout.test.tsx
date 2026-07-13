import { afterEach, beforeEach, expect, test } from "bun:test"
import { act } from "react"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until } from "./harness"
import { eikons } from "./fixture/eikon"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"
import { caps, type Rasterizer } from "../src/utils/eikon-render"

const PX = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,0,0,0,0,58,126,155,85,0,0,0,10,73,68,65,84,120,156,99,104,0,0,0,130,0,129,119,205,114,182,0,0,0,0,73,69,78,68,174,66,96,130])
const ART = Array.from({ length: 24 }, (_, y) =>
  Array.from({ length: 48 }, (_, x) => ((x + y) % 10 === 0 ? "#" : "·")).join(""))
const run = caps.ffmpeg ? test : test.skip
const stub: Rasterizer = {
  name: "stub",
  knobs: {
    symbols: { kind: "cycle", options: ["a", "b"], default: "a" },
    invert: { kind: "toggle", default: false },
    gain: { kind: "slider", min: 0, max: 10, step: 1, default: 5 },
  },
  available: () => true,
  render: async () => ({ frames: [ART] }),
}

const tall: Rasterizer = {
  name: "tall",
  available: () => true,
  knobs: Object.fromEntries(Array.from({ length: 40 }, (_, i) =>
    [`k${i}`, { kind: "slider", min: 0, max: 1, step: 0.1, default: 0.5 }])),
  render: stub.render,
}

let fx: ReturnType<typeof eikons>
beforeEach(() => { fx = eikons() })
afterEach(() => {
  prefs.set("eikon", undefined)
  fx[Symbol.dispose]()
})

const raster = (value: Rasterizer) => {
  const dispose = eikon.register(value)
  return { [Symbol.dispose]: dispose }
}

const seed = (name: string, rasterizer = "stub", spatial = { zoom: 0.6, ox: 0.3, oy: 0.7 }) => {
  const path = eikon.ensure(name)
  writeFileSync(join(path.source, "base.png"), PX)
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, width: 48, height: 24 }) + "\n")
  eikon.writeStudio(name, {
    rasterizer,
    spatial,
    tone: { contrast: 1, invert: true, flip: "none" },
    fps: 16,
    base: {},
    per: {},
    glyph: "x",
    sources: { base: "base.png" },
  })
  prefs.set("eikon", name)
}

const view = (frame: string) => {
  const lines = frame.split("\n")
  const top = lines.findIndex(line => line.includes(ART[0]!))
  if (top < 0) throw new Error("rendered eikon frame is missing")
  const x = lines[top]!.indexOf(ART[0]!)
  return {
    lines,
    top,
    x,
    art: lines.slice(top, top + ART.length).map(line => line.slice(x, x + ART[0]!.length)),
  }
}

const row = (lines: string[], token: string) => lines.findIndex(line => line.includes(token))
const last = (lines: string[]) => lines.findLastIndex(line => line.trim() !== "")
const value = (frame: string, token: string) => {
  const line = frame.split("\n").find(item => item.includes(token))
  const match = line?.match(/-?\d+(?:\.\d+)?/g)?.at(-1)
  if (match === undefined) throw new Error(`missing numeric value for ${token}`)
  return Number(match)
}

run("wide studio preserves the runtime frame and places settings beside it", async () => {
  using reg = raster(stub)
  seed("wide")
  await using t = await mountNode(<EikonGroup focused sub={2} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes(ART[0]!) && t.frame().includes("gain") && t.frame().includes("listening"))

  const frame = view(t.frame())
  const gain = row(frame.lines, "gain")
  const spatial = row(frame.lines, "0.60")
  const strip = row(frame.lines, "listening")

  expect(frame.art).toEqual(ART)
  expect(frame.lines[gain]!.indexOf("gain")).toBeGreaterThan(frame.x + ART[0]!.length)
  expect(gain).toBeGreaterThanOrEqual(frame.top)
  expect(gain).toBeLessThan(frame.top + ART.length)
  expect(spatial).toBeGreaterThanOrEqual(frame.top + ART.length)
  expect(strip).toBeGreaterThan(spatial)
})

run("pane navigation adjusts only the selected spatial control", async () => {
  using reg = raster(stub)
  seed("nav")
  await using t = await mountNode(<EikonGroup focused sub={2} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("zoom") && t.frame().includes("fps"))

  const zoom = value(t.frame(), "zoom")
  const fps = value(t.frame(), "fps")
  act(() => t.keys.pressTab())
  await t.settle()
  act(() => t.keys.pressArrow("down"))
  await t.settle()
  act(() => t.keys.pressArrow("down"))
  await t.settle()
  act(() => t.keys.pressArrow("left"))
  await until(t, () => value(t.frame(), "zoom") !== zoom)

  const changed = value(t.frame(), "zoom")
  expect(changed).toBeLessThan(zoom)
  expect(value(t.frame(), "fps")).toBe(fps)

  act(() => t.keys.pressArrow("down"))
  await t.settle()
  act(() => t.keys.pressArrow("down"))
  await t.settle()
  act(() => t.keys.pressArrow("left"))
  await until(t, () => value(t.frame(), "fps") !== fps)

  expect(value(t.frame(), "zoom")).toBe(changed)
  expect(value(t.frame(), "fps")).toBeLessThan(fps)
})

run("narrow studio stacks settings below an intact runtime frame", async () => {
  using reg = raster(stub)
  seed("narrow")
  await using t = await mountNode(<EikonGroup focused sub={2} setSub={() => {}} />, { width: 90, height: 60 })
  await until(t, () => t.frame().includes(ART[0]!) && t.frame().includes("gain"))

  const frame = view(t.frame())
  const gain = row(frame.lines, "gain")
  const x = frame.lines[gain]!.indexOf("gain")

  expect(frame.art).toEqual(ART)
  expect(gain).toBeGreaterThanOrEqual(frame.top + ART.length)
  expect(Math.abs(x - frame.x)).toBeLessThan(8)
})

run("short studio clips its lower strip until pane navigation scrolls it into view", async () => {
  using reg = raster(stub)
  seed("short")
  await using t = await mountNode(<EikonGroup focused sub={2} setSub={() => {}} />, { width: 180, height: 30 })
  await until(t, () => t.frame().includes(ART[0]!) && t.frame().includes("gain"))

  expect(t.frame()).not.toContain("listening")
  expect(last(t.frame().split("\n"))).toBe(29)

  act(() => t.keys.pressTab())
  await t.settle()
  act(() => t.keys.pressTab())
  await until(t, () => t.frame().includes("listening"))

  expect(last(t.frame().split("\n"))).toBe(29)
})

run("overflowing settings scroll inside their pane without moving the preview", async () => {
  using reg = raster(tall)
  seed("overflow", "tall", { zoom: 1, ox: 0.5, oy: 0.5 })
  await using t = await mountNode(<EikonGroup focused sub={2} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes(ART[0]!) && t.frame().includes("k0"))

  const before = view(t.frame())
  const bottom = last(before.lines)
  expect(t.frame()).not.toContain("k39")

  act(() => t.keys.pressKey("END"))
  await until(t, () => t.frame().includes("k39"))

  const after = view(t.frame())
  expect(t.frame()).not.toContain("k0")
  expect(after.top).toBe(before.top)
  expect(after.x).toBe(before.x)
  expect(after.art).toEqual(ART)
  expect(last(after.lines)).toBe(bottom)
})
