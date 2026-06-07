import type { ToastContext, ToastVariant } from "../ui/toast"
import type { NotificationClearPayload, NotificationShowPayload } from "../context/wire"

function variant(level?: string): ToastVariant {
  switch (level) {
    case "error": return "error"
    case "warning":
    case "warn": return "warning"
    case "success": return "success"
    default: return "info"
  }
}

function duration(p: NotificationShowPayload): number | null | undefined {
  if (p.kind === "sticky") return null
  if (typeof p.ttl_ms === "number") return p.ttl_ms
  if (typeof p.duration_ms === "number") return p.duration_ms
  return undefined
}

export function showNotification(toast: ToastContext, p: NotificationShowPayload | undefined) {
  const text = String(p?.text ?? "").trim()
  if (!text) return
  toast.show({
    key: p?.key,
    variant: variant(p?.level),
    message: text,
    duration: duration(p ?? { text }),
  })
}

export function clearNotification(toast: ToastContext, p: NotificationClearPayload | undefined) {
  const key = String(p?.key ?? "").trim()
  // Upstream clear without a key can mean "clear current notice" in clients
  // with a single notice slot. Herm stores keyed notices independently, so an
  // unkeyed clear is intentionally a no-op instead of wiping unrelated sticky
  // notices from another controller path.
  if (!key) return
  toast.clear(key)
}
