import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runtimeDescriptor } from "eikon"
import { mountNode, until } from "./harness"
import { EikonPickerDialog } from "../src/dialogs/eikon-picker"

const runtime = (name: string, face: string) => [
  JSON.stringify({ eikon: 1, name, width: 10, height: 3, author: "tester", states: ["idle"] }),
  JSON.stringify({ state: "idle", fps: 4, frame_count: 1 }),
  JSON.stringify({ f: 0, data: `  ${face}   \n  /| |\\   \n  == ==   ` }),
].join("\n")

const fixture = () => {
  const path = mkdtempSync(join(tmpdir(), "eikon-pick-"))
  writeFileSync(join(path, "first.eikon"), runtimeDescriptor(runtime("first", "[1_1]"), { encoding: "gzip" }).bytes)
  writeFileSync(join(path, "second.eikon"), runtimeDescriptor(runtime("second", "[2_2]"), { encoding: "gzip" }).bytes)
  return {
    path,
    [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }),
  }
}

describe("EikonPickerDialog", () => {
  test("navigation previews and selects the highlighted runtime artifact", async () => {
    using dir = fixture()
    const picks: string[] = []
    await using t = await mountNode(
      <EikonPickerDialog dirs={[dir.path]} onSelect={name => picks.push(name)} />,
      { width: 120, height: 40 },
    )

    await until(t, () => t.frame().includes("[1_1]"))
    act(() => t.keys.pressArrow("down"))
    await until(t, () => t.frame().includes("[2_2]"))
    act(() => t.keys.pressEnter())
    await until(t, () => picks.length === 1)

    expect(picks).toEqual(["second"])
  })
})
