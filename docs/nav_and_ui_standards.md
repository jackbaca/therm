# Herm Navigation & UI Standards

Prescriptive. New surfaces follow this; existing ones migrate toward it. Where this doc and `src/keys/catalog.ts` disagree, fix the catalog.

## Vocabulary

- **pane** — a bordered region with its own keyboard surface (a `TabShell`, a detail sidebar, a dialog body)
- **group / section** — a visually delimited cluster inside a pane (chip bar, column, category block)
- **item** — a single selectable row/card/field/chip
- **sub-mode** — a temporary text-capture state inside a pane (search `/`, inline edit)

## Key Behaviors

| Key                  | Expected Action/Behavior                                                                                                                                                                                                                   |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ←→                   | Selects<br>Moves Left/Right<br>- between items laid out horizontally (columns, chips, inline choices)<br>- between sibling panes when there is no horizontal item axis<br>- never leaves the current tab                                 |
| ↑↓                   | Selects<br>Moves Up/Down<br>- item-granular; does not skip items, groups, sections, or panes<br>- clamps at ends (no wrap) in lists; wraps only in small fixed choice sets                                                                |
| Tab<br>Shift+Tab     | Selects<br>Moves forward / backward with Shift<br>- between panes, groups, or sections<br>- between fields in a form dialog<br>- skips nested lists and item-level selection<br>- **never toggles, never activates**                     |
| Space                | Toggles / Cycles<br>- checkbox, tri-state chip, fold/unfold, pin/unpin<br>- preferred for low-commitment, reversible actions<br>- also Activates when the item has no toggle semantics and no text input has focus                       |
| Enter                | Activates / Opens / Commits<br>- applies in all the same situations as Space<br>- sole option for high-commitment actions (submit, switch profile, install, delete-confirm)                                                              |
| Esc                  | Backs out one level, in order:<br>1. exit sub-mode (search, inline edit) and discard buffer<br>2. step focus out of inner tier (pane → grid, detail → list)<br>3. close dialog<br>4. on Chat, return focus to composer<br>Never destroys data without a confirm |
| D / Delete           | Deletes / Removes<br>- always routes through `openConfirm` when the effect is external or irreversible                                                                                                                                    |
| Backspace            | In text sub-mode: erase char<br>On empty composer: peel last attachment<br>Otherwise: unbound (do **not** alias to Delete)                                                                                                                |
| PgUp / PgDn          | Move selection by one viewport height (stride = `viewport.height - 1`)                                                                                                                                                                     |
| Home / End           | First / last item in the active list                                                                                                                                                                                                       |
| `/`                  | Enter filter/search sub-mode for the active list                                                                                                                                                                                           |
| Letter mnemonics     | Tab-local verbs. Lowercase, no modifier. Reserved across all tabs: `n` new, `r` reload, `d` delete. Others are tab-owned (`k` kill, `h` history, `s` sort/switch, `c` …)                                                                   |
| `<leader>` (Ctrl+X)  | Two-stroke global prefix. `<leader>` + `1..0 -` jumps tabs; `<leader>` + letter fires a `global`-scope catalog action. Rebindable via the `leader` catalog entry                                                                           |
| Alt+←/→<br>Alt+1..0  | Top-level tab prev/next and direct jump. Shell-owned; tabs never see these                                                                                                                                                                 |
| Shift+←/→            | Sub-tab prev/next within the active group tab. Shell-owned                                                                                                                                                                                 |
| Double-tap           | Tab×2 on a content pane → jump to composer<br>Esc×2 while streaming → interrupt<br>No other double-tap bindings                                                                                                                           |

#### Notes
- If a selection can be both toggled and triggered, Space toggles and Enter triggers. They are only synonyms when one of the two semantics is absent.
- Arrows move **selection**; they do not scroll independently. Scrolling is a side effect of selection via `scrollChildIntoView`. Mouse wheel is the only selection-free scroll.
- Wrap-around: off for open-ended lists (sessions, skills, env). On for closed choice sets ≤ 6 items (prompt-card choices, status cycles).

## Scope Layering

One keypress, one handler. Precedence, highest first:

1. `global` — process escapes (`app.exit`, `app.suspend`, `app.redraw`, `app.sidebar`). Always live.
2. `dialog` — when `dialog.open()` is true. Shell yields everything below this line. `DialogProvider` owns Esc unless the dialog passed `ownCancel`.
3. sub-mode — the active tab's search/edit branch. Printable keys belong to the buffer; Esc exits.
4. `list` — shared vocabulary via `handleListKey` / `useListKeys`.
5. tab-scope — the tab's own mnemonics, checked after `list.*` falls through.
6. `composer` — textarea `keyBindings`.

Every tab's `useKeyboard` must open with `if (!props.focused || dialog.open()) return`. No exceptions.

New list-shaped surfaces route through `useListKeys` / `handleListKey`. Do not re-derive ↑↓/PgUp/PgDn/Home/End/Enter/Space/`/`/d/n/r locally.

## Focus & Selection Visuals

| State                  | Treatment                                                                      |
| :--------------------- | :----------------------------------------------------------------------------- |
| Focused pane           | `borderColor = theme.primary` (via `TabShell focus` prop)                      |
| Unfocused pane         | `borderColor = theme.border`                                                   |
| Selected row (kbd)     | `backgroundColor = theme.backgroundElement` + leading `▸ ` caret               |
| Hovered row (mouse)    | Same highlight as selected; hover **moves** selection (`onMouseMove → setSel`) |
| Current/active value   | Leading `● ` dot, independent of selection                                     |
| Disabled / archived    | `fg = theme.textMuted`, no caret                                               |
| Tri-state chip         | off: pill on `backgroundElement` · include: `accent` fill · exclude: strikethrough, no fill |

One caret per pane. One `theme.primary` border per screen.

## Mouse Parity

Anything reachable by keyboard is reachable by mouse, and vice versa.

- `onMouseMove` on a row sets selection (hover = select).
- `onMouseDown` on a row activates (same path as Enter).
- `onMouseDown` on the dialog backdrop closes the dialog (same as Esc).
- Inline ✕ glyphs are `onMouseDown` + `stopPropagation`; keyboard equivalent is `d`.
- Wheel scrolls the `scrollbox` under the pointer; it does not move selection.

Mouse handlers go on `<box>`, never `<span>`.

## Tab Bars

Top-level tabs and sub-tabs share one visual language; only navigation differs.

|              | Top tabs                   | Sub-tabs                  |
| :----------- | :------------------------- | :------------------------ |
| Nav keys     | Alt+←/→, `<leader>`/Alt + N | Shift+←/→                 |
| Active item  | `backgroundElement` block, bold, `theme.primary` fg | same |
| Inactive     | `theme.textMuted` fg, no block | same                  |
| Label        | bare name — no digit prefix, no bullet | same          |
| Padding      | `paddingX={2}`, `marginRight={1}` | same               |

One component renders both (`<TabStrip>`); call sites differ only in the right-aligned hint. Mouse: `onMouseDown` on an item switches.

## Hint Line

One hint line per tab, rendered as a **footer** below all panes and above the composer. The tab component owns it; `TabShell` titles stay bare. On multi-pane tabs the footer shows the union of live bindings and updates when focus moves between panes or a sub-mode starts.

```
┌─ Pane A ───────┐┌─ Pane B ───────┐
│                ││                │
│                ││                │
└────────────────┘└────────────────┘
 [↑↓] select  [Enter] open  [Tab] pane         ← footer, outside borders
```

Format: `[key] verb` pairs, two spaces between pairs, verbs lowercase, ≤ 6 pairs. Order: activate, create, delete, toggle, pane-local, refresh. Keys come from `keys.print(id)` so rebinds show correctly; structural keys (`↑↓`, `Tab`, `Esc`) are literal.

Example: `[↑↓] select  [Enter] open  [n] new  [d] delete  [/] search  [Tab] pane`

Dialogs keep their accept/cancel hint on the dialog's own last line, same format.

## Dialogs

- Enter = accept, Esc = cancel, always.
- `y` / `n` only in `openConfirm`.
- Multi-view dialogs (sub-picker inside a form) pass `ownCancel: true` and handle Esc as "back one view", closing only from the root view.
- `DialogSelect` with `filterable: false` accepts Space as select; with `filterable: true` Space types a literal space.
- Form dialogs: Tab / Shift+Tab walks fields; Enter on the last field submits; Enter on a select field opens its picker.
