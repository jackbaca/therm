import { describe, it, expect } from "bun:test"
import { supportsOsc52Clipboard, shouldUseNativeClipboard } from "./clipboard"

describe("supportsOsc52Clipboard", () => {
  it("accepts the upstream allowlist", () => {
    for (const t of ["ghostty", "kitty", "WezTerm", "windows-terminal", "vscode"]) {
      expect(supportsOsc52Clipboard(t)).toBe(true)
    }
  })

  it("rejects terminals outside the allowlist", () => {
    for (const t of ["xterm", "iTerm.app", "Apple_Terminal", "alacritty", "tmux", "screen", "cursor"]) {
      expect(supportsOsc52Clipboard(t)).toBe(false)
    }
  })

  it("rejects null (unknown terminal)", () => {
    expect(supportsOsc52Clipboard(null)).toBe(false)
  })
})

// shouldUseNativeClipboard() must be tested with process.stdout.isTTY=true so
// the "OSC52 suppressed" branch (!isTTY → native fires) doesn't dominate.
// bun test runs with a pipe'd stdout, so force it on for the duration.
const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })

describe("shouldUseNativeClipboard", () => {
  it("returns false over SSH (native would hit the wrong machine's clipboard)", () => {
    expect(shouldUseNativeClipboard({ SSH_CONNECTION: "1" } as NodeJS.ProcessEnv, "xterm")).toBe(false)
    expect(shouldUseNativeClipboard({ SSH_CONNECTION: "1" } as NodeJS.ProcessEnv, "ghostty")).toBe(false)
    expect(shouldUseNativeClipboard({ SSH_CONNECTION: "1" } as NodeJS.ProcessEnv, null)).toBe(false)
  })

  it("returns true for non-allowlisted terminals (historical safety net)", () => {
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "xterm")).toBe(true)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "iTerm.app")).toBe(true)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "Apple_Terminal")).toBe(true)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "alacritty")).toBe(true)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, null)).toBe(true)
  })

  it("returns false for allowlisted terminals (OSC52 alone is reliable; avoid wl-copy race)", () => {
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "ghostty")).toBe(false)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "kitty")).toBe(false)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "WezTerm")).toBe(false)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "windows-terminal")).toBe(false)
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "vscode")).toBe(false)
  })

  it("keeps native on inside tmux even for allowlisted terminals (passthrough depends on user config)", () => {
    expect(shouldUseNativeClipboard({ TMUX: "/tmp/t,1,0" } as NodeJS.ProcessEnv, "ghostty")).toBe(true)
    expect(shouldUseNativeClipboard({ TMUX: "/tmp/t,1,0" } as NodeJS.ProcessEnv, "kitty")).toBe(true)
    expect(shouldUseNativeClipboard({ TMUX: "/tmp/t,1,0" } as NodeJS.ProcessEnv, "WezTerm")).toBe(true)
    expect(shouldUseNativeClipboard({ TMUX: "/tmp/t,1,0" } as NodeJS.ProcessEnv, "vscode")).toBe(true)
  })

  it("keeps native on inside GNU screen", () => {
    expect(shouldUseNativeClipboard({ STY: "1234.pts-0.host" } as NodeJS.ProcessEnv, "ghostty")).toBe(true)
    expect(shouldUseNativeClipboard({ STY: "1234.pts-0.host" } as NodeJS.ProcessEnv, "kitty")).toBe(true)
  })

  it("SSH beats TMUX (remote-clipboard concern wins)", () => {
    expect(shouldUseNativeClipboard({ SSH_CONNECTION: "1", TMUX: "/tmp/t,1,0" } as NodeJS.ProcessEnv, "xterm")).toBe(false)
  })

  it("falls back to native when OSC52 is suppressed (non-TTY stdout)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    expect(shouldUseNativeClipboard({} as NodeJS.ProcessEnv, "ghostty")).toBe(true)
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
  })
})

// Restore the original descriptor so other test files see the real value.
if (tty) Object.defineProperty(process.stdout, "isTTY", tty)
