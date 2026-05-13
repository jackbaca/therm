// Subagent tree aggregation for the Agents tab header + detail rollups.
// Ink reference: ui-tui/src/lib/subagentTree.ts. Herm's wire data is
// thinner (DelegationRecord has no tokens/cost; those arrive via
// subagent.complete into `live`), so aggregate() takes both.

import type { DelegationRecord } from "../context/wire"

// Per-node enrichment accumulated from subagent.* push events between
// registry polls. Mirrors the `Live` shape in Agents.tsx.
export type Live = {
  tool_count?: number
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  status?: string
}

export type Agg = {
  agents: number
  tools: number
  dur: number
  tok: number
  cost: number
  active: number
  depth: number
  hot: number
}

type Node = { rec: DelegationRecord; agg: Agg; kids: Node[] }

const running = (s: string | undefined) => !s || s === "running" || s === "queued"

export function tree(
  recs: readonly DelegationRecord[],
  live: ReadonlyMap<string, Live>,
  now: number,
): Node[] {
  const ids = new Set(recs.map(r => r.subagent_id))
  const by = new Map<string, DelegationRecord[]>()
  for (const r of recs) {
    const k = r.parent_id && ids.has(r.parent_id) ? r.parent_id : ""
    ;(by.get(k) ?? by.set(k, []).get(k)!).push(r)
  }
  const build = (r: DelegationRecord): Node => {
    const kids = (by.get(r.subagent_id) ?? []).map(build)
    const lv = live.get(r.subagent_id) ?? {}
    const dur = r.started_at != null ? Math.max(0, now - r.started_at) : 0
    let a: Agg = {
      agents: 1,
      tools: lv.tool_count ?? r.tool_count ?? 0,
      dur,
      tok: (lv.input_tokens ?? 0) + (lv.output_tokens ?? 0),
      cost: lv.cost_usd ?? 0,
      active: running(lv.status ?? r.status) ? 1 : 0,
      depth: 0,
      hot: 0,
    }
    for (const k of kids) {
      a = {
        agents: a.agents + k.agg.agents,
        tools: a.tools + k.agg.tools,
        dur: a.dur + k.agg.dur,
        tok: a.tok + k.agg.tok,
        cost: a.cost + k.agg.cost,
        active: a.active + k.agg.active,
        depth: Math.max(a.depth, k.agg.depth + 1),
        hot: 0,
      }
    }
    a.hot = a.dur > 0 ? a.tools / a.dur : 0
    return { rec: r, agg: a, kids }
  }
  return (by.get("") ?? []).map(build)
}

export function totals(nodes: readonly Node[]): Agg {
  const z: Agg = { agents: 0, tools: 0, dur: 0, tok: 0, cost: 0, active: 0, depth: 0, hot: 0 }
  for (const n of nodes) {
    z.agents += n.agg.agents
    z.tools += n.agg.tools
    z.dur += n.agg.dur
    z.tok += n.agg.tok
    z.cost += n.agg.cost
    z.active += n.agg.active
    z.depth = Math.max(z.depth, n.agg.depth + 1)
  }
  z.hot = z.dur > 0 ? z.tools / z.dur : 0
  return z
}

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const

export function spark(nodes: readonly Node[]): string {
  const w: number[] = []
  const walk = (ns: readonly Node[], d: number) => {
    if (ns.length === 0) return
    w[d] = (w[d] ?? 0) + ns.length
    for (const n of ns) walk(n.kids, d + 1)
  }
  walk(nodes, 0)
  if (w.length === 0) return ""
  const max = Math.max(...w)
  return w.map(v => v <= 0 ? " "
    : SPARK[Math.min(7, Math.ceil((v / max) * 7))]).join("")
}

const tk = (n: number) =>
  n < 1000 ? String(Math.round(n))
  : n < 10_000 ? `${(n / 1000).toFixed(1)}k`
  : `${Math.round(n / 1000)}k`

const $$ = (n: number) =>
  n <= 0 ? "" : n < 0.01 ? "<$0.01" : n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(1)}`

const sec = (s: number) => {
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return r === 0 ? `${m}m` : `${m}m${r}s`
}

/** `d2 · 7 agents · 124 tools · 2m14s · 10k tok · $0.42 · ⚡3` */
export function summary(a: Agg): string {
  const p = [`d${a.depth}`, `${a.agents} agent${a.agents === 1 ? "" : "s"}`]
  if (a.tools > 0) p.push(`${a.tools} tools`)
  if (a.dur > 0) p.push(sec(a.dur))
  if (a.tok > 0) p.push(`${tk(a.tok)} tok`)
  if (a.cost > 0) p.push($$(a.cost))
  if (a.active > 0) p.push(`⚡${a.active}`)
  return p.join(" · ")
}

/** 0..(buckets-1) normalized against peak across all nodes. */
export function heat(hot: number, peak: number, buckets: number): number {
  if (hot <= 0 || peak <= 0 || buckets <= 1) return 0
  return Math.min(buckets - 1, Math.round((Math.min(1, hot / peak)) * (buckets - 1)))
}

export function peak(nodes: readonly Node[]): number {
  let p = 0
  const walk = (ns: readonly Node[]) => {
    for (const n of ns) { p = Math.max(p, n.agg.hot); walk(n.kids) }
  }
  walk(nodes)
  return p
}
