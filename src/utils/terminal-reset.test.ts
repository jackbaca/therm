import { describe, it, expect } from "bun:test"

// The SIGINT handler calls process.exit, so it's tested via subprocess
// rather than by firing the signal in-band.

describe("terminal-reset", () => {
  it("SIGINT handler exits the process (130) after emitting reset", async () => {
    // Child installs hooks on a fake TTY, then SIGINTs itself. If the
    // handler doesn't exit, the open stdin keeps the loop alive and the
    // test times out.
    const child = Bun.spawn(["bun", "-e", `
      const { installExitResetHooks, resetTerminalModes } = await import(${JSON.stringify(import.meta.resolve("./terminal-reset"))})
      Object.defineProperty(process.stdout, "isTTY", { value: true })
      installExitResetHooks()
      process.stdin.resume() // hold the loop so only the handler can end us
      process.kill(process.pid, "SIGINT")
    `], { stdout: "pipe", stderr: "pipe" })
    const code = await child.exited
    const out = await new Response(child.stdout).text()
    expect(code).toBe(130)
    // reset blob fires at least once (signal handler) — the `exit`
    // hook may fire a second copy; both land before the fd closes.
    expect(out.split("\x1b[?2029l").length - 1).toBeGreaterThanOrEqual(1)
  })
})
