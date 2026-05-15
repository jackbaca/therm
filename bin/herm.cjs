#!/usr/bin/env node
// Launcher shim: locate a bun runtime and exec dist/index.js under it.
// Node shebang so npm's cmd-shim generates a .ps1 that invokes node.exe,
// which is always resolvable (npm itself is running under it). A bun
// shebang produces a .ps1 that looks for a literal bun.exe in PATH and
// fails when bun was installed via `npm i -g bun` (npm/cmd-shim#95).

const cp = require("child_process")
const fs = require("fs")
const path = require("path")

const win = process.platform === "win32"
const exe = win ? "bun.exe" : "bun"
const here = path.dirname(fs.realpathSync(__filename))
const entry = [path.join(here, "..", "index.js"), path.join(here, "..", "dist", "index.js")]
  .find(fs.existsSync) ?? path.join(here, "..", "src", "index.tsx")

function walk(dir, rel) {
  for (;;) {
    const p = path.join(dir, "node_modules", ...rel)
    if (fs.existsSync(p)) return p
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

// BUN_INSTALL (official installer) → node_modules/bun (npm -g bun sibling)
// → node_modules/.bin (pm-local) → PATH.
const bun = (() => {
  if (process.env.HERM_BUN) return process.env.HERM_BUN
  const inst = process.env.BUN_INSTALL
  if (inst) {
    const p = path.join(inst, "bin", exe)
    if (fs.existsSync(p)) return p
  }
  return walk(here, ["bun", "bin", exe])
    ?? walk(here, [".bin", win ? "bun.cmd" : "bun"])
    ?? "bun"
})()

const child = cp.spawn(bun, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: win && bun.endsWith(".cmd"),
})
child.on("error", (e) => {
  if (e.code === "ENOENT") {
    console.error("herm: bun runtime not found.")
    console.error(win
      ? '  install: powershell -c "irm bun.sh/install.ps1 | iex"'
      : "  install: curl -fsSL https://bun.sh/install | bash")
  } else {
    console.error(e.message)
  }
  process.exit(1)
})
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(sig, () => { try { child.kill(sig) } catch {} })
child.on("exit", (code, sig) => {
  if (sig) return process.kill(process.pid, sig)
  process.exit(code ?? 0)
})
