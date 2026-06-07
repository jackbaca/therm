/**
 * Toast notification system — auto-dismiss messages.
 *
 * Usage:
 *   <ToastProvider><App /></ToastProvider>
 *
 *   const toast = useToast()
 *   toast.show({ variant: "success", message: "Done!" })
 *   toast.error(new Error("oops"))
 */

import { createContext, useState, useCallback, useRef, useMemo, useEffect } from "react"
import { makeUse } from "../context/helper"
import type { ReactNode } from "react"
import { useTheme } from "../theme"
import type { RGBA } from "@opentui/core"

export type ToastVariant = "info" | "error" | "warning" | "success"

export type ToastOptions = {
  readonly key?: string
  readonly variant: ToastVariant
  readonly title?: string
  readonly message: string
  readonly duration?: number | null
  /** Clickable affordance on the toast (e.g. "view" → open dialog). */
  readonly action?: { label: string; run: () => void }
}

type ToastEntry = ToastOptions & {
  readonly id: number
}

export type ToastContext = {
  readonly show: (opts: ToastOptions) => void
  readonly clear: (key: string) => void
  readonly error: (err: Error) => void
}

const Ctx = createContext<ToastContext | null>(null)

const DEFAULT_DURATION = 3000

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<ToastEntry[]>([])
  const counter = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t)
  }, [])

  const show = useCallback((opts: ToastOptions) => {
    const id = ++counter.current
    setItems(prev => {
      const drop = opts.key ? prev.filter(t => t.key === opts.key) : []
      for (const item of drop) {
        const t = timers.current.get(item.id)
        if (t) clearTimeout(t)
        timers.current.delete(item.id)
      }
      const next = opts.key ? prev.filter(t => t.key !== opts.key) : prev
      return [...next, { ...opts, id }]
    })
    const dur = opts.duration ?? DEFAULT_DURATION
    if (dur === null) return
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id)
      setItems(prev => prev.filter(t => t.id !== id))
    }, dur))
  }, [])

  const clear = useCallback((key: string) => {
    setItems(prev => {
      for (const item of prev) {
        if (item.key !== key) continue
        const t = timers.current.get(item.id)
        if (t) clearTimeout(t)
        timers.current.delete(item.id)
      }
      return prev.filter(t => t.key !== key)
    })
  }, [])

  const error = useCallback((err: Error) => {
    show({ variant: "error", title: "Error", message: err.message })
  }, [show])

  const value = useMemo<ToastContext>(() => ({ show, clear, error }), [show, clear, error])

  return (
    <Ctx.Provider value={value}>
      {children}
      {items.length > 0 ? <ToastOverlay items={items} /> : null}
    </Ctx.Provider>
  )
}

const ToastOverlay = ({ items }: { items: ReadonlyArray<ToastEntry> }) => {
  const theme = useTheme().theme

  const color = (variant: ToastVariant): RGBA => {
    switch (variant) {
      case "error": return theme.error
      case "warning": return theme.warning
      case "success": return theme.success
      default: return theme.info
    }
  }

  return (
    <box
      position="absolute"
      top={2}
      right={2}
      flexDirection="column"
      gap={1}
      zIndex={200}
      maxWidth={60}
    >
      {items.map(item => (
        <box
          key={item.id}
          backgroundColor={theme.backgroundPanel}
          border={["left"] as const}
          borderStyle="single"
          borderColor={color(item.variant)}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
        >
          {item.title ? (
            <text fg={theme.text}>
              <strong>{item.title}</strong>
            </text>
          ) : null}
          <text fg={theme.textMuted} wrapMode="word">
            {item.message}
          </text>
          {item.action ? (
            <box height={1} marginTop={0} onMouseDown={item.action.run}>
              <text fg={color(item.variant)}><u>{item.action.label}</u></text>
            </box>
          ) : null}
        </box>
      ))}
    </box>
  )
}

export const useToast = makeUse(Ctx, "useToast")
