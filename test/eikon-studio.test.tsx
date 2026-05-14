import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { spawnSync } from "node:child_process"
import { mountNode, until, MockGateway } from "./harness"
import { usePlugins } from "../src/plugins/runtime"
import studio, { WIP_PATH, studio as fns } from "../src/plugins/bundled/eikon-studio"
import { fresh, step, pan } from "../src/plugins/bundled/eikon-studio/knobs"
import { render, K0, caps, reset } from "../src/plugins/bundled/eikon-studio/render"
import * as store from "../src/plugins/bundled/eikon-studio/store"
import { parseEikon } from "../src/components/avatar/eikon"
import type { HermPlugin } from "../src/plugins/types"

const have = caps.chafa && caps.ffmpeg
const wip = WIP_PATH()

const ROW = "▙STUDIO-PROBE▟".padEnd(48, " ")
const mk = (name: string, rows: string[]) => fns.serialize({
  meta: { version: 1, name, width: 48, height: 24, states: ["idle", "listening", "thinking", "speaking", "working", "error"] },
  states: new Map(["idle", "listening", "thinking", "speaking", "working", "error"].map(s => [s, { fps: 12, frames: [rows], loopFrom: 1 }])),
}, "t", "◆")

// 256×128 left-black/right-white step (chafa auto-levels gradients,
// so a hard edge is needed to tell crop windows apart).
const IMG = "/tmp/eikon-step-test.png"
if (have) spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "nullsrc=s=256x128,format=gray,geq=lum=255*gte(X\\,128)",
  "-frames:v", "1", "-y", IMG])

const Host = () => {
  const p = usePlugins()
  return (
    <box flexDirection="column" width={160} height={48}>
      <box height={24}>
        <p.Slot name="sidebar_avatar" mode="replace" state="idle" eikon={undefined}>
          <text>default-avatar</text>
        </p.Slot>
      </box>
      <box flexDirection="column" flexGrow={1}>
        {p.routes.find(r => r.name === "Eikon")?.render() ?? <text>no-route</text>}
      </box>
    </box>
  )
}

describe("eikon-studio (tab)", () => {
  test("knobs: step/pan clamp; flip cycles", () => {
    let k = K0
    for (let i = 0; i < 50; i++) k = step(k, "contrast", 1)
    expect(k.contrast).toBe(3.0)
    k = step(K0, "flip", 1); expect(k.flipH).toBe(true)
    k = pan({ ...K0, ox: 0 }, -1, 0); expect(k.ox).toBe(0)
  })

  test("serialize → parseEikon round-trip", () => {
    const back = parseEikon(mk("probe", Array.from({ length: 24 }, () => ROW)))
    expect(back.meta.name).toBe("probe")
    expect(back.states.size).toBe(6)
    expect(back.states.get("idle")!.frames[0]![0]).toBe(ROW)
  })

  test.skipIf(!have)("render: pan shifts crop window", () => {
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
    expect(ink(render(IMG, { ...K0, zoom: 0.5, ox: 0 }))).toBeGreaterThan(8000)
    expect(ink(render(IMG, { ...K0, zoom: 0.5, ox: 1 }))).toBeLessThan(200)
  })

  test("route registered; empty-state tab prompts to open", async () => {
    store.set({ mode: "off" })
    rmSync(wip, { force: true })
    const on: HermPlugin = { ...studio, enabled: true }
    await using t = await mountNode(<Host />, { width: 160, height: 48, plugins: [on] })
    await until(t, () => t.frame().includes("No image loaded"))
    expect(t.frame()).toContain("default-avatar")
  })

  test("watching: WIP (no studio header) → avatar slot only, tab stays empty-state", async () => {
    store.set({ mode: "off" })
    mkdirSync(dirname(wip), { recursive: true })
    writeFileSync(wip, mk("probe", Array.from({ length: 24 }, () => ROW)))
    const gw = new MockGateway()
    const on: HermPlugin = { ...studio, enabled: true }
    await using t = await mountNode(<Host />, { width: 160, height: 48, gw, plugins: [on] })

    await until(t, () => t.frame().includes("STUDIO-PROBE"))
    expect(t.frame()).toContain("◌ wip · probe")
    expect(t.frame()).toContain("No image loaded")    // tab idle — no session
    expect(t.frame()).not.toContain("default-avatar")

    rmSync(wip, { force: true })
    act(() => gw.push({ type: "message.complete" }))
    await until(t, () => t.frame().includes("default-avatar"))
  })

  test.skipIf(!have)("editing: studio header → tab populated, avatar mirrors; keys drive knobs; commit exits", async () => {
    store.set({ mode: "off" }); reset()
    const s = fresh(IMG, { w: 256, h: 128 })
    const { doc } = fns.build(s)
    mkdirSync(dirname(wip), { recursive: true })
    writeFileSync(wip, fns.serialize(doc, "t", "◆"))

    const gw = new MockGateway()
    const on: HermPlugin = { ...studio, enabled: true }
    await using t = await mountNode(<Host />, { width: 160, height: 48, gw, plugins: [on] })

    await until(t, () => t.frame().includes("EIKON STUDIO"))
    expect(t.frame()).toContain("◉ wip")
    expect(t.frame()).toContain("◂ braille ▸")
    expect(t.frame()).not.toContain("default-avatar")

    // j → row moves; l cycles symbols (starts on 'symbols')
    await act(async () => { t.keys.pressKey("l") })
    await until(t, () => t.frame().includes("◂ block ▸"))

    // tab cycles state
    await act(async () => { t.keys.pressTab() })
    await until(t, () => t.frame().includes("◂ listening"))

    // = forks this state
    await act(async () => { t.keys.pressKey("=") })
    await until(t, () => t.frame().includes("◂ listening *"))

    // enter → commit → watching: tab back to empty, avatar stays
    await act(async () => { t.keys.pressEnter() })
    await until(t, () => t.frame().includes("No image loaded"))
    expect(t.frame()).toContain("◌ wip")

    rmSync(wip, { force: true })
  })
})
