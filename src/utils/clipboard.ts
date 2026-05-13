import { platform } from "os"

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * Works over SSH by having the terminal emulator handle it locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return
  const base64 = Buffer.from(text).toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  const pass = process.env["TMUX"] || process.env["STY"]
  const seq = pass ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  process.stdout.write(seq)
}

async function nativeCopy(text: string): Promise<void> {
  const os = platform()

  if (os === "darwin") {
    const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
    proc.stdin.write(text)
    proc.stdin.end()
    await proc.exited
    return
  }

  if (os === "linux") {
    if (process.env["WAYLAND_DISPLAY"]) {
      try {
        const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
        proc.stdin.write(text)
        proc.stdin.end()
        await proc.exited
        return
      } catch {}
    }
    try {
      const proc = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
      proc.stdin.write(text)
      proc.stdin.end()
      await proc.exited
      return
    } catch {}
    try {
      const proc = Bun.spawn(["xsel", "--clipboard", "--input"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
      proc.stdin.write(text)
      proc.stdin.end()
      await proc.exited
      return
    } catch {}
  }
}

export async function copy(text: string): Promise<void> {
  writeOsc52(text)
  await nativeCopy(text).catch(() => {})
}

export function copySelection(renderer: { getSelection: () => { getSelectedText: () => string } | null; clearSelection: () => void }): boolean {
  const sel = renderer.getSelection()
  const text = sel?.getSelectedText()
  if (!text) return false

  copy(text).catch(() => {})
  renderer.clearSelection()
  return true
}

export * as Clipboard from "./clipboard"
