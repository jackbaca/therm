import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { spawnSync } from "node:child_process"
import { mountNode, until, MockGateway } from "./harness"
import { usePlugins } from "../src/plugins/runtime"
import studio, { WIP_PATH, studio as fns } from "../src/plugins/bundled/eikon-studio"
import { fresh, step, pan, eff } from "../src/plugins/bundled/eikon-studio/knobs"
import { render, K0, caps, reset } from "../src/plugins/bundled/eikon-studio/render"
import { parseEikon } from "../src/components/avatar/eikon"
import type { HermPlugin } from "../src/plugins/types"

const have = caps.chafa && caps.ffmpeg
const wip = WIP_PATH()

// A distinctive 24-row block the assertions can anchor on.
const ROW = "▙STUDIO-PROBE▟".padEnd(48, " ")
const LINES = Array.from({ length: 24 }, () => ROW)
const mk = (name: string, rows: string[]) => fns.serialize({
  meta: { version: 1, name, width: 48, height: 24, states: ["idle", "listening", "thinking", "speaking", "working", "error"] },
  states: new Map(["idle", "listening", "thinking", "speaking", "working", "error"].map(s => [s, { fps: 12, frames: [rows], loopFrom: 1 }])),
}, "t", "◆")

// 256×128 left-black/right-white — chafa auto-levels each input, so a
// linear gradient normalizes to the same output regardless of crop
// position. A hard step doesn't.
const IMG = "/tmp/eikon-grad-test.png"
if (have) spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "nullsrc=s=256x128,format=gray,geq=lum=255*gte(X\\,128)",
  "-frames:v", "1", "-y", IMG])

const Host = () => {
  const p = usePlugins()
  return (
    <box flexDirection="column" width={50}>
      <box height={24}>
        <p.Slot name="sidebar_avatar" mode="replace" state="idle" eikon={undefined}>
          <text>default-avatar</text>
        </p.Slot>
      </box>
      <box flexDirection="column" flexGrow={1}>
        <p.Slot name="sidebar_content" mode="replace" sid="">
          <text>default-column</text>
        </p.Slot>
      </box>
    </box>
  )
}

describe("eikon-studio", () => {
  test("knobs: step/pan clamp and cycle", () => {
    let k = K0
    k = step(k, "contrast", 1); expect(k.contrast).toBeCloseTo(1.1)
    for (let i = 0; i < 50; i++) k = step(k, "contrast", 1)
    expect(k.contrast).toBe(3.0)
    k = step(K0, "symbols", 1); expect(k.symbols).toBe("block")
    k = pan(K0, -1, 0); expect(k.ox).toBeCloseTo(0.45)
    k = pan({ ...K0, ox: 0 }, -1, 0); expect(k.ox).toBe(0)
  })

  test("serialize → parseEikon round-trip", () => {
    const body = mk("probe", LINES)
    const back = parseEikon(body)
    expect(back.meta.name).toBe("probe")
    expect(back.states.size).toBe(6)
    expect(back.states.get("idle")!.frames[0]![0]).toBe(ROW)
  })

  test.skipIf(!have)("render: pan shifts window, contrast shifts density", () => {
    reset()
    const ink = (r: ReturnType<typeof render>) => {
      if ("err" in r) throw new Error(r.err)
      let n = 0
      for (const ln of r.lines) for (const ch of ln) {
        const cp = ch.codePointAt(0)!
        if (cp >= 0x2800 && cp <= 0x28FF) for (let b = cp - 0x2800; b; b >>= 1) n += b % 2
      }
      return n
    }
    const L = ink(render(IMG, { ...K0, zoom: 0.5, ox: 0 }))
    const R = ink(render(IMG, { ...K0, zoom: 0.5, ox: 1 }))
    expect(L).toBeGreaterThan(8000)   // left=black → invert → full ink
    expect(R).toBeLessThan(200)       // right=white → invert → empty
    // Contrast: on a continuous-tone image (not a step), eq=contrast moves
    // mid-gray pixels across chafa's 50% threshold. Flat patches don't show
    // it (nothing to spread), so use a soft radial gradient.
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "nullsrc=s=128x128,format=gray,geq=lum=clip(128+(64-hypot(X-64\\,Y-64))*2\\,0\\,255)",
      "-frames:v", "1", "-y", "/tmp/eikon-soft.png"])
    reset()
    const lo = ink(render("/tmp/eikon-soft.png", { ...K0, contrast: 0.5 }))
    const hi = ink(render("/tmp/eikon-soft.png", { ...K0, contrast: 3.0 }))
    expect(Math.abs(lo - hi)).toBeGreaterThan(300)
  })

  test("watching: WIP file + tool.complete drives avatar slot only; sidebar_content untouched", async () => {
    mkdirSync(dirname(wip), { recursive: true })
    writeFileSync(wip, mk("probe", LINES))
    const gw = new MockGateway()
    const on: HermPlugin = { ...studio, enabled: true }
    await using t = await mountNode(<Host />, { width: 60, height: 48, gw, plugins: [on] })

    await until(t, () => t.frame().includes("STUDIO-PROBE"))
    expect(t.frame()).toContain("wip · probe")
    expect(t.frame()).toContain("default-column")          // panel not mounted in watching
    expect(t.frame()).not.toContain("default-avatar")

    rmSync(wip, { force: true })
    act(() => gw.push({ type: "message.complete" }))
    await until(t, () => t.frame().includes("default-avatar"))
  })

  test.skipIf(!have)("editing: studio header → both slots; h/l adjust, j/k move row, enter commits", async () => {
    rmSync(wip, { force: true })
    const s = fresh(IMG, { w: 256, h: 128 })
    const { doc } = fns.build(s)
    // Seed WIP carrying `studio` so activation enters editing.
    mkdirSync(dirname(wip), { recursive: true })
    writeFileSync(wip, fns.serialize(doc, "t", "◆"))

    const gw = new MockGateway()
    const on: HermPlugin = { ...studio, enabled: true }
    await using t = await mountNode(<Host />, { width: 60, height: 48, gw, plugins: [on] })

    await until(t, () => t.frame().includes("EIKON STUDIO"))
    expect(t.frame()).not.toContain("default-column")
    expect(t.frame()).toContain("◂ braille ▸")              // row=symbols by default

    await act(async () => { t.keys.pressKey("l") })
    await until(t, () => t.frame().includes("◂ block ▸"))

    // j → invert row; l toggles
    await act(async () => { t.keys.pressKey("j") })
    await act(async () => { t.keys.pressKey("l") })
    await until(t, () => t.frame().includes("○ off"))

    // j j → zoom row; pan row reached via j again; arrow moves ox
    await act(async () => { t.keys.pressKey("j") })  // contrast
    await act(async () => { t.keys.pressKey("j") })  // zoom
    await act(async () => { t.keys.pressKey("j") })  // pan
    await until(t, () => t.frame().includes("▸ pan"))
    await act(async () => { t.keys.pressArrow("left") })
    await t.settle(); await t.settle()

    // enter → commit → panel gone, avatar stays
    await act(async () => { t.keys.pressEnter() })
    await until(t, () => t.frame().includes("default-column"))
    expect(t.frame()).toContain("◌ wip")                     // watching badge
    expect(t.frame()).not.toContain("EIKON STUDIO")

    rmSync(wip, { force: true })
  })
})
