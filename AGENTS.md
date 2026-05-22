- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`. Feature branches and PRs target `dev`; `main` only receives release PRs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- This is a TUI app built with OpenTUI React (`@opentui/react`), NOT React DOM. JSX renders to a terminal.
- Data from `~/.hermes/` carries `source: Source` provenance. Use `<FileLink>` in UI, never hardcode paths.

## Style Guide

### Directory Layout

```
src/
  app/        shell orchestration: app.tsx, useAppKeys, useStream, slash, bridge, control
  context/    cross-cutting providers + RPC: gateway, skin, wire (types), gateway-client, events, preferences, helper
  service/    ~/.hermes I/O: hermes-home, hermes-kanban, hermes-profiles, sessions-db, …
  home/       reactive store over service/ readers (useHome, home.invalidate)
  utils/      pure helpers: clipboard, selection, perf, tokens, fmt, math-unicode, …
  ui/         reusable TUI primitives: dialog, toast, command, spinner, kv, shell, Splash
  components/ chat+sidebar+avatar renderables
  tabs/       top-level tab bodies (one file per sub-tab)
  dialogs/    modal dialog bodies (openX functions)
  keys/       keybinding catalog, chord parser, list nav
  theme/      theme resolver + 33 JSON themes
  config/     config schema, lane routing (RPC vs cli.exec)
  io/         Worker bridge for sync bun:sqlite off main thread
  types/      message, part
```

When deciding where something goes: does it touch `~/.hermes`? →
`service/`. Is it a React context provider? → `context/` (or `ui/` if
it also renders overlay JSX). Is it stateless and domain-agnostic? →
`utils/`. Does it only make sense inside `AppInner`? → `app/`.

### Module Shape

Non-component modules with 4+ exports self-reexport at the bottom of the
file so consumers get a single namespace instead of wide destructuring:

```ts
// src/context/preferences.ts
export function get<K>(k: K) { ... }
export function set<K>(k: K, v: V) { ... }

export * as prefs from "./preferences"
```

```ts
// consumer
import { prefs } from "../context/preferences"
prefs.get("animations")
```

Do not add barrel `index.ts` files to multi-sibling directories — they
force every sibling to evaluate on any import. Import the specific file.

Do not use `// ─── Section ───` divider comments. Comments describe
invariants, platform quirks, or non-obvious ordering — never "what this
block does" narration or task/migration history.

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`, `bun:sqlite`, `Bun.Glob`
- Bun auto-loads `.env` — don't use dotenv
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1;
function journal(dir: string) {}

// Bad
const fooBar = 1;
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json();

// Bad
const journalPath = path.join(dir, "journal.json");
const journal = await Bun.file(journalPath).json();
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a;
obj.b;

// Bad
const { a, b } = obj;
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2;

// Bad
let foo;
if (condition) foo = 1;
else foo = 2;
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1;
  return 2;
}

// Bad
function foo() {
  if (condition) return 1;
  else return 2;
}
```

### OpenTUI Gotchas

- `<text>` children must be strings, `<span>`, `<strong>`, `<u>` — never `<box>` or nested `<text>`.
- Mouse events (`onMouseDown`, `onMouseOver`, etc.) work on `<box>` and `<text>`, NOT `<span>`.
- To make inline content clickable, use `<box height={1}>` with handlers, `<text>` inside.
- `useRef()` requires an initial argument — use `useRef<T>(null)`, not `useRef<T>()`.
- `<scrollbox scrollY>` for scrollable content.

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Run tests with `bun test`
- **Never run a standalone script that calls `hermesPath()` / `rmSync` / writes SQLite without first setting `HERMES_HOME` to a tmpdir.** `test/preload.ts` does this for `bun test`; `bun <file>.tsx` does NOT. A one-off repro script that imports from `src/` resolves `~/.hermes` and will clobber real user data. Pattern: `process.env.HERMES_HOME = mkdtempSync(join(tmpdir(), "herm-scratch-"))` as the first line, before any `src/` import.

## Type Checking

- Always run `bunx tsc --noEmit` after changes.
