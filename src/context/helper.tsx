// A full provider factory (init -> Provider+use) doesn't fit React:
// providers call hooks per-render and memo the returned value, so a
// factory would either call hooks inside useMemo or lose the memo.
// Providers stay hand-written; this module only dedups the useContext
// null-check.

import { useContext } from "react"

export function makeUse<T>(ctx: React.Context<T | null>, name: string) {
  return (): T => {
    const v = useContext(ctx)
    if (v === null) throw new Error(`${name}() must be used inside its provider`)
    return v
  }
}
