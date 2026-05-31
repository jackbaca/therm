# Eikon Marketplace performance

Marketplace preview policy is poster-first. Grid rows render catalog poster text only; they do not fetch `.eikon` previews and do not mount `AnimatedAvatar` per row. A selected preview may animate in exactly one surface:

- wide layouts: the app sidebar override
- hidden/narrow-sidebar layouts: the Marketplace detail pane

Grid idle animation stays disabled until a future PERF run proves it does not add avoidable timer or render churn.

## PERF collection

Use the task worktree with Bun on PATH:

```sh
export PATH="/home/kaio/.bun/bin:$PATH"
PERF=1 bun run src/index.tsx
```

Scenarios to collect:

1. Normal Herm sidebar on Chat.
2. Gallery → Marketplace poster-only grid.
3. Marketplace selected preview in the sidebar.
4. Narrow or sidebar-hidden Marketplace selected preview in the detail pane.
5. Experimental grid idle animation, if one is proposed later.

Useful counters/timings:

- `market:list:load`: catalog fetch/cache/load timing.
- `market:list:rows`: row count loaded by catalog queries.
- `market:render`: Marketplace render passes while active.
- `market:preview:load`, `market:preview:ready`, `market:preview:error`: selected-preview lifecycle.
- `avatar:timer:start`, `avatar:timer:stop`, `avatar:tick`: avatar animation drivers and ticks.
- `<tab:Eikons>`, `<sidebar>`, `<shell>` React Profiler rows in PERF reports.

## Baseline from automated harness

Commands run in this worktree:

```sh
bunx tsc --noEmit
bun test test/app.test.tsx test/eikon-marketplace-ui.test.tsx test/eikon-studio.test.tsx test/sidebar.test.tsx test/eikon-render.test.ts
```

Observed harness timings on 2026-05-31:

- Marketplace poster-only grid test: ~60 ms, 0 new `avatar:timer:start` after entering Marketplace.
- Selected sidebar preview app test: ~108 ms, 1 preview fetch and at most 1 new `avatar:timer:start` after entering Marketplace.
- Five-file regression slice: 84 tests in ~4.4 s before U9-specific additions.

These are test-renderer baselines, not host CPU profiling. They validate timer cardinality and fetch behavior. Use live `PERF=1` runs for CPU/render comparisons before enabling any extra animation surface.

## Policy

- Marketplace grid remains poster-only by default.
- Fetch preview data only for the currently selected row when there is a visible selected-preview surface.
- On selection changes, unmount/clear stale selected previews and ignore late loads by sequence id.
- Respect `animations: false` by rendering the first avatar frame without starting timers.
- Cap avatar animation cadence by `targetFps`.
- Leaving Marketplace must clear sidebar/detail preview state.
