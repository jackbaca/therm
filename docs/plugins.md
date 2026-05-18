# Plugins

Extend herm with new UI surfaces, top-level tabs, command-palette entries, and gateway event listeners. A plugin is a single TypeScript module that exports `{ id, tui }`; `tui` is a function that receives an `api` object and imperatively registers whatever it needs.

Everything a plugin registers is tracked. Deactivating the plugin unwinds all registrations automatically.

## Minimal plugin

```tsx
import type { HermPlugin } from "../types"

const plugin: HermPlugin = {
  id: "acme.hello",
  tui(api) {
    api.slots.register({
      order: 50,
      slots: {
        app_bottom: () => <text fg={api.theme.current.textMuted}>hello</text>,
      },
    })
  },
}

export default plugin
```

`id` must be globally unique; use a reverse-DNS-ish prefix (`acme.thing`). `tui` may be `async`.

## Wiring it in

Today herm loads **bundled** plugins only. To add yours:

1. Drop the file in `src/plugins/bundled/`.
2. Import and append it in `src/plugins/internal.ts`:

```ts
import hello from "./bundled/hello"

export const INTERNAL: ReadonlyArray<HermPlugin> = [
  clock,
  files,
  hello,
]
```

Order in `INTERNAL` = activation order = default precedence when two plugins contribute to the same slot with equal `order`.

External loading (npm packages, `~/.herm/plugins/*.tsx`) is not wired yet; see **Roadmap** below.

## Extension points

### Slots — inject UI into fixed host locations

```tsx
api.slots.register({
  order: 10,
  slots: {
    app_bottom: (ctx, p) => <text>{p.streaming ? "…" : "idle"}</text>,
  },
})
```

Available slot names and the props each receives (see `src/plugins/types.ts::Slots`):

- `app_bottom` — one-row gutter below the composer. `{ sid, tab, streaming }`. Host uses `mode="single_winner"`.
- `sidebar_content` — stacked section inside the right sidebar. `{ sid }`.
- `sidebar_footer` — pinned row at the bottom of the sidebar. `{ sid }`.
- `prompt_right` — inline, right of the composer input. `{ sid }`.
- `splash_footer` — below the splash logo on an empty session. `{}`.

The slot renderer receives `(ctx, props)`. `ctx.theme` is the live resolved theme — prefer `api.theme.current` from the closure, which reads the same source.

**Composition modes** are chosen by the host at each `<Slot>` call site:

- `append` (default) — your contribution stacks after the host's default child and after lower-`order` plugins.
- `replace` — your contribution supplants the host's default child.
- `single_winner` — only the lowest-`order` contribution renders; the rest are dropped.

A slot renderer that throws is caught by a per-plugin error boundary; the slot renders empty (or the host default) and the rest of the shell is unaffected.

### Routes — add a top-level tab

```tsx
api.route.register([{
  name: "Scratch",
  description: "Scratch pad",
  render: () => <Scratch api={api} />,
}])
```

The tab appears after the five built-in groups (Chat / Sessions / Profiles & Automation / Config / Eikon). `name` is the label and the navigation key.

Navigate programmatically:

```ts
api.route.navigate("Scratch")        // to your own route
api.route.navigate("memory")         // to a built-in sub-tab by slash name
api.route.current                    // current tab name, or undefined before bind
```

### Commands — add to the palette (Ctrl+K)

```tsx
api.command.register([{
  title: "Scratch: open",
  value: "acme.scratch.open",
  category: "Plugin",
  onSelect: () => api.route.navigate("Scratch"),
}])
```

### Events — react to the gateway stream

```ts
api.event.on(ev => {
  if (ev.type === "message.complete") api.ui.toast({ message: "Turn done" })
})
```

See `src/context/wire.ts` for the full `GatewayEvent` union.

### Eikon rasterizers — add an image→text backend to the Eikon tab

The Eikon Studio renders its 48×24 preview through a pluggable rasterizer. Studio owns all spatial work — decode, crop, zoom, pan — and hands your rasterizer a pre-cropped grayscale `Window`. You only decide how luminance maps to glyphs. Two ship built-in (`chafa`, `native`); a plugin can contribute more:

```ts
import type { Rasterizer } from "../../utils/eikon-render"

const r: Rasterizer = {
  name: "my-ascii",
  knobs: {
    palette: { kind: "cycle", options: ["dense", "sparse", "blocks"], default: "dense" },
    dither:  { kind: "toggle", default: true },
    gamma:   { kind: "slider", min: 0.5, max: 2.0, step: 0.1, default: 1.0 },
  },
  available: () => Bun.which("my-ascii") ? true : "my-ascii not on PATH",
  async render(win, knobs) {
    // win.gray is a row-major Uint8Array of win.w × win.h gray bytes.
    // CLI backends that read stdin can use win.png() — a lazy 8-bit
    // grayscale PNG encode of the same pixels (~1 ms at 384×384).
    const p = Bun.spawn(["my-ascii", "-",
      "--palette", String(knobs.palette),
      "--gamma", String(knobs.gamma),
      ...(knobs.dither ? ["--dither"] : []),
    ], { stdin: win.png(), stdout: "pipe", stderr: "pipe" })
    const out = await new Response(p.stdout).text()
    await p.exited
    if (p.exitCode !== 0) return { err: await new Response(p.stderr).text() || "failed" }
    return { frames: [out.trimEnd().split("\n")] }
  },
}

// inside tui(api):
api.eikon.rasterizer.register(r)
```

The Studio reads your `knobs` schema and renders each entry generically — `cycle` as `◂ value ▸`, `toggle` as `● / ○`, `slider` as a drag bar. You own only `render()`; the tab handles zoom/pan, playback, selection, persistence (`studio.json`), per-state overrides, and save.

- `available()` returns `true` or a short reason string; unavailable rasterizers appear dimmed in the picker with the reason as a hint.
- `render()` is `async`. Use `Bun.spawn`, not `spawnSync` — blocking the main thread freezes slider drag. For in-process rasterizers, read `win.gray` directly; it's already the cropped window.
- **Video sources:** `win.frames` may be > 1. `win.gray` is N planes of `win.w × win.h` vstacked; `win.png()` encodes them as one `w × (h·N)` image. Return `win.frames` frames. If your backend renders one image at a time, call it once per `eachFrame(win, i)` (exported from `utils/eikon-render`), or render the tall filmstrip and split the output every 24 rows — that's ~50× fewer spawns.
- `win.gray` is yours to mutate (each call gets a fresh copy). `win.png()` encodes whatever `win.gray` holds at call time, so apply any pixel-level adjustments before calling it.
- Output is always 48×24 per frame; the tab pads/clips and derives its own thumbnails.
- `signal` (optional third arg) is an `AbortSignal` — honour it by killing your subprocess or bailing early; the tab fires it when a newer render supersedes this one.
- Registration is scope-tracked: deactivating your plugin removes the rasterizer from the picker automatically. If it was the active one, the tab falls back to the first available built-in.

Full type: `src/utils/eikon-render.ts::Rasterizer`. Registry lives in `src/service/eikon.ts`.

## The `api` object

Import the type from `src/plugins/types.ts::HermPluginApi`. One line per surface:

- `api.renderer` — the `CliRenderer`. Rarely needed directly.
- `api.theme.current` / `.name` / `.mode` / `.set(name)` / `.has(name)` — live theme.
- `api.keys` — resolved keybinding table. `keys.match(id, key)`, `keys.print(id)`. Read-only today.
- `api.ui.dialog` — host dialog stack: `replace(node, onClose?)`, `clear()`, `open()`.
- `api.ui.toast({ variant?, title?, message })`
- `api.ui.confirm({ title, body, danger? }) → Promise<boolean>`
- `api.ui.prompt({ title, label?, initial? }) → Promise<string | null>`
- `api.ui.alert(title, body)`
- `api.ui.select({ title, options, placeholder? }) → Promise<SelectOption | null>`
- `api.kv.get(key, fallback)` / `api.kv.set(key, value)` — persistent store, **namespaced by your plugin id**. Backed by `~/.hermes/herm/tui.json` under `plugin` (or `$HERM_CONFIG_DIR/tui.json` if set).
- `api.client` — the gateway RPC client. `client.request<T>(method, params)`.
- `api.event.on(fn) → dispose`
- `api.route.register(defs) → dispose` / `.navigate(name, sub?)` / `.current`
- `api.command.register(cmds) → dispose`
- `api.slots.register({ order?, slots }) → dispose`
- `api.eikon.rasterizer.register(r) → dispose` — contribute a rasterizer to the Eikon tab.
- `api.lifecycle.signal` — `AbortSignal` that fires when the plugin deactivates.
- `api.lifecycle.onDispose(fn) → cancel` — register extra teardown.

## Lifecycle

On activation the runtime creates a **scope** for your plugin, calls `tui(api)`, and routes every `api.*.register(...)` / `api.event.on(...)` return value through the scope. You do **not** need to hold or call those disposers yourself.

On deactivation (user toggle, `usePlugins().deactivate(id)`, or shell unmount) the scope:

1. Aborts `api.lifecycle.signal`.
2. Runs every tracked disposer and every `onDispose` callback, in reverse order, sharing a 5-second budget.

Use `onDispose` for resources the scope can't see (intervals, subprocesses, file watchers):

```ts
tui(api) {
  const t = setInterval(poll, 1000)
  api.lifecycle.onDispose(() => clearInterval(t))

  void fetch(url, { signal: api.lifecycle.signal }).then(...)
}
```

If `tui()` throws, activation fails for that plugin only; the error is logged and the next plugin proceeds.

## Enable / disable

Plugins are enabled by default. Set `enabled: false` on the `HermPlugin` object to ship it off-by-default. User toggles (via `usePlugins().activate/deactivate`) persist in `~/.hermes/herm/tui.json` under `plugin.enabled` keyed by plugin id and override the default on subsequent launches.

## Rendering notes

This is an OpenTUI React renderer, not React DOM.

- `<text>` children are strings, `<span>`, `<strong>`, `<u>` only — never `<box>` or nested `<text>`.
- Use `<box>` for layout; `<scrollbox scrollY>` for scroll.
- Mouse handlers go on `<box>`/`<text>`, not `<span>`.
- Always read colors from `api.theme.current.*` (`text`, `textMuted`, `accent`, `backgroundElement`, `error`, …). Hex literals bypass theming.
- `wrapMode` is `"none" | "word" | "char"`.

Do not import from `src/theme`, `src/keys`, `src/context`, or `src/ui` directly — route through `api`. This keeps your plugin loadable once external loading lands.

## Testing

`mountNode` accepts a per-test plugin list; no global registry to reset.

```tsx
import { mountNode, until } from "../test/harness"
import { usePlugins } from "../src/plugins/runtime"

const Host = () => {
  const p = usePlugins()
  return <p.Slot name="app_bottom" mode="single_winner" sid="" tab={0} streaming={false} />
}

test("renders", async () => {
  await using t = await mountNode(<Host />, { plugins: [myPlugin] })
  await until(t, () => t.frame().includes("hello"))
})
```

See `test/plugin-runtime.test.tsx` for the full pattern (activate/deactivate, error isolation, kv namespacing).

## Roadmap

Not yet available; seams exist:

- **External loading** — npm package / filesystem resolution with shared-React-instance support. Until then, plugins must be compiled into the herm bundle via `INTERNAL`.
- **Key registration** — `api.keys` is read-only; plugins cannot add bindings yet.
- **`api.state`** — direct home-store access (sessions, usage, live info). Use `api.client.request(...)` meanwhile.
- **`api.theme.install`** — plugin-shipped theme JSON.
- **Sidebar / prompt / splash slots** are declared but not yet mounted at every host call site.
