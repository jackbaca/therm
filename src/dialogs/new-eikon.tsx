import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import { knobs } from "../utils/eikon-knobs"
import { openTextPrompt } from "./text-prompt"
import type { DialogContext } from "../ui/dialog"

export type NewEikon =
  | { name: string; from: "blank" }
  | { name: string; from: "file"; file: string }
  | { name: string; from: "install"; src: string }

type From = "blank" | "file" | "install"
type Field = "name" | "from"
const ORDER: readonly Field[] = ["name", "from"] as const
const FROMS: readonly { id: From; label: string; hint: string }[] = [
  { id: "blank",   label: "blank",        hint: "author in Studio" },
  { id: "file",    label: "local file",   hint: "png / jpg / webp / gif / mp4" },
  { id: "install", label: "install from", hint: "catalog name · git URL · http://… · local dir" },
]

const INSTALL_HINT = "catalog name · github.com/u/r · git URL · http://…/ · local dir"

export function openNewEikon(
  dialog: DialogContext,
  opts: { initial?: string } = {},
): Promise<NewEikon | null> {
  return new Promise(resolve => {
    const done = (r: NewEikon | null) => { dialog.clear(); resolve(r) }
    dialog.replace(<Form initial={opts.initial} done={done} dialog={dialog} />)
  })
}

const Form = (props: {
  initial?: string
  dialog: DialogContext
  done: (r: NewEikon | null) => void
}) => {
  const theme = useTheme().theme
  const [name, setName] = useState(props.initial ?? "")
  const [from, setFrom] = useState<From>("blank")
  const [field, setField] = useState<Field>("name")
  const slug = name ? knobs.slug(name) : ""
  const ok = slug.length > 0

  const submit = async () => {
    if (!ok) return
    if (from === "blank") return props.done({ name: slug, from: "blank" })
    if (from === "file") {
      const file = await openTextPrompt(props.dialog, {
        title: "Source file",
        label: "absolute or ~ path (png / jpg / webp / gif / mp4)",
      })
      if (!file) return props.done(null)
      return props.done({ name: slug, from: "file", file })
    }
    const src = await openTextPrompt(props.dialog, {
      title: "Install eikon",
      label: INSTALL_HINT,
    })
    if (!src) return props.done(null)
    props.done({ name: slug, from: "install", src })
  }

  useKeyboard(key => {
    if (key.name === "escape") return props.done(null)
    if (key.name === "tab") {
      const i = ORDER.indexOf(field)
      return setField(ORDER[(i + (key.shift ? -1 : 1) + ORDER.length) % ORDER.length]!)
    }
    if (key.name === "return") return void submit()
    if (field === "name") {
      if (key.name === "backspace") return setName(n => n.slice(0, -1))
      if (key.raw && key.raw.length === 1 && /[A-Za-z0-9 _-]/.test(key.raw))
        return setName(n => n + key.raw)
      return
    }
    // field === "from"
    if (key.name === "up") {
      const i = FROMS.findIndex(f => f.id === from)
      return setFrom(FROMS[Math.max(0, i - 1)]!.id)
    }
    if (key.name === "down") {
      const i = FROMS.findIndex(f => f.id === from)
      return setFrom(FROMS[Math.min(FROMS.length - 1, i + 1)]!.id)
    }
  })

  const bg = (f: Field) => field === f ? theme.backgroundElement : undefined

  return (
    <box flexDirection="column" width={60}>
      <box height={1}><text fg={theme.primary}><strong>New eikon</strong></text></box>
      <box height={1} />
      <box height={1} flexDirection="row" backgroundColor={bg("name")}>
        <box width={9}><text fg={theme.textMuted}>Name</text></box>
        <text>
          <span fg={theme.text}>{name}</span>
          {field === "name" ? <span fg={theme.accent}>█</span> : null}
        </text>
      </box>
      <box height={1}><text fg={theme.textMuted}>
        {slug ? `  → ${slug}` : "  type a name"}
      </text></box>
      <box height={1} />
      <box height={1} backgroundColor={bg("from")}>
        <text fg={theme.textMuted}>From  (↑↓)</text>
      </box>
      {FROMS.map(f => {
        const on = f.id === from
        const fg = on ? theme.accent : theme.text
        return (
          <box key={f.id} height={1} flexDirection="row" backgroundColor={bg("from")}>
            <box width={2}><text fg={fg}>{on ? "▸ " : "  "}</text></box>
            <box width={14}><text fg={fg}>{f.label}</text></box>
            <text fg={theme.textMuted}>{f.hint}</text>
          </box>
        )
      })}
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {ok ? "Enter create  ·  Tab next field  ·  Esc cancel" : "type a name"}
      </text></box>
    </box>
  )
}
