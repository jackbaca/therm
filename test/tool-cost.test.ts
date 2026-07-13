import { describe, expect, test } from "bun:test"
import { cost } from "../src/components/chat/tool"
import type { ToolPart } from "../src/types/message"

describe("tool row cost", () => {
  test("caps trail rows and keeps delegated tasks compact", () => {
    const trail = Array.from({ length: 20 }, (_, i) => ({ name: "read_file", preview: `src/${i}.ts` }))
    const tool: ToolPart = {
      type: "tool", id: "sub", name: "custom_parent", args: "",
      preview: "parent", status: "running", trail,
    }
    const task: ToolPart = {
      type: "tool", id: "task", name: "delegate_task", args: "",
      preview: "delegate", status: "running",
    }

    expect(cost(tool, "expanded")).toBe(10)
    expect(cost(task, "expanded")).toBe(2)
  })
})
