# opencode parity — t_cfbfd0c8

Reference: `~/Dev/clones/opencode/packages/opencode/src/cli/cmd/tui` (SolidJS on OpenTUI, ~24.6K LOC)
Target:    `src/` (React on OpenTUI, ~25.2K LOC)
Baseline:  810/810 tests, 1 pre-existing tsc error (`test/context.test.tsx:136`)

## Findings summary

| Front | Verdict | Direction |
|---|---|---|
| Chat UX | herm at parity-or-better on 13/30 axes (slash dispatch, steer, subcommand complete, retry). Gaps cluster on: extmark parts model, cursor-relative `@`, permission body, stash/redo/shell-mode, edge-row history nav | Add ~10 behaviours |
| Code org | herm's `utils/` is a 6.2K-LOC mislabeled service layer (oc's `util/` is 689 LOC). 0 self-reexports vs oc's canonical pattern. 2 barrel `index.ts` violating oc's multi-sibling rule | Restructure |
| Comments | herm 13.3%, oc 1.3%. oc writes only invariants/quirks/error-policy. herm adds file headers + section dividers + pedagogy | **Prune**, not add |
| OpenTUI | Dialog lacks focus restore + selection guard + drag-aware backdrop. Spinner re-renders via setState. DialogSelect `onMouseMove` setCursor per-pixel. No global selection handler | 8 concrete fixes |
| Tests | herm TUI coverage 59% vs oc 20% — herm *ahead* on rendered-frame testing. Gaps: no `await using` disposable, no Probe pattern for state assertions, 10 zero-coverage files (PromptCard 359L, Memory 302L) | Port 2 patterns + cover gaps |

## Rejected from subagent reports

- **"Pane → `visible` prop"** — backwards. `opentui-performance` §3: unmount = zero cost; hidden = still reacts. Current unmount is correct; scroll-loss is the trade-off and acceptable for sub-tabs that poll.
- **"Theme context cascade"** — only on user theme-switch. Not worth splitting context.
- **Plugin/feature-plugin parity** — herm has no plugin system by design; out of scope.

## Wave plan

### Wave 1 — OpenTUI polish (foundation, ~6 files)
- `ui/dialog.tsx`: focus save/restore (`renderer.currentFocusedRenderable` capture + `isDestroyed` guard), size enum (`medium/large/xlarge`), drag-aware backdrop (`onMouseDown` records selection, dismiss on `onMouseUp`), selection-aware Esc guard
- `utils/selection.ts` (new): `copy(renderer, toast)`, `handleKey(renderer, toast, evt)` — port `oc:util/selection.ts`, wire into `useAppKeys` as earliest interceptor
- `ui/spinner.tsx`: ref-mutation on `<span>` child instead of `setState(tick)` — pattern from `ThoughtCloud.Tail`
- `ui/dialog-select.tsx`: `onMouseMove` → `onMouseOver`; kb/mouse mode guard to suppress synthetic cursor-move after filter
- `dialogs/{confirm,text-prompt,alert}.tsx`: pass resolver as `onClose` arg to `dialog.replace()`, drop duplicate Esc handler

### Wave 2 — Chat/Composer parity (~8 files)
- `app/useAtRefPopover.ts` + `Composer.tsx`: cursor-relative `@` detection (any line, any column) — read `ta.current.cursorOffset`, walk back
- `Composer.tsx`: history nav when cursor on first/last visual row (two-step: first ↑ → offset 0, second ↑ → nav)
- `app/useStash.ts` (new) + `/stash` · `/stash pop` · `/stash list` commands
- `Composer.tsx`: `!` at col 0 empty buffer → shell mode; Esc/backspace@0 exits; submit → `shell.exec`
- `app.tsx:send()`: `exit`/`quit`/`:q` literal → `quit()`
- `useAppKeys.ts:input.clear`: save ≥20-char draft to history before wipe
- `Composer.tsx` footer: retry countdown span + `tokens · $cost` right-aligned meta
- `PromptCard.tsx:Approval`: tool-specific body switch (diff for edit/write, `$ cmd` for terminal, url for fetch) + reject-with-message sub-state
- `useAtRefPopover.ts`: agents source + `#L-L` range parse + dir-expand-on-Tab

### Wave 3 — Module structure + comment prune
- Self-reexport on: `utils/fmt.ts`, `utils/preferences.ts`, `utils/sessions-db.ts`, `utils/hermes-kanban.ts`, `utils/hermes-home.ts`, `utils/hermes-profiles.ts` — bottom-of-file `export * as X from "./x"`, migrate callers to `X.foo`
- Remove `keys/index.ts` + `theme/index.ts` pure barrels; callers import siblings directly
- Strip `// ─── Section ───` dividers repo-wide
- Strip "what this does" narration; keep invariant/quirk/policy comments
- Add invariant comments to 6 under-commented files (`dialogs/new-profile`, `tabs/Env`, `tabs/Cron`, `tabs/Config`, `tabs/Memory`, `dialogs/curator`)

### Wave 4 — Tests
- `test/harness.tsx`: `mount()` returns `[Symbol.asyncDispose]` → `await using t = await mount()`
- `test/harness.tsx`: `probe<T>(use: () => T)` pattern — mount `<Probe>` that exports hook return via ref
- New tests: `prompt-card.test.tsx`, `memory.test.tsx`, `selection.test.ts`, `stash.test.ts`, `dialog-focus.test.tsx`, `spinner.test.tsx`
- `test/AGENTS.md` (new): fixture guide per `oc:test/AGENTS.md`

### Wave 5 — Stretch
- Composer extmark-backed parts model (blocks styled chips, atomic-backspace, part round-trip through history/rewind)
- Frecency store for `@` completion
- `/redo` client-side stack

## Out of scope
- SolidJS / Effect-ts adoption
- `packages/opencode` non-TUI test patterns (llm-server, Effect layers)
- `utils/` → `context/`+`service/` dir rename (too much churn for one branch; file kanban card)
- Composer extmark-backed parts model — styled @-chips and atomic paste-backspace need `@opentui/core` extmark API wiring through the textarea ref + a part↔extmark sync layer (~oc 200L). Standalone card.
- Upstream gateway RPCs (log in `docs/UPSTREAM.md`)

## Chat interaction parity checklist (acceptance, verified @ 833 tests)

| Behavior | oc ref | herm | test |
|---|---|---|---|
| `/` opens slash popover, live filter | component/prompt | useSlashPopover | app:437 |
| `@` cursor-relative, any line | component/prompt/autocomplete | useAtRefPopover `atWordAt` | atref.test |
| `@` frecency ranking | component/prompt/frecency | app/frecency | atref:frecency, frecency.test |
| `!` at col 0 → shell mode | component/prompt:894 | Composer mode + useAppKeys | shell-mode.test ×4 |
| Esc/⌫@0 exits shell mode | component/prompt:909,919 | useAppKeys:155 | shell-mode.test |
| `exit`/`quit`/`:q` literal quits | component/prompt submit | app.tsx send() | app:quit literal |
| Edge-row ↑/↓ history (two-step) | component/prompt:930 | Composer.historyUp/Down | composer.test |
| Ctrl+C clears buffer, saves ≥20 draft | config/keybind input_clear | useAppKeys:103 | app.test input.clear |
| `/stash` · pop · list | — (oc uses file-based) | app/stash + slash.tsx | stash.test |
| `/undo` → `/redo` replay | routes/session:626 | app/slash.tsx undone stack | redo.test ×2 |
| Slash while streaming → per-cmd policy | — | Composer.submit routes /→onSend | composer:streaming-slash |
| Plain text while streaming → busy mode | — | app.tsx onEnqueue tri-state | app:queue tests |
| Dialog focus-restore on close | ui/dialog | ui/dialog refocus | dialog-focus.test |
| Selection-aware Esc (clears not closes) | util/selection | utils/selection | selection.test |
| Approval body: `$ cmd` + pattern_keys | routes/session/permission | PromptCard.Approval | prompt-card.test |
| Footer esc-hint + model/usage | component/prompt footer | Composer footer | composer:footer |
| Spinner: ref-mutation, no setState | Tail | ui/spinner | spinner.test |

All 30 recon axes from Wave-0 either landed, were filed in UPSTREAM.md (2), or are out-of-scope above (2).
