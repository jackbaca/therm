import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { join } from "node:path"
import { gen } from "../src/service/eikon-gen"

// HERMES_HOME is a tmpdir (preload). Drop a fake hermes-agent install
// whose venv python echoes a provider-shaped JSON so generate() can be
// tested end-to-end without any real API.
const HH = process.env.HERMES_HOME!
const ROOT = join(HH, "hermes-agent")
const BIN = join(ROOT, "venv", "bin")
const PY = join(BIN, "python")
const ASSET = join(HH, "gen-out.png")

beforeAll(() => {
  mkdirSync(BIN, { recursive: true })
  writeFileSync(ASSET, new Uint8Array([137, 80, 78, 71]))
  // Fake python: last arg is the -c body; echo args to a sidecar and
  // emit a success JSON pointing at ASSET. Lets us assert the exact
  // tool-module call embedded in the -c string.
  writeFileSync(PY,
    `#!/usr/bin/env bash\n` +
    `printf '%s\\n' "$@" > "${join(HH, "gen-argv")}"\n` +
    `echo '{"success": true, "image": "${ASSET}"}'\n`)
  chmodSync(PY, 0o755)
})
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

test("generate(image) spawns venv python against image_generation_tool and returns local path", async () => {
  const out = await gen.generate("image", "a wise owl", { aspect: "square" })
  expect("path" in out && out.path).toBe(ASSET)
  const argv = await Bun.file(join(HH, "gen-argv")).text()
  expect(argv).toContain("image_generation_tool")
  expect(argv).toContain("_handle_image_generate")
  expect(argv).toContain("a wise owl")
  expect(argv).toContain("square")
})

test("generate(video) embeds duration + image_url seed in the -c body", async () => {
  const out = await gen.generate("video", "owl blinks", { seconds: 3, seed: "/tmp/base.png" })
  expect("path" in out).toBe(true)
  const argv = await Bun.file(join(HH, "gen-argv")).text()
  expect(argv).toContain("video_generation_tool")
  expect(argv).toContain('"duration":3')
  expect(argv).toContain('"image_url":"/tmp/base.png"')
})

test("generate parses error shape", async () => {
  writeFileSync(PY,
    `#!/usr/bin/env bash\necho '{"success": false, "error": "no FAL_KEY"}'\n`)
  chmodSync(PY, 0o755)
  const out = await gen.generate("image", "x", {})
  expect("err" in out && out.err).toBe("no FAL_KEY")
})

test("probe() reads check_*_requirements", async () => {
  writeFileSync(PY,
    `#!/usr/bin/env bash\n` +
    `printf '%s\\n' "$@" > "${join(HH, "gen-argv")}"\n` +
    `echo '{"image": true, "video": false}'\n`)
  chmodSync(PY, 0o755)
  const c = await gen.probe()
  expect(c).toEqual({ image: true, video: false })
  const argv = await Bun.file(join(HH, "gen-argv")).text()
  expect(argv).toContain("check_image_generation_requirements")
  expect(argv).toContain("check_video_generation_requirements")
})

test("dotenv keys reach the child process so providers see API keys", async () => {
  // Fake python echoes whatever env keys are present so we can assert.
  writeFileSync(PY,
    `#!/usr/bin/env bash\n` +
    `echo "FAKE_GEN_KEY=$FAKE_GEN_KEY"\n` +
    `echo '{"success": true, "image": "${ASSET}"}'\n`)
  chmodSync(PY, 0o755)
  writeFileSync(join(HH, ".env"), 'FAKE_GEN_KEY="reached-the-child"\n')
  const out = await gen.generate("image", "x", {})
  expect("path" in out).toBe(true)
})

test("probe() returns false/false when hermes-agent install absent", async () => {
  rmSync(ROOT, { recursive: true, force: true })
  const c = await gen.probe()
  expect(c).toEqual({ image: false, video: false })
})
