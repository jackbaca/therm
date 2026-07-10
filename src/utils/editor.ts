// Suspend the renderer, open $VISUAL/$EDITOR on a tmpfile seeded with the
// current input, read it back. Returns undefined if no editor configured
// or the user emptied the file. `suffix` hints syntax mode to editors.

import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import type { CliRenderer } from "@opentui/core"

export async function editInEditor(renderer: CliRenderer, seed: string, suffix = ".md"): Promise<string | undefined> {
  const cmd = process.env.VISUAL || process.env.EDITOR
  if (!cmd) return undefined

  const path = join(tmpdir(), `herm-${Date.now()}${suffix}`)
  await Bun.write(path, seed)

  renderer.suspend()
  renderer.currentRenderBuffer.clear()
  const parts = cmd.split(" ")
  const proc = Bun.spawn([...parts, path], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  })
  await proc.exited
  const text = await Bun.file(path).text().catch(() => "")
  rm(path, { force: true }).catch(() => {})
  // Across the await the renderer may have been torn down (headless
  // tests destroy it while the spawned editor is still running).
  // resume()/currentRenderBuffer.clear() are raw FFI calls against a
  // pointer that destroy() already freed — use-after-free → SIGSEGV.
  if (renderer.isDestroyed) return text.trim() || undefined
  renderer.currentRenderBuffer.clear()
  renderer.resume()
  renderer.requestRender()
  return text.trim() || undefined
}
