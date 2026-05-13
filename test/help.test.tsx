import { describe, expect, test } from "bun:test"
import { mountNode, until, type Harness } from "./harness"
import { HelpDialog } from "../src/dialogs/help"
import { DEFAULTS } from "../src/keys"
import * as prefs from "../src/context/preferences"

describe("HelpDialog", () => {
  test("renders every bound catalog action", async () => {
    const t: Harness = await mountNode(<HelpDialog />, { width: 120, height: 60 })
    await until(t, () => t.frame().includes("Keyboard Shortcuts"))
    const f = t.frame()

    expect(f).toContain("leader = Ctrl+X")
    expect(f).toContain("Global")
    expect(f).toContain("Lists")

    // Every description for a non-empty default chord appears somewhere.
    for (const [id, d] of Object.entries(DEFAULTS))
      if (id !== "leader" && d.chord !== "none")
        expect(f, id).toContain(d.desc.slice(0, 20))

    // Sample chord labels
    expect(f).toContain("Ctrl+X E")   // editor.open (leader substituted)
    expect(f).toContain("Alt+→")       // tab.next
    expect(f).toContain("Shift+Enter")// input.newline first alternate
    t.destroy()
  })

  test("reflects user override and hides 'none'", async () => {
    prefs.set("keys", { "tab.next": "ctrl+n", "reply.copy": "none" })
    const t: Harness = await mountNode(<HelpDialog />, { width: 120, height: 60 })
    await until(t, () => t.frame().includes("Keyboard Shortcuts"))
    const f = t.frame()
    expect(f).toContain("Ctrl+N")
    expect(f).not.toContain("Alt+→")
    expect(f).not.toContain("Copy last assistant")
    t.destroy()
  })
})
