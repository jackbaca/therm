import { describe, test, expect, beforeEach } from "bun:test"
import { rmSync } from "fs"
import { join } from "path"
import { configDir } from "../src/utils/paths"
import { Stash } from "../src/app/stash"

describe("Stash", () => {
  beforeEach(() => {
    rmSync(join(configDir(), "stash.jsonl"), { force: true })
  })

  test("push/pop is LIFO; all() is newest-first", () => {
    expect(Stash.pop()).toBeNull()
    expect(Stash.push("first")).toBe(1)
    expect(Stash.push("second")).toBe(2)
    expect(Stash.all().map(e => e.text)).toEqual(["second", "first"])
    expect(Stash.pop()?.text).toBe("second")
    expect(Stash.pop()?.text).toBe("first")
    expect(Stash.pop()).toBeNull()
  })

  test("drop removes by timestamp key", () => {
    Stash.push("keep")
    Stash.push("gone")
    const list = Stash.all()
    Stash.drop(list[0].at)
    expect(Stash.all().map(e => e.text)).toEqual(["keep"])
  })

  test("multiline round-trips", () => {
    Stash.push("a\nb\nc")
    expect(Stash.pop()?.text).toBe("a\nb\nc")
  })
})
