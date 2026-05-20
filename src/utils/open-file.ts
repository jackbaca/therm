/**
 * open-file.ts — Open files and URLs using the OS default handler.
 *
 * Two entry points:
 * - openFile(path): local file paths, via the `open` npm package.
 * - openUrl(raw):   external URLs, http(s)-only, spawned with no shell.
 *
 * Fire-and-forget; neither blocks the TUI.
 *
 * URL safety: a hostile model can emit `<Link url="file:///etc/passwd">` or
 * `javascript:…` and trick a click into running a local handler with
 * attacker-controlled input. openUrl parses via `new URL()` and rejects
 * anything whose protocol is not http(s), then spawns the platform opener
 * with an argv array so shell metacharacters in the URL cannot be
 * interpreted as commands.
 */

import { spawn, type SpawnOptions } from "node:child_process"
import { platform } from "node:os"
import open from "open"

export function openFile(path: string): void {
  open(path).catch(() => {})
}

export type Deps = {
  spawn?: typeof spawn
  platform?: () => string
}

/**
 * Open an external URL in the OS default browser. Returns true if a spawn
 * was attempted, false if the URL was rejected, no opener is known for the
 * platform, or spawn threw synchronously. Async failures after spawn (the
 * binary couldn't exec) still return true — the no-op `'error'` listener
 * absorbs the event so the TUI doesn't crash; user just doesn't see the
 * browser pop.
 */
export function openUrl(raw: string, deps: Deps = {}): boolean {
  const url = parseSafeUrl(raw)
  if (!url) return false

  const spawnFn = deps.spawn ?? spawn
  const id = deps.platform?.() ?? platform()
  const cmd = openCommand(id)
  if (!cmd) return false

  // spawn can throw synchronously on argv-validation failures (e.g. NUL
  // in the path). Treat it as a no-op rather than crashing the TUI.
  let child
  try {
    child = spawnFn(cmd.command, [...cmd.args, url.toString()], {
      // Detach so closing the TUI later doesn't kill the browser, and
      // ignore stdio so we don't leak FDs into the raw-mode terminal
      // (Chrome's stderr otherwise lands in the alt screen).
      detached: true,
      stdio: "ignore",
    } satisfies SpawnOptions)
  } catch {
    return false
  }

  // spawn returns a ChildProcess synchronously even when the binary is
  // missing (ENOENT on xdg-open / explorer.exe) — the failure surfaces
  // later as an 'error' event. Without a handler, an unhandled 'error'
  // on an EventEmitter crashes Node and tears down the TUI. Attach the
  // no-op listener BEFORE unref() so the event has a consumer.
  child.once("error", () => {})
  child.unref()

  return true
}

export function parseSafeUrl(value: string): null | URL {
  if (!value || typeof value !== "string") return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  // http(s) only. file:, data:, javascript:, vbscript:, etc. would let
  // a malicious model invoke a local handler on a single click.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null

  // Some Node versions accept URLs like 'http:///foo'. Defensively
  // reject empty or all-whitespace hostnames.
  if (!url.hostname.trim()) return null

  return url
}

type OpenCommand = { command: string; args: readonly string[] }

/**
 * Per-platform opener. We deliberately avoid `cmd.exe /c start` on
 * win32 — `start` is a cmd builtin, the URL is reparsed by cmd's
 * tokenizer, and `&`, `|`, `^`, `<`, `>` either break the command or
 * get interpreted as more commands. `explorer.exe <url>` invokes the
 * registered http(s) handler without going through cmd.
 *
 * Returns null for platforms where we don't know a safe opener
 * (aix, sunos, cygwin, haiku, …). The caller then honestly surfaces
 * "no opener" instead of optimistically trying xdg-open.
 */
export function openCommand(id: string): OpenCommand | null {
  if (id === "darwin") return { command: "open", args: [] }
  if (id === "win32") return { command: "explorer.exe", args: [] }

  const xdg = new Set(["linux", "freebsd", "openbsd", "netbsd", "dragonfly"])
  if (xdg.has(id)) return { command: "xdg-open", args: [] }

  return null
}
