import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { BackgroundProvider, useBackground } from "../src/app/background"

type Api = ReturnType<typeof useBackground>

const Host = ({ grab }: { grab: (api: Api) => void }) => {
  const api = useBackground()
  grab(api)
  return (
    <box flexDirection="column">
      <text>{`count:${api.count}`}</text>
      <text>{`ids:${api.ids.join(",")}`}</text>
    </box>
  )
}

const mountHost = async () => {
  let api: Api | undefined
  const t = await mountNode(
    <BackgroundProvider><Host grab={a => { api = a }} /></BackgroundProvider>,
    { width: 40, height: 6 },
  )
  return { t, get: () => api! }
}

describe("BackgroundProvider", () => {
  test("starts empty", async () => {
    const { t } = await mountHost()
    expect(t.frame()).toContain("count:0")
    expect(t.frame()).toContain("ids:")
    t.destroy()
  })

  test("register adds ids and bumps count reactively", async () => {
    const { t, get } = await mountHost()
    act(() => { get().register("a"); get().register("b") })
    await until(t, () => t.frame().includes("count:2"))
    expect(t.frame()).toContain("ids:a,b")
    t.destroy()
  })

  test("register is a no-op for falsy or duplicate ids", async () => {
    const { t, get } = await mountHost()
    act(() => { get().register("a"); get().register("a"); get().register("") })
    await until(t, () => t.frame().includes("count:1"))
    expect(t.frame()).toContain("ids:a")
    t.destroy()
  })

  test("unregister removes present ids and is a no-op for absent", async () => {
    const { t, get } = await mountHost()
    act(() => { get().register("a"); get().register("b") })
    await until(t, () => t.frame().includes("count:2"))
    act(() => { get().unregister("a"); get().unregister("missing") })
    await until(t, () => t.frame().includes("count:1"))
    expect(t.frame()).toContain("ids:b")
    t.destroy()
  })
})
