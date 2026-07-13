import { test, expect } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { configDir } from "../src/utils/paths"
import * as prefs from "../src/context/preferences"
import { tmpHome } from "./fixture/home"

test("v1.0.0 eikonPath preference migrates to an eikon name", async () => {
  await using home = await tmpHome()
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(`${configDir()}/tui.json`,
    JSON.stringify({ eikonPath: "/home/user/.hermes/eikons/ares/ares.eikon", theme: "t" }))
  prefs.reset()
  expect(prefs.get("eikon")).toBe("ares")
  expect(prefs.get("eikonPath")).toBeUndefined()
  expect(prefs.get("theme")).toBe("t")
})
