// Suspend the renderer and spawn the eikon.sh browser on the tty.
// Picks arrive RS-framed on the child's stderr (same protocol as sshd);
// each one is written to $HERMES_HOME/eikons/ and yielded to the caller.
//
// Source resolution (first hit):
//   $EIKON_SSH  → ["ssh", "-p", <port>, <host>]   (exercises remote path)
//   $EIKON_DIR  → ["bun", "$EIKON_DIR/src/browse/main.tsx"]  (dev checkout)
//   else        → undefined (caller shows a notice)

import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import type { CliRenderer } from "@opentui/core"

const MARK = 0x1e

export type Pick = { name: string; path: string }

function argv(): string[] | undefined {
  const fixed = process.env.EIKON_CMD
  if (fixed) return fixed.split(" ")
  const ssh = process.env.EIKON_SSH
  if (ssh) {
    const [host, port] = ssh.split(":")
    return ["ssh", ...(port ? ["-p", port] : []), host ?? "localhost"]
  }
  const dir = process.env.EIKON_DIR
  if (dir && existsSync(join(dir, "src/browse/main.tsx")))
    return ["bun", join(dir, "src/browse/main.tsx")]
  return undefined
}

async function* picks(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ name: string; raw: string }> {
  let buf = Buffer.alloc(0)
  let want: { name: string; size: number } | null = null
  for await (const chunk of stream) {
    buf = Buffer.concat([buf, Buffer.from(chunk)])
    for (;;) {
      if (want) {
        if (buf.length < want.size) break
        yield { name: want.name, raw: buf.subarray(0, want.size).toString("utf8") }
        buf = buf.subarray(want.size)
        want = null
        continue
      }
      const at = buf.indexOf(MARK)
      if (at < 0) { buf = Buffer.alloc(0); break }
      const nl = buf.indexOf(0x0a, at + 1)
      if (nl < 0) { buf = buf.subarray(at); break }
      const head = JSON.parse(buf.subarray(at + 1, nl).toString("utf8")) as { pick: string; size: number }
      want = { name: head.pick, size: head.size }
      buf = buf.subarray(nl + 1)
    }
  }
}

/**
 * Open the eikon.sh browser fullscreen. Resolves with the last installed
 * pick (or undefined if the user quit without picking). Returns undefined
 * immediately if no eikon source is configured.
 */
export async function browse(renderer: CliRenderer): Promise<Pick | undefined> {
  const cmd = argv()
  if (!cmd) return undefined

  const dir = join(process.env.HERMES_HOME ?? join(homedir(), ".hermes"), "eikons")
  mkdirSync(dir, { recursive: true })

  renderer.suspend()
  renderer.currentRenderBuffer.clear()

  const child = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "pipe" })

  let last: Pick | undefined
  const drain = (async () => {
    for await (const p of picks(child.stderr)) {
      const at = join(dir, p.name)
      mkdirSync(join(at, "source"), { recursive: true })
      const path = join(at, `${p.name}.eikon`)
      await Bun.write(path, p.raw)
      last = { name: p.name, path }
    }
  })()

  await child.exited
  await drain

  if (renderer.isDestroyed) return last
  renderer.currentRenderBuffer.clear()
  renderer.resume()
  renderer.requestRender()
  return last
}

export const configured = () => argv() !== undefined
