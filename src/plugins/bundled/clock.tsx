import { useEffect, useState } from "react"
import type { HermPlugin, HermPluginApi } from "../types"

const fmt = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, "0"))
    .join(":")

function Clock(props: { api: HermPluginApi }) {
  const [now, set] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => set(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <text fg={props.api.theme.current.textMuted} wrapMode="none">{fmt(now)}</text>
}

const plugin: HermPlugin = {
  id: "demo.clock",
  enabled: false,
  tui(api) {
    api.slots.register({
      order: 100,
      slots: { app_bottom: () => <Clock api={api} /> },
    })
  },
}

export default plugin
