# Control server

An HTTP control server that exposes imperative actions on a running
herm TUI: tab navigation, message send, key injection, focus-tree
and frame-buffer reads, perf dumps, plugin toggles, synthetic event
push, clean exit. It is the substrate for automated testing, demo
recordings (ptyrun), and the end-to-end harness.

It is **off by default**. Set `CONTROL=1` to start it.

## Environment

| Variable       | Default       | Meaning                                                  |
| -------------- | ------------- | -------------------------------------------------------- |
| `CONTROL`      | (unset)       | `1` enables the HTTP server. Anything else is a no-op.   |
| `CONTROL_PORT` | `7777`        | TCP port to listen on.                                   |
| `CONTROL_BIND` | `127.0.0.1`   | Hostname to bind. Loopback-only by default.              |

## Security posture

The server binds `127.0.0.1` by default. `/send`, `/key`, `/keys`,
`/type`, `/input`, `/plugin/:id`, `/push`, and `/quit` can mutate
session state, activate plugins, or kill the process — binding to the
network would let anyone on the same LAN do the same.

If `CONTROL_BIND` is anything other than `127.0.0.1`, `::1`, or
`localhost`, start-up writes a yellow warning to stderr AND the TUI
raises a 15-second `warning` toast: *"CONTROL server bound to
HOST:PORT — reachable from the network."* Override intentionally (e.g.
testing from a VM host against a guest TUI) — just know the exposure
is wire-visible.

There is no auth. Inside `localhost` this is fine; across hosts, tunnel
over SSH (`ssh -L 7777:localhost:7777 host`) instead of binding a
non-loopback address.

Key-injection endpoints (`/key`, `/keys`, `/type`) additionally block
*known mutating keys per tab* (Enter on Chat, `d`/`delete` on Sessions,
etc.) unless the request passes `safe: false`. See `DANGEROUS` in
`src/app/control.ts` for the exact table.

## Endpoints

All JSON bodies are `application/json`. All responses are JSON unless
noted.

| Method | Path            | Body / Query                                                   | Effect                                                        |
| ------ | --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| GET    | `/status`       | —                                                              | App state snapshot (tab, streaming, session, input, rss/heap) |
| GET    | `/tab/:n`       | —                                                              | Switch to tab `n` via the real key path (alt+arrow)           |
| POST   | `/send`         | `{ message }`                                                  | Submit a chat message (blocked while streaming)               |
| POST   | `/key`          | `{ name, ctrl?, shift?, meta?, raw?, safe? }`                  | Inject one key event                                          |
| POST   | `/keys`         | `{ keys: [...], delay?, safe? }`                               | Inject a sequence with optional delay                         |
| POST   | `/type`         | `{ text, delay?, safe? }`                                      | Type a string as individual keystrokes                        |
| POST   | `/input`        | `{ text }`                                                     | Set composer value in one shot (no per-char keys)             |
| POST   | `/plugin/:id`   | `{ on }`                                                       | Toggle a plugin                                               |
| POST   | `/push`         | `{ type, payload? }`                                           | Inject a synthetic gateway event                              |
| GET    | `/quit`         | —                                                              | Clean exit (200 flushes, then `process.exit(0)`)              |
| GET    | `/frame`        | `?grep=pat&json=1`                                             | Current screen buffer as text; optional grep / JSON envelope  |
| GET    | `/logs`         | `?n=200`                                                       | Gateway stderr ring buffer                                    |
| GET    | `/focus`        | —                                                              | Focus tree with counts                                        |
| GET    | `/perf`         | —                                                              | Perf snapshot (requires `PERF=1`)                             |
| GET    | `/tabs`         | `?delay=500`                                                   | Cycle all tabs with delay, return to Chat                     |
| GET    | `/mem`          | —                                                              | Memory snapshot (rss, heap, heapTotal, external)              |

## Use cases

- **ptyrun / demo recordings.** Drive a real PTY-hosted TUI from a
  script: `POST /input`, `POST /send`, `GET /frame` to grab the
  rendered output, `GET /quit` to flush on EOF.
- **End-to-end harness.** Mount the app under a control server, inject
  keys and synthetic gateway events, assert on `/frame` or `/focus`.
- **Perf debugging.** `PERF=1 CONTROL=1 bun run dev`, poke the app,
  `curl localhost:7777/perf` for the full profiling dump.
- **Manual triage.** Script a reproduction of a flaky UI state without
  wrestling with the terminal.

## Invocation

```
# Default — loopback-only
CONTROL=1 bun run dev

# Custom port
CONTROL=1 CONTROL_PORT=9000 bun run dev

# Cross-host testing (warning surfaced)
CONTROL=1 CONTROL_BIND=0.0.0.0 bun run dev

# Over SSH instead of binding wire-visible
ssh -L 7777:localhost:7777 host
CONTROL=1 bun run dev  # (on the remote)
curl localhost:7777/status  # (on the client)
```
