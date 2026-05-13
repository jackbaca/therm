// Worker entrypoint. Own thread, own bun:sqlite handle, so `.all()`
// never pins the render loop. Bun workers inherit the OS environ
// regardless of parent process.env mutations (and under `bun test`
// ignore env writes entirely), so the parent passes its resolved
// HERMES_HOME per request and we rebind the reader path explicitly.

import { setHome } from "../service/sessions-db"
import { FNS, type Fn } from "./fns"

type Req = { id: number; home: string; fn: Fn; args: unknown[] }
type Res = { id: number; ok: true; v: unknown } | { id: number; ok: false; err: string }

const bound = { home: "" }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, home, fn, args } = e.data
  if (bound.home !== home) { setHome(home); bound.home = home }
  const f = FNS[fn] as ((...a: unknown[]) => unknown) | undefined
  if (!f) return self.postMessage({ id, ok: false, err: `io: unknown fn '${fn}'` })
  try { self.postMessage({ id, ok: true, v: f(...args) } satisfies Res) }
  catch (e) { self.postMessage({ id, ok: false, err: (e as Error).message } satisfies Res) }
}
