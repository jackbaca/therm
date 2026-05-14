import { expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliRenderer } from "@opentui/core"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

// Child that speaks the stderr pick protocol then exits — stands in for
// the real browser so browse()'s spawn/drain/install path is exercised
// without needing a tty.
const body = '{"eikon":1,"name":"stub","width":8,"height":4,"glyph":"x","author":"t"}\n'
const stub = join(tmpdir(), `eikonsh-stub-${Date.now()}.ts`)
writeFileSync(stub,
  `const raw = ${JSON.stringify(body)}\n` +
  `process.stderr.write("\\x1e" + JSON.stringify({pick:"stub",size:new TextEncoder().encode(raw).length}) + "\\n" + raw)\n`)

const fake = {
  isDestroyed: true, suspend() {}, resume() {}, requestRender() {},
  currentRenderBuffer: { clear() {} },
} as unknown as CliRenderer

test("browse(): installs pick into $HERMES_HOME/eikons and returns it", async () => {
  process.env.EIKON_CMD = `bun ${stub}`
  const { browse, configured } = await import("../src/utils/eikonsh")
  expect(configured()).toBe(true)

  const got = await browse(fake)
  expect(got?.name).toBe("stub")
  expect(got?.path).toBe(join(HH, "eikons", "stub", "stub.eikon"))
  expect(existsSync(got!.path)).toBe(true)
  expect(existsSync(join(HH, "eikons", "stub", "source"))).toBe(true)
  expect((await Bun.file(got!.path).text())).toBe(body)

  delete process.env.EIKON_CMD
})

test("configured(): EIKON_SSH / EIKON_DIR resolution", async () => {
  delete process.env.EIKON_CMD
  delete process.env.EIKON_SSH
  delete process.env.EIKON_DIR
  const mod = await import("../src/utils/eikonsh")
  expect(mod.configured()).toBe(false)
  process.env.EIKON_SSH = "eikon.sh:22"
  expect(mod.configured()).toBe(true)
  delete process.env.EIKON_SSH
})
