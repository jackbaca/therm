/**
 * perf.ts — Zero-cost profiling for herm.
 *
 * Gate: set PERF=1 to activate. When disabled, every export
 * is a no-op or passthrough — no allocations, no timers, no overhead.
 *
 * Usage:
 *   PERF=1 bun run dev          # periodic memory + event stats
 *   PERF=verbose bun run dev    # ^ plus per-event timing logs
 *
 * API:
 *   mark(label)      — start timing, returns end() → ms
 *   count(label)     — increment a named counter
 *   mem(label)       — snapshot RSS/heap at a labeled point
 *   monitor(ms)      — start periodic memory reporter, returns cleanup
 *   report()         — dump all collected stats to stderr
 *   onRender(...)    — React <Profiler> onRender callback
 */

const level = process.env.PERF ?? ""
const enabled = level === "1" || level === "verbose"
const verbose = level === "verbose"

type Timing = { count: number; total: number; min: number; max: number; last: number }

const timings = new Map<string, Timing>()

const noop = () => 0

/** Start a timing mark. Returns end() which returns elapsed ms. */
export const mark = enabled
  ? (label: string): (() => number) => {
    const start = Bun.nanoseconds()
    return () => {
      const ms = (Bun.nanoseconds() - start) / 1e6
      const t = timings.get(label)
      if (t) {
        t.count++
        t.total += ms
        if (ms < t.min) t.min = ms
        if (ms > t.max) t.max = ms
        t.last = ms
      } else {
        timings.set(label, { count: 1, total: ms, min: ms, max: ms, last: ms })
      }
      if (verbose) log(`⏱ ${label}: ${ms.toFixed(2)}ms`)
      return ms
    }
  }
  : (_: string) => noop
// One-shot milestones measured from process start (Bun.nanoseconds()
// origin). ESM imports hoist, so mark() can't bracket the import graph;
// callers pass the absolute ms-since-spawn instead.
const stages: Array<[string, number]> = []
export const boot = (label: string, ms: number) => {
  stages.push([label, ms])
  if (enabled) log(`🚀 boot:${label} ${ms.toFixed(1)}ms`)
}

const counters = new Map<string, number>()

/** Increment a named counter. */
export const count = enabled
  ? (label: string, n = 1) => {
    counters.set(label, (counters.get(label) ?? 0) + n)
  }
  : (_label: string, _n?: number) => {}

type Snapshot = { label: string; rss: number; heap: number; external: number; ts: number }

const snapshots: Snapshot[] = []

const mb = (n: number) => (n / 1024 / 1024).toFixed(1)

/** Snapshot memory at a labeled point. */
export const mem = enabled
  ? (label: string) => {
    const m = process.memoryUsage()
    snapshots.push({ label, rss: m.rss, heap: m.heapUsed, external: m.external, ts: Date.now() })
    log(`📊 [${label}] RSS=${mb(m.rss)}MB heap=${mb(m.heapUsed)}MB ext=${mb(m.external)}MB`)
  }
  : (_: string) => {}

/** Start periodic memory reporter. Returns cleanup function. */
export const monitor = enabled
  ? (ms = 10_000): (() => void) => {
    const id = setInterval(() => {
      const m = process.memoryUsage()
      const gc = Bun.gc(false)
      log(
        `\x1b[90m[mem] RSS=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB`
        + ` ext=${mb(m.external)}MB gcRuns=${(gc as unknown as Record<string, unknown>)?.eden_collections ?? "?"}/${(gc as unknown as Record<string, unknown>)?.full_collections ?? "?"}\x1b[0m`
      )
    }, ms)
    return () => clearInterval(id)
  }
  : (_ms?: number) => noop

type RenderEntry = { count: number; total: number; max: number; last: number }

const renders = new Map<string, RenderEntry>()

/**
 * Drop-in for React <Profiler onRender={perf.onRender}>.
 * Tracks render count, total time, and max render time per id.
 */
export const onRender = enabled
  ? (id: string, phase: "mount" | "update" | "nested-update", actual: number) => {
    const r = renders.get(id)
    if (r) {
      r.count++
      r.total += actual
      if (actual > r.max) r.max = actual
      r.last = actual
    } else {
      renders.set(id, { count: 1, total: actual, max: actual, last: actual })
    }
    if (verbose && actual > 1) {
      log(`🔄 [${id}] ${phase}: ${actual.toFixed(2)}ms`)
    }
  }
  : (_id: string, _phase: string, _actual: number) => {}

/** Dump all collected profiling data to stderr. */
const report = () => {
  if (!enabled) return

  const lines: string[] = ["\n\x1b[1m═══ PERF REPORT ═══\x1b[0m\n"]

  // Memory snapshots
  if (snapshots.length > 0) {
    lines.push("\x1b[1mMemory Snapshots:\x1b[0m")
    for (const s of snapshots) {
      lines.push(`  ${s.label}: RSS=${mb(s.rss)}MB heap=${mb(s.heap)}MB ext=${mb(s.external)}MB`)
    }
    const first = snapshots[0]
    const last = snapshots[snapshots.length - 1]
    const drift = last.rss - first.rss
    lines.push(`  Δ RSS: ${drift > 0 ? "+" : ""}${mb(drift)}MB (${first.label} → ${last.label})`)
    lines.push("")
  }

  // Timings
  if (timings.size > 0) {
    lines.push("\x1b[1mTimings:\x1b[0m")
    const sorted = [...timings.entries()].sort((a, b) => b[1].total - a[1].total)
    for (const [label, t] of sorted) {
      const avg = t.total / t.count
      lines.push(
        `  ${label}: ${t.count}× avg=${avg.toFixed(2)}ms`
        + ` min=${t.min.toFixed(2)}ms max=${t.max.toFixed(2)}ms total=${t.total.toFixed(0)}ms`
      )
    }
    lines.push("")
  }

  // Render profiler
  if (renders.size > 0) {
    lines.push("\x1b[1mReact Renders:\x1b[0m")
    const sorted = [...renders.entries()].sort((a, b) => b[1].count - a[1].count)
    for (const [id, r] of sorted) {
      const avg = r.total / r.count
      lines.push(
        `  <${id}>: ${r.count}× avg=${avg.toFixed(2)}ms max=${r.max.toFixed(2)}ms total=${r.total.toFixed(0)}ms`
      )
    }
    lines.push("")
  }

  // Counters
  if (counters.size > 0) {
    lines.push("\x1b[1mCounters:\x1b[0m")
    const sorted = [...counters.entries()].sort((a, b) => b[1] - a[1])
    for (const [label, n] of sorted) {
      lines.push(`  ${label}: ${n}`)
    }
    lines.push("")
  }

  log(lines.join("\n"))
}

/** Return all profiling data as a plain object (for JSON API). */
export const data = () => {
  if (!enabled) return null
  const m = process.memoryUsage()
  return {
    boot: Object.fromEntries(stages.map(([l, ms]) => [l, +ms.toFixed(1)])),
    memory: {
      rss: Math.round(m.rss / 1024 / 1024),
      heap: Math.round(m.heapUsed / 1024 / 1024),
      heapTotal: Math.round(m.heapTotal / 1024 / 1024),
      external: Math.round(m.external / 1024 / 1024),
    },
    snapshots: snapshots.map(s => ({
      label: s.label,
      rss: Math.round(s.rss / 1024 / 1024),
      heap: Math.round(s.heap / 1024 / 1024),
      external: Math.round(s.external / 1024 / 1024),
    })),
    timings: Object.fromEntries(
      [...timings.entries()].sort((a, b) => b[1].total - a[1].total)
        .map(([k, v]) => [k, { count: v.count, avg: +(v.total / v.count).toFixed(2), min: +v.min.toFixed(2), max: +v.max.toFixed(2), total: Math.round(v.total) }])
    ),
    renders: Object.fromEntries(
      [...renders.entries()].sort((a, b) => b[1].count - a[1].count)
        .map(([k, v]) => [k, { count: v.count, avg: +(v.total / v.count).toFixed(2), max: +v.max.toFixed(2), total: Math.round(v.total) }])
    ),
    counters: Object.fromEntries(
      [...counters.entries()].sort((a, b) => b[1] - a[1])
    ),
  }
}

const log = (msg: string) => process.stderr.write(msg + "\n")

// Dump report on exit
if (enabled) {
  process.on("exit", report)
  process.on("SIGINT", () => { report(); process.exit(0) })
}
