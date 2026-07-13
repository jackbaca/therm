import { describe, expect, test } from "bun:test"
import { act, createRef } from "react"
import { BoxRenderable, TextareaRenderable, type Renderable } from "@opentui/core"
import { Composer, type ComposerHandle } from "../src/components/chat/Composer"
import { acceptCompletion } from "../src/app/useCompletion"
import { atWordAt } from "../src/app/useAtRefPopover"
import { replaceSlashToken, slashTokenAt } from "../src/app/useSlashPopover"
import { LOCAL_COMMANDS, type SlashCommand } from "../src/app/slashCommands"
import type { DropDetectResponse, ImageAttachResponse } from "../src/context/wire"
import { tmpHome } from "./fixture/home"
import { MockGateway, mountNode, until } from "./harness"

type Opts = {
  gw?: MockGateway
  cmds?: ReadonlyArray<SlashCommand>
  streaming?: boolean
}

const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]

async function setup(opts: Opts = {}) {
  const gw = opts.gw ?? new MockGateway()
  const ref = createRef<ComposerHandle>()
  const sent: string[] = []
  const slashed: SlashCommand[] = []
  const queued: string[] = []
  const attached: ImageAttachResponse[] = []
  const t = await mountNode(
    <box flexDirection="column" flexGrow={1} width="100%" height="100%">
      <box flexGrow={1} />
      <Composer
        ref={ref}
        focused
        canSubmitPrompt
        ready
        streaming={opts.streaming ?? false}
        queue={[]}
        cmds={opts.cmds ?? LOCAL_COMMANDS}
        attachments={attached}
        onSend={text => sent.push(text)}
        onSlash={cmd => slashed.push(cmd)}
        onEnqueue={text => queued.push(text)}
        onAttach={item => attached.push(item)}
      />
    </box>,
    { gw, width: 120, height: 30 },
  )
  return { t, gw, ref, sent, slashed, queued, attached }
}

const count = (gw: MockGateway, method: string) =>
  gw.calls.filter(call => call.method === method).length

describe("composer", () => {
  test("newline input submits once while blank input is ignored", async () => {
    const fx = await setup()
    await using t = fx.t

    await act(async () => { await t.keys.typeText("line one") })
    act(() => t.keys.pressEnter({ shift: true }))
    await act(async () => { await t.keys.typeText("line two") })
    expect(fx.ref.current?.value()).toBe("line one\nline two")
    expect(fx.sent).toEqual([])

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(fx.sent).toEqual(["line one\nline two"])
    expect(fx.ref.current?.value()).toBe("")

    await act(async () => { await t.keys.typeText("   ") })
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(fx.sent).toEqual(["line one\nline two"])
  })

  test("newline rebinding changes textarea ownership without changing submit", async () => {
    await using _home = await tmpHome({ prefs: { keys: { "input.newline": "ctrl+o" } } })
    const fx = await setup()
    await using t = fx.t

    await act(async () => { await t.keys.typeText("a") })
    act(() => t.keys.pressEnter({ shift: true }))
    await t.settle()
    expect(fx.ref.current?.value()).toBe("a")
    expect(fx.sent).toEqual([])

    act(() => t.keys.pressKey("o", { ctrl: true }))
    await act(async () => { await t.keys.typeText("b") })
    expect(fx.ref.current?.value()).toBe("a\nb")
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(fx.sent).toEqual(["a\nb"])
  })

  test("multiline movement owns history until the caret reaches its boundary", async () => {
    const fx = await setup()
    await using t = fx.t

    await act(async () => { await t.keys.typeText("seed") })
    act(() => t.keys.pressEnter())
    await t.settle()

    act(() => fx.ref.current?.set("a\nb"))
    await t.settle()
    expect(fx.ref.current?.historyUp()).toBe(false)
    expect(fx.ref.current?.value()).toBe("a\nb")

    act(() => fx.ref.current?.set("draft"))
    await t.settle()
    expect(fx.ref.current?.historyUp()).toBe(true)
    await t.settle()
    expect(fx.ref.current?.value()).toBe("seed")
  })

  test("input geometry caps at six visible rows without truncating the draft", async () => {
    const fx = await setup()
    await using t = fx.t
    act(() => fx.ref.current?.set(Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")))
    await t.settle()

    const nodes = walk(t.renderer.root)
    const textarea = nodes.find((node): node is TextareaRenderable => node instanceof TextareaRenderable)
    const border = nodes.find((node): node is BoxRenderable =>
      node instanceof BoxRenderable && node.border === true)
    expect(textarea).toBeDefined()
    expect(border).toBeDefined()
    expect(textarea!.height).toBe(6)
    expect(textarea!.screenY).toBeGreaterThan(border!.screenY)
    expect(textarea!.screenY + textarea!.height).toBeLessThan(border!.screenY + border!.height)
    expect(fx.ref.current?.lines()).toBe(10)
  })

  test("completion replacements preserve surrounding text and reject path-like slashes", () => {
    const input = "please /cl now"
    const spot = slashTokenAt(input, 10)
    expect(spot).not.toBeNull()
    expect(replaceSlashToken(input, spot!, LOCAL_COMMANDS.find(cmd => cmd.name === "clear")!))
      .toBe("please /clear now")

    expect(slashTokenAt("/tmp/file")).toBeNull()
    expect(slashTokenAt("https://host/path")).toBeNull()
    expect(slashTokenAt("see [label](/clear)")).toBeNull()
    expect(acceptCompletion(
      "please /zz now",
      { text: "zeta", display: "/zeta", meta: "remote" },
      8,
      10,
    )).toBe("please /zeta now")
  })

  test("a late completion cannot replace the newer request", async () => {
    let release!: (value: { items: Array<{ text: string; display: string; meta: string }> }) => void
    const gw = new MockGateway()
    gw.expect$("complete.path", p => {
      if (p.word === "src/o") return new Promise(done => { release = done })
      return { items: [{ text: "src/new.ts", display: "new", meta: "file" }] }
    }, {
      min: 2,
      max: 2,
      match: p => p.word === "src/o" || p.word === "src/n",
    })
    const fx = await setup({ gw, cmds: [] })
    await using t = fx.t

    await act(async () => { await t.keys.typeText("read src/o") })
    await until(t, () => gw.last("complete.path")?.params.word === "src/o")
    act(() => fx.ref.current?.set("read src/n"))
    await until(t, () => gw.last("complete.path")?.params.word === "src/n")
    await until(t, () => fx.ref.current?.popOpen() === true)

    await act(async () => {
      release({ items: [{ text: "src/old.ts", display: "old", meta: "file" }] })
      await Promise.resolve()
    })
    await t.settle()
    act(() => fx.ref.current?.popAccept())
    await t.settle()
    expect(fx.ref.current?.value()).toBe("read src/new.ts ")
  })

  test("completion failure leaves the draft intact and blocks submit", async () => {
    const gw = new MockGateway()
    gw.expect$("complete.path", () => { throw new Error("offline") }, {
      match: p => p.word === "./bad",
    })
    const fx = await setup({ gw, cmds: [] })
    await using t = fx.t

    await act(async () => { await t.keys.typeText("see ./bad") })
    await until(t, () => count(gw, "complete.path") === 1)
    await until(t, () => fx.ref.current?.popOpen() === true)
    act(() => t.keys.pressEnter())
    await t.settle()

    expect(fx.sent).toEqual([])
    expect(fx.ref.current?.value()).toBe("see ./bad")
  })

  test("at-reference completion inserts the owned result without submitting", async () => {
    const gw = new MockGateway()
    gw.expect$("complete.path", () => ({
      items: [{ text: "@file:README.md", display: "README.md", meta: "file" }],
    }), {
      match: p => p.word === "@file:REA",
    })
    const fx = await setup({ gw, cmds: [] })
    await using t = fx.t

    await act(async () => { await t.keys.typeText("review @file:REA") })
    await until(t, () => count(gw, "complete.path") === 1)
    await until(t, () => fx.ref.current?.popOpen() === true)
    act(() => fx.ref.current?.popAccept())
    await t.settle()

    expect(fx.ref.current?.value()).toBe("review @file:README.md ")
    expect(fx.sent).toEqual([])
    expect(atWordAt("/help @")).toBeNull()
    expect(atWordAt("a @b c", 3)).toEqual({ word: "@b", start: 2 })
  })

  test("streaming queues prose but routes slash-shaped input through send", async () => {
    const fx = await setup({ streaming: true })
    await using t = fx.t

    await act(async () => { await t.keys.typeText("follow-up") })
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(fx.queued).toEqual(["follow-up"])
    expect(fx.sent).toEqual([])

    await act(async () => { await t.keys.typeText("/ste") })
    await until(t, () => fx.ref.current?.popOpen() === true)
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(fx.ref.current?.value()).toBe("/steer")
    expect(fx.queued).toEqual(["follow-up"])

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(fx.sent).toEqual(["/steer"])
    expect(fx.queued).toEqual(["follow-up"])
  })

  test("paste normalizes short text and delegates large payloads once", async () => {
    const gw = new MockGateway()
    const big = Array.from({ length: 6 }, (_, i) => `line${i}`).join("\n")
    gw.expect$("paste.collapse", () => ({ placeholder: "[owned paste]" }), {
      match: p => p.text === big,
    })
    const fx = await setup({ gw, cmds: [] })
    await using t = fx.t

    await act(async () => { await t.keys.pasteBracketedText("a\r\nb\r\n") })
    expect(fx.ref.current?.value()).toBe("a\nb")
    act(() => fx.ref.current?.set(""))
    await act(async () => { await t.keys.pasteBracketedText(big) })
    await until(t, () => fx.ref.current?.value() === "[owned paste] ")
  })

  test("drop detection mirrors attachments and falls back to verbatim on failure", async () => {
    const gw = new MockGateway()
    const texts = [
      "/tmp/shot.png what is this?",
      "/tmp/report.pdf",
      "~/missing.png",
    ]
    gw.expect$("input.detect_drop", p => {
      if (p.text === texts[0]) return {
        matched: true,
        is_image: true,
        path: "/tmp/shot.png",
        count: 1,
        name: "shot.png",
        text: "what is this?",
      } satisfies DropDetectResponse
      if (p.text === texts[1]) return {
        matched: true,
        is_image: false,
        path: "/tmp/report.pdf",
        name: "report.pdf",
        text: "[User attached file: /tmp/report.pdf]",
      } satisfies DropDetectResponse
      throw new Error("drop unavailable")
    }, {
      min: 3,
      max: 3,
      match: p => texts.includes(String(p.text)),
    })
    const fx = await setup({ gw, cmds: [] })
    await using t = fx.t

    await act(async () => { await t.keys.pasteBracketedText(texts[0]) })
    await until(t, () => fx.attached.length === 1)
    expect(fx.attached[0]).toMatchObject({
      attached: true,
      path: "/tmp/shot.png",
      count: 1,
      name: "shot.png",
    })
    expect(fx.ref.current?.value()).toBe("what is this? ")

    act(() => fx.ref.current?.set(""))
    await act(async () => { await t.keys.pasteBracketedText(texts[1]) })
    await until(t, () => fx.attached.length === 2)
    expect(fx.attached[1]).toEqual({ attached: true, path: "/tmp/report.pdf", name: "report.pdf" })
    expect(fx.ref.current?.value()).toBe("[User attached file: /tmp/report.pdf] ")

    act(() => fx.ref.current?.set(""))
    await act(async () => { await t.keys.pasteBracketedText(texts[2]) })
    await until(t, () => fx.ref.current?.value() === texts[2])
    expect(gw.calls.filter(call => call.method === "input.detect_drop").map(call => call.params.text))
      .toEqual(texts)
  })
})
