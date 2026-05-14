import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { mountNode, until, MockGateway } from "./harness"
import { usePlugins } from "../src/plugins/runtime"
import studio, { WIP_PATH, studio as fns } from "../src/plugins/bundled/eikon-studio"
import { parseEikon } from "../src/components/avatar/eikon"
import type { HermPlugin } from "../src/plugins/types"

// A distinctive 24-row block the assertions can anchor on (pitfall 8e:
// content-literal, not a braille char-class).
const ROW = "▙STUDIO-PROBE▟".padEnd(48, " ")
const LINES = Array.from({ length: 24 }, () => ROW)
const DOC = fns.one("probe", LINES)

const wip = WIP_PATH()

const Host = () => {
  const p = usePlugins()
  return (
    <box flexDirection="column">
      <box height={24}>
        <p.Slot name="sidebar_avatar" mode="replace" state="idle" eikon={undefined}>
          <text>default-avatar</text>
        </p.Slot>
      </box>
    </box>
  )
}

describe("eikon-studio plugin", () => {
  test("studio.one → write → parseEikon round-trip yields 6 states × 1 frame", () => {
    const body = fns.write(DOC, "t", "◆")
    const back = parseEikon(body)
    expect(back.meta.name).toBe("probe")
    expect(back.meta.states.length).toBe(6)
    for (const s of back.meta.states)
      expect(back.states.get(s)!.frames[0]![0]).toBe(ROW)
  })

  test("replace slot: default renders when plugin inactive", async () => {
    await using t = await mountNode(<Host />, { width: 80, height: 30, plugins: [] })
    await until(t, () => t.frame().includes("default-avatar"))
  })

  test("WIP file + tool.complete event → preview supplants default; clear restores", async () => {
    mkdirSync(dirname(wip), { recursive: true })
    writeFileSync(wip, fns.write(DOC, "t", "◆"))

    const gw = new MockGateway()
    const on: HermPlugin = { ...studio, enabled: true }
    await using t = await mountNode(<Host />, { width: 80, height: 30, gw, plugins: [on] })

    // Initial fromWipFile() runs on activate.
    await until(t, () => t.frame().includes("STUDIO-PROBE"))
    expect(t.frame()).toContain("wip · probe")
    expect(t.frame()).not.toContain("default-avatar")

    // Rewrite with a new doc + fire a synthetic tool.complete → reload.
    writeFileSync(wip, fns.write(fns.one("probe2", LINES.map(l => l.replace("PROBE", "TWO··"))), "t", "◆"))
    act(() => gw.push({ type: "tool.complete", payload: { tool_id: "x" } }))
    await until(t, () => t.frame().includes("STUDIO-TWO"))
    expect(t.frame()).toContain("wip · probe2")

    // Delete the file → next event clears the preview.
    rmSync(wip, { force: true })
    act(() => gw.push({ type: "message.complete" }))
    await until(t, () => t.frame().includes("default-avatar"))
    expect(t.frame()).not.toContain("STUDIO")
  })
})
