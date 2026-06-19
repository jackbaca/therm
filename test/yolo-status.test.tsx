import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"
import type { SessionInfo } from "../src/context/wire"

describe("yolo slash command", () => {
  test("/yolo toggles session approval bypass through config.set and updates session info", async () => {
    const info: SessionInfo = { model: "test-model", session_id: "test-sid", tools: {}, skills: {}, yolo: true }
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/yolo", "Toggle YOLO mode"]] }),
      "config.set": p => ({ key: p.key, value: "on", info }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/yolo") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("config.set")?.params.key === "yolo")

    expect(t.gw.last("config.set")?.params).toMatchObject({ key: "yolo", session_id: "test-sid" })
    expect(t.gw.last("slash.exec")).toBeUndefined()
    expect(t.gw.last("prompt.submit")).toBeUndefined()
    await until(t, () => t.frame().includes("yolo on"))
    t.destroy()
  })

  test("/yolo falls back to local info toggle when gateway returns only a value", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/yolo", "Toggle YOLO mode"]] }),
      "config.set": p => ({ key: p.key, value: "on" }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/yolo") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("config.set")?.params.key === "yolo")

    expect(t.gw.last("config.set")?.params).toMatchObject({ key: "yolo", session_id: "test-sid" })
    await until(t, () => t.frame().includes("yolo on"))
    t.destroy()
  })
})
