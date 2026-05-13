// Hermes CLI ships ~200 one-line tips in hermes_cli/tips.py. There's
// no `tips.list` RPC (see UPSTREAM.md); rather than shell.exec a python
// one-liner on every boot, read the source file once and scrape the
// string literals out of the `TIPS = [ ... ]` block. Brittle-by-design
// but zero-cost; falls back to a small built-in set if the file moved.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { hermesAgentRoot } from "../context/gateway-client"

const FALLBACK = [
  "`@file:path/to/file.py` injects file contents directly into your message.",
  "`/title <name>` names the session — resume it later from the Sessions tab.",
  "Ctrl+G opens $EDITOR seeded with the composer contents.",
  "Ctrl+Z suspends to the shell; `fg` resumes.",
  "Pasting 5+ lines collapses to a `[Pasted #N …]` placeholder.",
  "Click a user message in the transcript to rewind to that point.",
]

// Tokens worth accenting in a tip line: /slash, @refs, keybinds,
// `code`, "quoted".
const HL = /(\/[a-z][\w-]*|@[\w:./-]+|(?:Ctrl|Alt|Shift)\+\S+|`[^`]+`|"[^"]+")/g

type TipPart = { t: string; hl: boolean }

export function splitTip(tip: string): TipPart[] {
  const out: TipPart[] = []
  let i = 0
  for (const m of tip.matchAll(HL)) {
    const j = m.index
    if (j > i) out.push({ t: tip.slice(i, j), hl: false })
    out.push({ t: m[0].replace(/^`|`$/g, ""), hl: true })
    i = j + m[0].length
  }
  if (i < tip.length) out.push({ t: tip.slice(i), hl: false })
  return out
}

let cache: string[] | null = null

export function loadTips(): string[] {
  if (cache) return cache
  try {
    const src = readFileSync(join(hermesAgentRoot(), "hermes_cli", "tips.py"), "utf8")
    const body = src.split(/^TIPS\s*=\s*\[/m)[1]?.split(/^\]/m)[0] ?? ""
    // Each tip is a double-quoted single-line string literal. Pull the
    // inner text, unescape \" and \\, drop comments/blank lines.
    const tips: string[] = []
    for (const line of body.split("\n")) {
      const m = line.match(/^\s+"((?:[^"\\]|\\.)*)",?\s*$/)
      if (m) tips.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"))
    }
    cache = tips.length > 10 ? tips : FALLBACK
  } catch {
    cache = FALLBACK
  }
  return cache
}

/** Random tip; never the same twice in a row. */
export function randomTip(prev?: string): string {
  const t = loadTips()
  if (t.length < 2) return t[0] ?? ""
  let pick = t[Math.floor(Math.random() * t.length)]
  while (pick === prev) pick = t[Math.floor(Math.random() * t.length)]
  return pick
}
