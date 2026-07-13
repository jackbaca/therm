import { describe, expect, test } from "bun:test"
import { act } from "react"
import { BoxRenderable, TextRenderable, type Renderable } from "@opentui/core"
import { mount, mountNode, until, MockGateway } from "./harness"
import { Composer } from "../src/components/chat/Composer"
import { LOCAL_COMMANDS } from "../src/app/slashCommands"

function walk(node: Renderable): Renderable[] {
  return [node, ...node.getChildren().flatMap(walk)]
}

describe("composer attachments", () => {
  test("clipboard routing preserves LIFO detach and submits an image-only prompt without path duplication", async () => {
    let n = 0
    const gw = new MockGateway()
    gw.expect$("clipboard.paste", () => {
      n++
      return { attached: true, path: `/tmp/image-${n}.png`, name: `image-${n}.png`, count: n }
    }, { min: 2, max: 2 })
    gw.expect$("prompt.submit", () => ({ status: "accepted" }), {
      match: params => params.text === "",
    })

    await using t = await mount({ gw })

    act(() => t.keys.pressKey("v", { ctrl: true }))
    await until(t, () => t.frame().includes("image-1.png"))
    act(() => t.keys.pressKey("v", { ctrl: true }))
    await until(t, () => t.frame().includes("image-2.png"))

    act(() => t.keys.pressBackspace())
    await until(t, () => !t.frame().includes("image-2.png"))
    expect(t.frame()).toContain("image-1.png")

    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("prompt.submit") !== undefined)
    expect(t.gw.last("prompt.submit")?.params.text).toBe("")
  })

  test("attachment tray remains within the composer border", async () => {
    await using t = await mountNode(
      <box flexDirection="column" flexGrow={1} width="100%" height="100%">
        <box flexGrow={1} />
        <Composer
          focused canSubmitPrompt={true} ready streaming={false} cmds={LOCAL_COMMANDS}
          attachments={[{ attached: true, path: "/tmp/inside.png", name: "inside.png", count: 1 }]}
          onSend={() => {}} onSlash={() => {}}
        />
      </box>,
      { width: 120, height: 30 },
    )
    await until(t, () => walk(t.renderer.root).some(node =>
      node instanceof TextRenderable && node.plainText.includes("inside.png")))

    const nodes = walk(t.renderer.root)
    const border = nodes.find((node): node is BoxRenderable =>
      node instanceof BoxRenderable && node.border === true)
    const chip = nodes.find((node): node is TextRenderable =>
      node instanceof TextRenderable && node.plainText.includes("inside.png"))

    expect(border).toBeDefined()
    expect(chip).toBeDefined()
    expect(chip!.screenX).toBeGreaterThan(border!.screenX)
    expect(chip!.screenX + chip!.width).toBeLessThan(border!.screenX + border!.width)
    expect(chip!.screenY).toBeGreaterThan(border!.screenY)
    expect(chip!.screenY + chip!.height).toBeLessThan(border!.screenY + border!.height)
  })
})
