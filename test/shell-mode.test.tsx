// Shell mode (`!` at col 0) — entry/exit/submit routing.

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("shell mode (t_cfbfd0c8)", () => {
  test("`!` at offset 0 enters shell mode; Enter routes to shell.exec and exits", async () => {
    const gw = new MockGateway({
      "shell.exec": p => ({ stdout: `ran: ${p.command}`, stderr: "", code: 0 }),
    })
    await using t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("!") })
    await until(t, () => t.frame().includes("Shell"))
    // `!` literal consumed, not in the textarea
    expect(t.frame()).toContain("$")
    expect(t.frame()).toContain("Run a shell command")
    expect(t.frame()).not.toContain("> !")

    await act(async () => { await t.keys.typeText("ls -la") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("ran: ls -la"))

    expect(gw.last("shell.exec")?.params.command).toBe("ls -la")
    expect(gw.last("prompt.submit")).toBeUndefined()
    // mode resets to normal after submit
    expect(t.frame()).toContain("Ready")
    expect(t.frame()).not.toContain("exit shell mode")
  })

  test("Esc exits without executing; `!` mid-buffer does NOT enter", async () => {
    await using t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("hi !") })
    await t.settle()
    expect(t.frame()).not.toContain("Shell")
    // clear
    act(() => t.keys.pressKey("c", { ctrl: true }))
    await t.settle()

    await act(async () => { await t.keys.typeText("!") })
    await until(t, () => t.frame().includes("Shell"))
    await act(async () => { await t.keys.typeText("rm -rf /") })
    act(() => t.keys.pressEscape())
    await until(t, () => !t.frame().includes("exit shell mode"))
    expect(t.gw.last("shell.exec")).toBeUndefined()
  })

  test("backspace at offset 0 exits shell mode", async () => {
    await using t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("!") })
    await until(t, () => t.frame().includes("Shell"))
    act(() => t.keys.pressBackspace())
    await until(t, () => !t.frame().includes("Shell"))
    expect(t.frame()).toContain("Ready")
  })

  test("nonzero exit toasts; stderr surfaces", async () => {
    const gw = new MockGateway({
      "shell.exec": () => ({ stdout: "", stderr: "oops", code: 2 }),
    })
    await using t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("!") })
    await until(t, () => t.frame().includes("Shell"))
    await act(async () => { await t.keys.typeText("false") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("stderr:"))
    expect(t.frame()).toContain("oops")
    expect(t.frame()).toContain("exit 2")
  })
})
