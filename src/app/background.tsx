// In-flight /background task ids. Registered on prompt.background,
// unregistered on background.complete.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { makeUse } from "../context/helper"

type Ctx = {
  count: number
  ids: readonly string[]
  register: (id: string) => void
  unregister: (id: string) => void
}

const ctx = createContext<Ctx | null>(null)

export const BackgroundProvider = ({ children }: { children: ReactNode }) => {
  const [set, setSet] = useState<ReadonlySet<string>>(() => new Set())
  const register = useCallback((id: string) => {
    if (!id) return
    setSet(prev => prev.has(id) ? prev : new Set(prev).add(id))
  }, [])
  const unregister = useCallback((id: string) => {
    setSet(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])
  const ids = useMemo(() => Array.from(set), [set])
  const value = useMemo<Ctx>(
    () => ({ count: ids.length, ids, register, unregister }),
    [ids, register, unregister],
  )
  return <ctx.Provider value={value}>{children}</ctx.Provider>
}

export const useBackground = makeUse(ctx, "useBackground")
