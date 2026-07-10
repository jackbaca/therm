import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editInEditor } from "../src/utils/editor"

// A real CliRenderer isn't needed — editInEditor only calls suspend/
// currentRenderBuffer.clear/resume/requestRender on it.
const fake = () => {
  const calls: string[] = []
  return {
    calls,
    renderer: {
      suspend: () => calls.push("suspend"),
      resume: () => calls.push("resume"),
      requestRender: () => calls.push("request"),
      currentRenderBuffer: { clear: () => calls.push("clear") },
    },
  }
}

describe("editInEditor", () => {
  let prev: { V?: string; E?: string }
  beforeEach(() => { prev = { V: process.env.VISUAL, E: process.env.EDITOR } })
  afterEach(() => {
    if (prev.V === undefined) delete process.env.VISUAL; else process.env.VISUAL = prev.V
    if (prev.E === undefined) delete process.env.EDITOR; else process.env.EDITOR = prev.E
  })

  test("returns undefined when no $VISUAL/$EDITOR; renderer untouched", async () => {
    delete process.env.VISUAL
    delete process.env.EDITOR
    const f = fake()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await editInEditor(f.renderer as any, "seed")
    expect(out).toBeUndefined()
    expect(f.calls).toEqual([])
  })

  test("spawns editor, reads back trimmed output, cleans tmpfile", async () => {
    // Fake editor: a shell script that overwrites the file it's given.
    const script = join(tmpdir(), `herm-fake-editor-${Date.now()}.sh`)
    await Bun.write(script, `#!/bin/sh\nprintf 'line1\\nline2\\n' > "$1"\n`)
    await Bun.$`chmod +x ${script}`.quiet()
    process.env.VISUAL = script
    delete process.env.EDITOR

    const f = fake()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await editInEditor(f.renderer as any, "initial seed")

    expect(out).toBe("line1\nline2")
    // Lifecycle: suspend → clear → (spawn) → clear → resume → request
    expect(f.calls).toEqual(["suspend", "clear", "clear", "resume", "request"])

    rmSync(script, { force: true })
  })

  test("uses requested temp suffix", async () => {
    const script = join(tmpdir(), `herm-fake-editor-suffix-${Date.now()}.sh`)
    await Bun.write(script, `#!/bin/sh\ncase "$1" in *.txt) printf 'txt file' > "$1" ;; *) printf 'wrong' > "$1" ;; esac\n`)
    await Bun.$`chmod +x ${script}`.quiet()
    process.env.VISUAL = script

    const f = fake()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await editInEditor(f.renderer as any, "seed", ".txt")
    expect(out).toBe("txt file")

    rmSync(script, { force: true })
  })

  test("handles $EDITOR with args (split on space)", async () => {
    // `sh -c 'printf hello > "$0"'` — $0 is the appended path arg.
    process.env.VISUAL = ""
    process.env.EDITOR = `sh -c printf\\ hello\\ >\\ "$0"`
    // The split-on-space parsing won't survive escaped spaces; instead
    // use a simple two-word form: `true foo` (editor that does nothing).
    process.env.EDITOR = "true ignored-arg"
    const f = fake()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await editInEditor(f.renderer as any, "kept")
    expect(out).toBe("kept") // editor was a no-op; seed survives round-trip
  })

  test("empty result returns undefined", async () => {
    const script = join(tmpdir(), `herm-fake-editor-empty-${Date.now()}.sh`)
    await Bun.write(script, "#!/bin/sh\n: > \"$1\"\n") // truncate
    await Bun.$`chmod +x ${script}`.quiet()
    process.env.VISUAL = script

    const f = fake()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await editInEditor(f.renderer as any, "seed")
    expect(out).toBeUndefined()
    expect(f.calls[0]).toBe("suspend")
    expect(f.calls[f.calls.length - 1]).toBe("request")

    rmSync(script, { force: true })
  })
})
