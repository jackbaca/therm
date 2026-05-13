import { describe, expect, test } from "bun:test"
import { act } from "react"
import type { ParsedKey } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { mountNode, until, type Harness } from "./harness"
import { useKeys, type Keys } from "../src/keys"
import * as prefs from "../src/context/preferences"

function Probe(props: { onKeys: (k: Keys) => void; onFire?: (id: string) => void }) {
  const keys = useKeys()
  props.onKeys(keys)
  useKeyboard((key) => {
    if (keys.match("editor.open", key)) props.onFire?.("editor.open")
    if (keys.match("session.new", key)) props.onFire?.("session.new")
    if (keys.match("list.new", key)) props.onFire?.("list.new")
  })
  return <box><text>probe</text></box>
}

describe("KeysProvider", () => {
  test("match() resolves defaults", async () => {
    let keys!: Keys
    const t: Harness = await mountNode(<Probe onKeys={k => { keys = k }} />)
    await until(t, () => t.frame().includes("probe"))

    const ev = (o: Partial<ParsedKey> & { name: string }) => ({
      ctrl: false, meta: false, shift: false, option: false, number: false,
      sequence: o.name, raw: o.name, eventType: "press" as const, source: "raw" as const, ...o,
    })
    expect(keys.match("tab.next", ev({ name: "right", meta: true }))).toBe(true)
    expect(keys.match("tab.next", ev({ name: "right" }))).toBe(false)
    expect(keys.match("input.newline", ev({ name: "return", shift: true }))).toBe(true)
    expect(keys.match("input.newline", ev({ name: "j", ctrl: true }))).toBe(true)
    expect(keys.print("tab.next")).toBe("Alt+→")
    expect(keys.print("editor.open")).toBe("Ctrl+X E")
    t.destroy()
  })

  test("leader arms on ctrl+x, gates match(), disarms after the next key", async () => {
    let keys!: Keys
    const fired: string[] = []
    const t: Harness = await mountNode(
      <Probe onKeys={k => { keys = k }} onFire={id => fired.push(id)} />,
    )
    await until(t, () => t.frame().includes("probe"))

    // Bare 'n' is list.new, not session.new (leader unarmed).
    await act(async () => { await t.keys.typeText("n") })
    await t.settle()
    expect(fired).toEqual(["list.new"])

    // Arm → keys.leader true; 'n' now matches session.new.
    act(() => t.keys.pressKey("x", { ctrl: true }))
    await t.settle()
    expect(keys.leader).toBe(true)
    await act(async () => { await t.keys.typeText("n") })
    await t.settle()
    expect(fired).toEqual(["list.new", "session.new"])
    // Disarmed after that one key.
    expect(keys.leader).toBe(false)

    // Secondary non-leader alternate still works: editor.open has ctrl+g.
    act(() => t.keys.pressKey("g", { ctrl: true }))
    await t.settle()
    expect(fired).toEqual(["list.new", "session.new", "editor.open"])
    t.destroy()
  })

  test("leader blurs focused textarea so bare letter isn't consumed", async () => {
    let keys!: Keys
    const fired: string[] = []
    const t: Harness = await mountNode(
      <box flexDirection="column">
        <Probe onKeys={k => { keys = k }} onFire={id => fired.push(id)} />
        <textarea focused minHeight={1} />
      </box>,
      { width: 80, height: 10 },
    )
    await until(t, () => t.frame().includes("probe"))

    // Without leader: 'e' goes into the textarea.
    await act(async () => { await t.keys.typeText("e") })
    await t.settle()
    expect(fired).toEqual([])
    expect(t.frame()).toContain("e")

    // With leader: textarea blurred, 'e' matches editor.open, doesn't type.
    act(() => t.keys.pressKey("x", { ctrl: true }))
    await t.settle()
    expect(keys.leader).toBe(true)
    await act(async () => { await t.keys.typeText("e") })
    await t.settle()
    expect(fired).toEqual(["editor.open"])
    // refocused — next char types again
    expect(keys.leader).toBe(false)
    await act(async () => { await t.keys.typeText("z") })
    await t.settle()
    expect(t.frame()).toContain("ez")
    t.destroy()
  })

  test("user override via preferences.keys rebinding", async () => {
    prefs.set("keys", { "tab.next": "ctrl+n", "session.new": "none" })
    let keys!: Keys
    const t: Harness = await mountNode(<Probe onKeys={k => { keys = k }} />)
    await until(t, () => t.frame().includes("probe"))

    const ev = (o: Partial<ParsedKey> & { name: string }) => ({
      ctrl: false, meta: false, shift: false, option: false, number: false,
      sequence: o.name, raw: o.name, eventType: "press" as const, source: "raw" as const, ...o,
    })
    expect(keys.match("tab.next", ev({ name: "n", ctrl: true }))).toBe(true)
    expect(keys.match("tab.next", ev({ name: "right", ctrl: true }))).toBe(false)
    expect(keys.print("tab.next")).toBe("Ctrl+N")
    // "none" override disables
    expect(keys.chord("session.new")).toHaveLength(0)
    expect(keys.print("session.new")).toBe("")
    t.destroy()
  })

  test("all(scope) returns resolved entries", async () => {
    let keys!: Keys
    const t: Harness = await mountNode(<Probe onKeys={k => { keys = k }} />)
    await until(t, () => t.frame().includes("probe"))
    const d = keys.all("dialog")
    expect(d.length).toBeGreaterThan(0)
    expect(d.every(e => e.scope === "dialog" && e.chord.length > 0)).toBe(true)
    t.destroy()
  })
})
