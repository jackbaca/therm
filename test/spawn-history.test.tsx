import { test } from "bun:test"
import { useEffect } from "react"
import { useDialog } from "../src/ui/dialog"
import { useGateway } from "../src/context/gateway"
import { openSpawnHistory } from "../src/dialogs/spawn-history"
import { mountNode, until } from "./harness"

const Host = () => {
  const dialog = useDialog()
  const gw = useGateway()
  useEffect(() => { openSpawnHistory(dialog, gw, "sid") }, [])
  return null
}

test("spawn history list failure stays visible", async () => {
  const t = await mountNode(<Host />, {
    handlers: { "spawn_tree.list": () => { throw new Error("spawn list unavailable") } },
  })
  await until(t, () => t.frame().includes("spawn list unavailable"))
  t.destroy()
})

test("spawn snapshot failure stays visible", async () => {
  const t = await mountNode(<Host />, {
    handlers: {
      "spawn_tree.list": () => ({ entries: [{
        path: "/tmp/spawn.json", session_id: "sid", count: 1,
        label: "one agent", finished_at: Date.now() / 1000,
      }] }),
      "spawn_tree.load": () => { throw new Error("spawn snapshot unavailable") },
    },
  })
  await until(t, () => t.frame().includes("one agent"))
  t.keys.pressEnter()
  await until(t, () => t.frame().includes("spawn snapshot unavailable"))
  t.destroy()
})
