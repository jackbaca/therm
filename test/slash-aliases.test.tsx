import { describe, expect, test } from "bun:test"
import { useImperativeHandle, forwardRef } from "react"
import { createRef } from "react"
import { mountNode, until, MockGateway, type Harness } from "./harness"
import { useSlashCommands } from "../src/app/useSlashCommands"
import type { SlashCommand } from "../src/app/slashCommands"

type Handle = { cmds: () => ReadonlyArray<SlashCommand> }

const Probe = forwardRef<Handle>((_, ref) => {
  const { cmds } = useSlashCommands()
  useImperativeHandle(ref, () => ({ cmds: () => cmds }), [cmds])
  return null
})

async function setup(catalog: { pairs: [string, string][], canon?: Record<string, string> }) {
  const gw = new MockGateway()
  gw.on$("commands.catalog", () => catalog)
  const ref = createRef<Handle>()
  const t: Harness = await mountNode(<Probe ref={ref} />, { gw })
  await until(t, () => (ref.current?.cmds() ?? []).some(c => c.name === "quit"))
  return { t, ref }
}

describe("useSlashCommands catalog aliases", () => {
  test("keeps catalog alias canonicalization for /q → /queue and /exit → /quit", async () => {
    const { t, ref } = await setup({
      pairs: [["/queue", "Queue a prompt"], ["/quit", "Exit the CLI"]],
      canon: { "/q": "/queue", "/exit": "/quit" },
    })
    const queue = ref.current!.cmds().find(c => c.name === "queue")!
    const quit = ref.current!.cmds().find(c => c.name === "quit")!
    expect(queue.aliases).toContain("q")
    expect(quit.aliases).toContain("exit")
    expect(quit.aliases).not.toContain("q")
    t.destroy()
  })

  test("keeps /compact canonicalized as a /compress alias", async () => {
    const { t, ref } = await setup({
      pairs: [["/compress", "Compress conversation context"]],
      canon: { "/compact": "/compress" },
    })
    const cmd = ref.current!.cmds().find(c => c.name === "compress")!
    expect(cmd.aliases).toContain("compact")
    expect(cmd.target).toBe("local")
    t.destroy()
  })
})
