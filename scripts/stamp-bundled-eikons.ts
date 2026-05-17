#!/usr/bin/env bun
// Rewrite line 1 of bundled .eikon files to carry source_url. The
// rest of the NDJSON body is left byte-identical. Run from repo root.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = "https://raw.githubusercontent.com/liftaris/eikon/main/eikons"
const map: Record<string, string> = {
  "ares.eikon":    `${BASE}/ares/`,
  "mono.eikon":    `${BASE}/mono/`,
  "default.eikon": `${BASE}/nous/`,
}

for (const [f, url] of Object.entries(map)) {
  const p = join(import.meta.dir, "../assets/eikons", f)
  const raw = readFileSync(p, "utf8")
  const nl = raw.indexOf("\n")
  const head = { ...JSON.parse(raw.slice(0, nl)), source_url: url }
  writeFileSync(p, JSON.stringify(head) + raw.slice(nl))
  console.log(`${f}: source_url → ${url}`)
}
