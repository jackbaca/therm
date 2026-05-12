// Reference plugin — proves the host works. Ticks once a second and
// renders HH:MM:SS into the bottom gutter. Deliberately tiny.

import { useEffect, useState } from "react"
import { register, type GutterProps } from "./host"

const fmt = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, "0"))
    .join(":")

const Clock = (p: GutterProps) => {
  const [now, set] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => set(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <text fg={p.theme.textMuted} wrapMode="none">{fmt(now)}</text>
  )
}

register({
  id: "demo.clock",
  name: "Clock",
  gutter: (p) => <Clock {...p} />,
})
