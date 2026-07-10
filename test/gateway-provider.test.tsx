import { expect, test } from "bun:test"
import { act } from "react"
import { useGatewayReady } from "../src/context/gateway"
import { mount, mountNode, until, MockGateway } from "./harness"

const Ready = () => <text>{useGatewayReady() ? "gateway ready" : "gateway down"}</text>

test("gateway process exit clears provider readiness", async () => {
  const gw = new MockGateway()
  const t = await mountNode(<Ready />, { gw })
  await until(t, () => t.frame().includes("gateway ready"))

  act(() => gw.emit("exit", 7))
  await until(t, () => t.frame().includes("gateway down"))
  expect(t.frame()).not.toContain("gateway ready")
  t.destroy()
})

test("gateway process exit surfaces in the app transcript", async () => {
  const gw = new MockGateway()
  const t = await mount({ gw, launch: { mode: "new", splash: false } })
  await until(t, () => t.frame().includes("Ready"))

  act(() => gw.emit("exit", 7))
  await until(t, () => t.frame().includes("gateway exited (7)"))
  expect(t.frame()).not.toContain("● Ready")
  t.destroy()
})
