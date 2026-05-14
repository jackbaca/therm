// Per-plugin disposable scope. Every registration a plugin makes routes
// its returned disposer through `track()`, so `dispose()` can unwind
// them in reverse order. Teardown shares a single time budget —
// a plugin whose cleanup hangs must not block the shell indefinitely.

import type { Dispose, Lifecycle } from "./types"

const BUDGET_MS = 5000

export type Scope = {
  readonly lifecycle: Lifecycle
  /** Wrap a disposer so it's run on scope dispose. Returns a manual
   *  disposer that runs `fn` once and removes it from the scope. */
  track(fn: Dispose | undefined): () => void
  dispose(): Promise<void>
}

export function createScope(id: string, fail: (msg: string, err?: unknown) => void): Scope {
  const ctrl = new AbortController()
  let list: { key: symbol; fn: Dispose }[] = []
  let done = false

  const onDispose = (fn: Dispose) => {
    if (done) return () => {}
    const key = Symbol()
    list.push({ key, fn })
    return () => { list = list.filter(x => x.key !== key) }
  }

  const track = (fn: Dispose | undefined) => {
    if (!fn) return () => {}
    let ran = false
    let drop = () => {}
    const wrapped = () => {
      if (ran) return
      ran = true
      drop()
      return fn()
    }
    drop = onDispose(wrapped)
    return wrapped
  }

  const race = (fn: Dispose, left: number) =>
    new Promise<"ok" | "timeout" | Error>(res => {
      const t = setTimeout(() => res("timeout"), left)
      Promise.resolve()
        .then(fn)
        .then(() => { clearTimeout(t); res("ok") })
        .catch(e => { clearTimeout(t); res(e instanceof Error ? e : new Error(String(e))) })
    })

  const dispose = async () => {
    if (done) return
    done = true
    ctrl.abort()
    const queue = [...list].reverse()
    list = []
    const until = Date.now() + BUDGET_MS
    for (const item of queue) {
      const left = until - Date.now()
      if (left <= 0) { fail(`[plugin:${id}] dispose budget exhausted`); return }
      const out = await race(item.fn, left)
      if (out === "ok") continue
      if (out === "timeout") { fail(`[plugin:${id}] dispose timed out`); return }
      fail(`[plugin:${id}] dispose threw`, out)
    }
  }

  return {
    lifecycle: { signal: ctrl.signal, onDispose },
    track,
    dispose,
  }
}
