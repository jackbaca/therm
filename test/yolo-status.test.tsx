import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("yolo slash command", () => {
  const check = async (response: { key: string; value: string; scope?: string }) => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/yolo", "Toggle YOLO mode"]] }),
      "config.set": () => response,
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/yolo") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("config.set")?.params.key === "yolo")

    expect(t.gw.last("config.set")?.params).toEqual({ key: "yolo", session_id: "test-sid" })
    expect(t.gw.last("slash.exec")).toBeUndefined()
    expect(t.gw.last("prompt.submit")).toBeUndefined()

    await until(t, () => t.frame().includes(`yolo ${response.value}`))
    t.destroy()
  }

  test("/yolo accepts the v2026.4.23 value-only response", async () => {
    await check({ key: "yolo", value: "on" })
  })

  test("/yolo accepts the v2026.6.19 session-scoped response", async () => {
    await check({ key: "yolo", value: "on", scope: "session" })
  })
})
