import { describe, expect, test } from "bun:test"
import { isDangerous, isLoopback, warningFor } from "../src/app/control"
import { TABS } from "../src/app/tabs"

const idx = (name: string) => TABS.findIndex(t => t.name === name)

describe("control.isDangerous — guards the intended tabs by name, not hardcoded index", () => {
  test("Chat: Enter guarded (regression — was drifted to Context's index)", () => {
    expect(isDangerous(idx("Chat"), "return", false)).toBe(true)
  })

  test("Sessions: d/delete/Enter guarded (session switch/delete via Sessions sub-tab)", () => {
    expect(isDangerous(idx("Sessions"), "d", false)).toBe(true)
    expect(isDangerous(idx("Sessions"), "delete", false)).toBe(true)
    expect(isDangerous(idx("Sessions"), "return", false)).toBe(true)
  })

  test("Config group: Config-sub toggles + Env-sub deletions + Ctrl+S guarded (union across sub-tabs)", () => {
    const c = idx("Config")
    expect(isDangerous(c, "space", false)).toBe(true)
    expect(isDangerous(c, "return", false)).toBe(true)
    expect(isDangerous(c, "h", false)).toBe(true)
    expect(isDangerous(c, "l", false)).toBe(true)
    expect(isDangerous(c, "[", false)).toBe(true)
    expect(isDangerous(c, "]", false)).toBe(true)
    expect(isDangerous(c, "d", false)).toBe(true)
    expect(isDangerous(c, "delete", false)).toBe(true)
    expect(isDangerous(c, "s", true)).toBe(true)
    expect(isDangerous(c, "s", false)).toBe(false)  // bare 's' fine
  })

  test("Profiles & Automation group: return/space/d/delete/k guarded (profile/cron/kanban mutations)", () => {
    const p = idx("Profiles & Automation")
    expect(isDangerous(p, "return", false)).toBe(true)
    expect(isDangerous(p, "space", false)).toBe(true)
    expect(isDangerous(p, "d", false)).toBe(true)
    expect(isDangerous(p, "delete", false)).toBe(true)
    expect(isDangerous(p, "k", false)).toBe(true)
  })

  test("Unknown tab index returns false (no crash)", () => {
    expect(isDangerous(99, "return", false)).toBe(false)
    expect(isDangerous(-1, "return", false)).toBe(false)
  })
})

describe("control.isLoopback — loopback hostname detection", () => {
  test("loopback hostnames pass", () => {
    expect(isLoopback("127.0.0.1")).toBe(true)
    expect(isLoopback("::1")).toBe(true)
    expect(isLoopback("localhost")).toBe(true)
  })

  test("non-loopback hostnames fail", () => {
    expect(isLoopback("0.0.0.0")).toBe(false)
    expect(isLoopback("::")).toBe(false)
    expect(isLoopback("192.168.1.5")).toBe(false)
    expect(isLoopback("")).toBe(false)
  })
})

describe("control.warningFor — exposure warning decision", () => {
  test("control off → no warning", () => {
    expect(warningFor(false, "0.0.0.0", 7777)).toBe(null)
  })

  test("control on + loopback → no warning", () => {
    expect(warningFor(true, "127.0.0.1", 7777)).toBe(null)
    expect(warningFor(true, "localhost", 7777)).toBe(null)
    expect(warningFor(true, "::1", 7777)).toBe(null)
  })

  test("control on + non-loopback → warning with host/port", () => {
    const w = warningFor(true, "0.0.0.0", 7777)
    expect(w).not.toBe(null)
    expect(w!.host).toBe("0.0.0.0")
    expect(w!.port).toBe(7777)
    expect(w!.message).toContain("0.0.0.0:7777")
    expect(w!.message).toContain("CONTROL_BIND=127.0.0.1")
  })

  test("non-standard external IP also warns", () => {
    const w = warningFor(true, "192.168.1.5", 8080)
    expect(w).not.toBe(null)
    expect(w!.host).toBe("192.168.1.5")
    expect(w!.port).toBe(8080)
  })
})
