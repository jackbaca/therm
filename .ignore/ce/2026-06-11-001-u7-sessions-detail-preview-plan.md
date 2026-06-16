---
title: "U7: Sessions detail preview and sub-session pane"
type: feat
status: active
date: 2026-06-11
---

# U7: Sessions detail preview and sub-session pane

## Scope

Implement only the Sessions tab changes from the parent UX polish plan:

- Move subagent child sessions out of the main list when the wide detail pane is visible.
- Show subagent children for the selected parent in the detail pane with keyboard/mouse activation through the existing load-session confirmation flow.
- Preserve subagent reachability when the detail pane is hidden by keeping compact inline child rows and an explicit child-count hint.
- Change transcript preview data access to show first two and last two messages for long transcripts, with no duplicate rows when count is four or fewer.
- Wrap long titles in detail/search detail surfaces only; keep main list single-height and anchored.
- Keep selected row, cursor marker, and detail content tied to the same stable session id across reloads, filtering, hover, and keyboard movement.

Excluded: Portability, Docker, OpenTUI upgrade, Sidebar redesign, broad responsive/mobile pass, TabShell border-title redesign, selected-panel double-border redesign, fit-to-content panes, skill composer, kanban-detail keyboard overhaul, and gateway RPC changes.

## Current code findings

- `src/tabs/Sessions.tsx` already tracks selection by `{ id, indent }` and uses `onMouseMove` for hover.
- The current `visible` list inlines children for the selected parent in all widths.
- The current detail pane only shows a spawned count, not child rows or activation affordances.
- `Peek` currently requests the last 60 rows and scrolls to the bottom; `sdb.peek()` implements that last-N behavior.
- Detail/search titles already use `wrapMode="word"`; list rows use `Marquee` and must remain height=1.

## Implementation plan

1. Tests first.
   - Update tree/subagent tests so wide mode expects no inline child rows, a detail-pane child list, and activation by clicking a child in detail.
   - Add a narrow-width test proving children remain inline/reachable and the child-count hint appears when the detail pane is hidden.
   - Add transcript tests for 0, 1, 4, 5, and tool-heavy peeks. Assert long transcript previews show first/last rows with a gap and no duplicates.
   - Add/adjust a reload/filter selection test that confirms the detail panel follows the same selected id as the cursor.

2. Data layer.
   - Change `sdb.peek(sid)` to return first two and last two rows when total message count exceeds four.
   - Keep chronological order and cap content/tool_calls as before.
   - Avoid duplicates for counts <= 4.
   - Preserve optional `platform_message_id` and `observed` handling.

3. UI.
   - Gate inline subagent expansion on `!showDetailPanel`.
   - In wide mode, selected parent rows show subagent count/action hint in the row text/meta but do not inline child rows.
   - Extend `Detail` to receive loaded children for the selected row and render them as clickable/keyboard-consistent affordances using existing `lineageSwitch` confirmation flow.
   - Keep child row activation in narrow mode through existing `visible` list flow.
   - Ensure `Detail` is passed `visible[sel].row`, so selected cursor/detail remain aligned.

4. Verification.
   - Run focused `bun test test/sessions.test.tsx` after red and green cycles.
   - Run full `bun test`.
   - Run `bunx tsc --noEmit`.
   - Manual narrow/wide smoke with test renderer evidence from frames.

5. Review / PR.
   - Run a self code-review/autofix pass against this plan before final commit.
   - Commit autofix changes separately if any are required.
   - Commit final implementation, push `feat/sessions-detail-preview`, open PR to `dev`, and watch CI with up to three fix iterations.

## Risks

- OpenTUI row heights are fragile; do not wrap list rows.
- Mouse activation coordinates differ between inline list rows and detail pane rows; tests should find text coordinates from frames.
- `session.list` RPC rows may lack local `detail`; child-pane behavior should only appear when loaded `detail.subagent_count` and `kids` are available.
- `message_count` may include filtered-out system/tool rows; preview gap semantics should be based on raw rows returned by `sdb.peek`, while UI footer still reports rendered turn/tool counts.
