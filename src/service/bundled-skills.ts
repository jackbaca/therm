// Ship-with-herm skills. `assets/skills/<name>/SKILL.md` is copied to
// `~/.hermes/skills/creative/<name>/` on first launch if the user
// doesn't already have a skill of that name anywhere under
// `~/.hermes/skills/`. We only check existence — if the user has
// edited or moved their copy, we leave it alone; there is no version
// stamp and no overwrite. The copy is best-effort: a missing assets
// dir (broken install) or a write failure is swallowed so launch
// never blocks on it.
//
// Skills land under `creative/` because hermes-agent's slash scanner
// walks category subdirectories and these register as `/eikon` +
// `/eikon-create` regardless of category — the path only affects how
// they sort in the Skills tab.

import { existsSync, mkdirSync, readdirSync, cpSync } from "node:fs"
import { dirname, join } from "node:path"
import { hermesPath } from "./hermes-home"

const locate = () => {
  // Same walk as components/avatar/bundled.ts: dev resolves to the
  // repo root, published bundle resolves to dist/ where build.ts
  // `cp -r assets dist/` dropped it.
  let d = import.meta.dir
  for (let i = 0; i < 5; i++) {
    const p = join(d, "assets/skills")
    if (existsSync(p)) return p
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  return undefined
}

/** A skill named `n` is "present" if `skills/<n>/SKILL.md` or
 *  `skills/<cat>/<n>/SKILL.md` exists — hermes-agent's scanner keys
 *  on frontmatter name (which equals the dir name for our bundled
 *  set), and a user may have recategorized theirs. */
function has(root: string, n: string): boolean {
  if (existsSync(join(root, n, "SKILL.md"))) return true
  if (!existsSync(root)) return false
  return readdirSync(root, { withFileTypes: true })
    .some(e => e.isDirectory() && existsSync(join(root, e.name, n, "SKILL.md")))
}

/** Copy each bundled skill into the user's ~/.hermes/skills/creative/
 *  if they don't already have one by that name. Returns the names
 *  that were installed (for a one-time toast/log if the caller wants
 *  it). Synchronous and cheap — two `existsSync` per skill on the
 *  steady-state path. */
export function sync(): string[] {
  const src = locate()
  if (!src) return []
  const root = hermesPath("skills")
  const dst = join(root, "creative")
  const out: string[] = []
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (has(root, e.name)) continue
    mkdirSync(dst, { recursive: true })
    cpSync(join(src, e.name), join(dst, e.name), { recursive: true })
    out.push(e.name)
  }
  return out
}

export * as skills from "./bundled-skills"
