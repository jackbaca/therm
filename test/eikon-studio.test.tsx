import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import { native, type Rasterizer } from "../src/utils/eikon-render"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!

// Stub rasterizer — deterministic, no binaries.
const stub: Rasterizer = {
  name: "stub", spatial: true, video: false,
  knobs: {
    tone: { kind: "cycle", options: ["lo", "hi"], default: "lo" },
    flip: { kind: "toggle", default: false },
    gain: { kind: "slider", min: 0, max: 10, step: 1, default: 5 },
  },
  available: () => true,
  render: async () => ({ frames: [Array.from({ length: 24 }, () => "STUB-ROW".padEnd(48))] }),
}

function seed(name: string) {
  const p = eikon.ensure(name)
  writeFileSync(join(p.source, "base.png"), "x")
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, width: 48, height: 24 }) + "\n")
  eikon.writeStudio(name, { rasterizer: "stub", spatial: { zoom: 1, ox: 0.5, oy: 0.5 }, base: {}, per: {}, glyph: "◆", sources: { base: "base.png" } })
}

describe("EikonStudio tab", () => {
  test("renders three panes; knob nav via handleListKey; ←→ adjusts cycle knob", async () => {
    const un = eikon.register(stub)
    seed("owl")
    prefs.set("eikonPath", eikon.file("owl"))
    let sub = 0
    await using t = await mountNode(
      <EikonGroup focused sub={sub} setSub={i => { sub = i }} />,
      { width: 160, height: 60 },
    )
    await until(t, () => t.frame().includes("rasterizer"))
    expect(t.frame()).toContain("Preview")
    expect(t.frame()).toContain("States")
    expect(t.frame()).toContain("STUB-ROW")

    // Nav to first tonal knob (tone) — HEAD has 5 nav rows when no
    // fetch is shown (rasterizer, source, name, fork, reset), so
    // tone is at index 5.
    for (let i = 0; i < 5; i++) { act(() => t.keys.pressArrow("down")); await t.settle() }
    await until(t, () => /▸ tone/.test(t.frame()))
    act(() => t.keys.pressArrow("right"))
    await until(t, () => t.frame().includes("◂ hi ▸"))
    expect(t.frame()).toContain("● unsaved")

    // Tab cycles pane focus → hint line swaps per pane.
    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("[↑↓←→]"))
    act(() => t.keys.pressTab())
    await until(t, () => t.frame().includes("state") && t.frame().includes("actions"))
    un()
  })

  test("Enter on rasterizer row opens DialogSelect; unavailable shows reason", async () => {
    const un = eikon.register(stub)
    seed("cat")
    prefs.set("eikonPath", eikon.file("cat"))
    let sub = 0
    await using t = await mountNode(
      <EikonGroup focused sub={sub} setSub={i => { sub = i }} />,
      { width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("rasterizer"))
    // Selection starts on row 0 (rasterizer). Enter → dialog.
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Rasterizer") && t.frame().includes("● stub"))
    // chafa + native also listed; one may show an install hint.
    expect(t.frame()).toContain("chafa")
    expect(t.frame()).toContain("native")
    act(() => t.keys.pressEscape())
    await until(t, () => !t.frame().includes("● stub") || t.frame().includes("Knobs"))
    un()
  })

  test("dirty Esc → openConfirm; y reloads from disk", async () => {
    const un = eikon.register(stub)
    seed("dog")
    prefs.set("eikonPath", eikon.file("dog"))
    let sub = 0
    await using t = await mountNode(
      <EikonGroup focused sub={sub} setSub={i => { sub = i }} />,
    )
    await until(t, () => t.frame().includes("rasterizer"))
    // Make dirty via a knob adjust.
    for (let i = 0; i < 5; i++) { act(() => t.keys.pressArrow("down")); await t.settle() }
    act(() => t.keys.pressArrow("right"))
    await until(t, () => t.frame().includes("● unsaved"))
    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Discard unsaved"))
    act(() => t.keys.pressKey("y"))
    await until(t, () => !t.frame().includes("● unsaved"))
    un()
  })
})

describe("EikonGallery tab", () => {
  test("lists bundled + installed; Enter sets eikonPath", async () => {
    mkdirSync(join(HH, "eikons"), { recursive: true })
    seed("galone")
    let sub = 1
    await using t = await mountNode(
      <EikonGroup focused sub={sub} setSub={i => { sub = i }} />,
      { width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Gallery ("))
    expect(t.frame()).toContain("galone")
    // Bundled dir also shows (at least default/mono/ares ship).
    // Move to galone and activate.
    const rows = t.frame()
    const target = rows.split("\n").findIndex(l => l.includes("galone"))
    expect(target).toBeGreaterThan(0)
    // Navigate until selected row contains galone.
    for (let i = 0; i < 20; i++) {
      if (t.frame().split("\n").some(l => l.includes("▸") && l.includes("galone"))) break
      act(() => t.keys.pressArrow("down"))
      await t.settle()
    }
    act(() => t.keys.pressEnter())
    await until(t, () => prefs.get("eikonPath") === eikon.file("galone"))
  })
})

void native
