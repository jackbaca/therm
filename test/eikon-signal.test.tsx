import { expect, test } from "bun:test"
import { mountNode, until } from "./harness"
import { AnimatedAvatar } from "../src/components/avatar/AnimatedAvatar"
import { parseEikon } from "../src/components/avatar/eikon"

const BUSY = [
  JSON.stringify({
    type: "header",
    eikon: 1,
    title: "signal fixture",
    author: { name: "test" },
    size: { cols: 4, rows: 1 },
    defaultSignal: "state.idle",
    signals: {
      "state.idle": { clip: "idle" },
      "state.working": { clip: "busy", fallback: "state.idle" },
    },
  }),
  JSON.stringify({ type: "clip", name: "idle", fps: 1, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["IDLE"] }),
  JSON.stringify({ type: "clip", name: "busy", fps: 1, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "busy", index: 0, rows: ["BUSY"] }),
].join("\n") + "\n"

test("AnimatedAvatar resolves Eikon signals instead of direct clip names", async () => {
  const eikon = parseEikon(BUSY)
  expect(eikon.states.has("busy")).toBe(true)
  expect(eikon.states.has("working")).toBe(false)

  await using t = await mountNode(<AnimatedAvatar state="working" eikon={eikon} />)
  await until(t, () => t.frame().includes("BUSY"))
  expect(t.frame()).not.toContain("IDLE")
})
