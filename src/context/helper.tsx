// oc co-locates every provider in context/ via createSimpleContext; that
// factory relies on Solid's run-once components. React providers need
// per-render hook calls + useMemo on the value object, which can't be
// factored without either breaking hook rules or losing the memo. So
// herm keeps providers hand-written and this module only dedups the
// useContext null-check.

import { useContext } from "react"

export function makeUse<T>(ctx: React.Context<T | null>, name: string) {
  return (): T => {
    const v = useContext(ctx)
    if (v === null) throw new Error(`${name}() must be used inside its provider`)
    return v
  }
}
