import { expect, test } from "bun:test"
import { getMaxListeners } from "node:events"
import { mountNode } from "./harness"
import { Kanban } from "../src/tabs/Kanban"

test("renderer listener budget covers multi-scrollbox tabs", async () => {
  await using t = await mountNode(<Kanban focused />)
  expect(getMaxListeners(t.renderer)).toBeGreaterThanOrEqual(64)
})
