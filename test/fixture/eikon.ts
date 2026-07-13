import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export function generator(init: () => void = () => {}) {
  const home = process.env.HERMES_HOME!
  const root = join(home, "hermes-agent")
  const bin = join(root, "venv", "bin")
  const py = join(bin, "python")
  const asset = join(home, "gen-out.png")
  const argv = join(home, "gen-argv")
  const script = (body: string) => {
    writeFileSync(py, body)
    chmodSync(py, 0o755)
  }
  const dispose = () => {
    rmSync(root, { recursive: true, force: true })
    rmSync(asset, { force: true })
    rmSync(argv, { force: true })
    rmSync(join(home, ".env"), { force: true })
  }

  dispose()
  try {
    mkdirSync(bin, { recursive: true })
    writeFileSync(asset, new Uint8Array([137, 80, 78, 71]))
    init()
    script(
      `#!/usr/bin/env bash\n` +
      `printf '%s\\n' "$@" > "${argv}"\n` +
      `echo '{"success": true, "image": "${asset}"}'\n`,
    )
  } catch (err) {
    dispose()
    throw err
  }

  return {
    home,
    root,
    py,
    asset,
    argv,
    script,
    [Symbol.dispose]: dispose,
  }
}

export function eikons() {
  const dir = join(process.env.HERMES_HOME!, "eikons")
  rmSync(dir, { recursive: true, force: true })
  return {
    [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
  }
}
