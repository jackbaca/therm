import { test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { gen } from "../src/service/eikon-gen"
import { generator } from "./fixture/eikon"

let fx: ReturnType<typeof generator>
beforeEach(() => { fx = generator() })
afterEach(() => fx[Symbol.dispose]())

test("generator fixture removes partial setup after failure", () => {
  const root = fx.root
  const asset = fx.asset
  expect(() => generator(() => { throw new Error("fixture setup failed") }))
    .toThrow("fixture setup failed")
  expect(existsSync(root)).toBe(false)
  expect(existsSync(asset)).toBe(false)
})

test("generate(image) spawns venv python against image_generation_tool and returns local path", async () => {
  const out = await gen.generate("image", "a wise owl", { aspect: "square" })
  expect("path" in out && out.path).toBe(fx.asset)
  const argv = await Bun.file(fx.argv).text()
  expect(argv).toContain("image_generation_tool")
  expect(argv).toContain("_handle_image_generate")
  expect(argv).toContain("a wise owl")
  expect(argv).toContain("square")
})

test("generate(video) embeds duration + image_url seed in the -c body", async () => {
  const out = await gen.generate("video", "owl blinks", { seconds: 3, seed: "/tmp/base.png" })
  expect("path" in out).toBe(true)
  const argv = await Bun.file(fx.argv).text()
  expect(argv).toContain("video_generation_tool")
  expect(argv).toContain('"duration":3')
  expect(argv).toContain('"image_url":"/tmp/base.png"')
})

test("generate parses error shape", async () => {
  fx.script(`#!/usr/bin/env bash\necho '{"success": false, "error": "no FAL_KEY"}'\n`)
  const out = await gen.generate("image", "x", {})
  expect("err" in out && out.err).toBe("no FAL_KEY")
})

test("probe() reads check_*_requirements", async () => {
  fx.script(
    `#!/usr/bin/env bash\n` +
    `printf '%s\\n' "$@" > "${fx.argv}"\n` +
    `echo '{"image": true, "video": false}'\n`)
  const c = await gen.probe()
  expect(c).toEqual({ image: true, video: false })
  const argv = await Bun.file(fx.argv).text()
  expect(argv).toContain("check_image_generation_requirements")
  expect(argv).toContain("check_video_generation_requirements")
})

test("dotenv keys reach the child process so providers see API keys", async () => {
  // The fake rejects unless the child receives the exact dotenv value.
  fx.script(
    `#!/usr/bin/env bash\n` +
    `if [[ "$FAKE_GEN_KEY" != "reached-the-child" ]]; then exit 42; fi\n` +
    `echo '{"success": true, "image": "${fx.asset}"}'\n`)
  writeFileSync(join(fx.home, ".env"), 'FAKE_GEN_KEY="reached-the-child"\n')
  const out = await gen.generate("image", "x", {})
  expect("path" in out).toBe(true)
})

test("missing fallback python degrades instead of rejecting", async () => {
  rmSync(fx.root, { recursive: true, force: true })
  mkdirSync(fx.root, { recursive: true })
  const old = process.env.PATH
  process.env.PATH = join(fx.home, "empty-path")
  mkdirSync(process.env.PATH, { recursive: true })
  try {
    expect(await gen.probe()).toEqual({ image: false, video: false })
    const out = await gen.generate("image", "x", {})
    expect("err" in out).toBe(true)
  } finally {
    if (old === undefined) delete process.env.PATH
    else process.env.PATH = old
  }
})

test("probe() returns false/false when hermes-agent install absent", async () => {
  rmSync(fx.root, { recursive: true, force: true })
  const c = await gen.probe()
  expect(c).toEqual({ image: false, video: false })
})
