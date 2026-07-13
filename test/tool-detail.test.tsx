import { describe, expect, test, beforeEach } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import * as prefs from "../src/context/preferences"
import { Tool } from "../src/components/chat/tool"
import type { ToolPart } from "../src/types/message"

describe("preferences > usePref", () => {
  beforeEach(() => prefs.reset())

  test("re-renders subscriber on set()", async () => {
    const Probe = () => {
      const d = prefs.usePref("toolDetails") ?? "expanded"
      return <text>mode={d}</text>
    }
    const t = await mountNode(<Probe />, { width: 40, height: 3 })
    await until(t, () => t.frame().includes("mode=expanded"))
    act(() => prefs.set("toolDetails", "hidden"))
    await until(t, () => t.frame().includes("mode=hidden"))
    act(() => prefs.set("toolDetails", "collapsed"))
    await until(t, () => t.frame().includes("mode=collapsed"))
    // Restore default so later files mounting ThoughtCloud see
    // expanded-mode rendering.
    act(() => prefs.set("toolDetails", "expanded"))
    t.destroy()
  })
})

describe("Tool > detail mode", () => {
  const diff = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n"
  const file: ToolPart = {
    type: "tool", id: "t1", name: "patch", args: "",
    preview: "src/x.ts", status: "done", duration: 42, diff,
  }
  const read: ToolPart = {
    type: "tool", id: "t2", name: "read_file", args: "",
    preview: "src/y.ts", status: "done", duration: 5,
  }

  const mount = (part: ToolPart, detail: prefs.DetailMode) => mountNode(
    <box flexDirection="column" width="100%" height="100%">
      <Tool tool={part} detail={detail} />
    </box>,
    { width: 100, height: 20 },
  )


  test("hidden: completed tool renders nothing; running still shows", async () => {
    const t = await mount(file, "hidden")
    await t.settle()
    expect(t.frame().trim()).toBe("")
    t.destroy()

    const running: ToolPart = { ...read, status: "running", duration: undefined }
    const r = await mount(running, "hidden")
    await until(r, () => r.frame().includes("src/y.ts") || r.frame().trim().length > 0)
    expect(r.frame().trim().length).toBeGreaterThan(0)
    r.destroy()
  })

  test("expanded mode shows verbose args and result details", async () => {
    const verbose: ToolPart = {
      type: "tool", id: "t3", name: "patch", args: "",
      preview: "src/z.ts", status: "done", duration: 10,
      verboseArgs: "{\"path\":\"src/z.ts\"}",
      verboseResult: "patched result",
    }
    const t = await mount(verbose, "expanded")
    await until(t, () => t.frame().includes("patched result"))
    expect(t.frame()).toContain('{"path":"src/z.ts"}')
    t.destroy()
  })

  test("expanded error mode prefers verbose error detail", async () => {
    const verbose: ToolPart = {
      type: "tool", id: "t4", name: "terminal", args: "",
      preview: "bun test", status: "error", duration: 10,
      result: "failed", verboseResult: "failed\ntraceback line",
    }
    const t = await mount(verbose, "expanded")
    await until(t, () => t.frame().includes("traceback line"))
    expect(t.frame()).toContain("traceback line")
    t.destroy()
  })

  test("collapsed mode keeps verbose details hidden", async () => {
    const verbose: ToolPart = {
      type: "tool", id: "t3", name: "patch", args: "",
      preview: "src/z.ts", status: "done", duration: 10,
      verboseArgs: "{\"path\":\"src/z.ts\"}",
      verboseResult: "patched result",
    }
    const t = await mount(verbose, "collapsed")
    await t.settle()
    expect(t.frame().trim()).not.toBe("")
    expect(t.frame()).not.toContain("patched result")
    t.destroy()
  })
})
