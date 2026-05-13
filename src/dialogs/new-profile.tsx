import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import { validateName } from "../service/hermes-profiles"
import type { DialogContext } from "../ui/dialog"

type Result = { name: string; cloneFrom: string | null; alias: boolean }
type Field = "name" | "clone" | "alias"
const ORDER: readonly Field[] = ["name", "clone", "alias"] as const

export function openCreateProfile(dialog: DialogContext, opts: { existing: string[] }): Promise<Result | null> {
  return new Promise(resolve => {
    const done = (r: Result | null) => { dialog.clear(); resolve(r) }
    dialog.replace(<Form existing={opts.existing} done={done} />)
  })
}

const Form = ({ existing, done }: { existing: string[]; done: (r: Result | null) => void }) => {
  const theme = useTheme().theme
  const [name, setName] = useState("")
  const [cloneIdx, setCloneIdx] = useState(0)
  const [alias, setAlias] = useState(true)
  const [field, setField] = useState<Field>("name")
  const options = ["(fresh)", ...existing]
  const err = name ? validateName(name, existing) : null
  const valid = !!name && !err

  const submit = () => {
    if (!valid) return
    done({ name, cloneFrom: cloneIdx === 0 ? null : options[cloneIdx], alias })
  }

  const moveField = (dir: 1 | -1) => {
    const i = ORDER.indexOf(field)
    setField(ORDER[(i + dir + ORDER.length) % ORDER.length])
  }

  useKeyboard((key) => {
    if (key.name === "escape") return done(null)
    if (key.name === "tab") return moveField(key.shift ? -1 : 1)
    if (key.name === "return") return submit()
    if (field === "name") {
      if (key.name === "backspace") return setName(n => n.slice(0, -1))
      if (key.raw && key.raw.length === 1 && /[a-z0-9_-]/.test(key.raw))
        return setName(n => n + key.raw)
      return
    }
    if (field === "clone") {
      if (key.name === "up") return setCloneIdx(i => Math.max(0, i - 1))
      if (key.name === "down") return setCloneIdx(i => Math.min(options.length - 1, i + 1))
      return
    }
    if (field === "alias") {
      if (key.name === "space" || key.name === " ") return setAlias(a => !a)
    }
  })

  const focusBg = (f: Field) => field === f ? theme.backgroundElement : undefined

  return (
    <box flexDirection="column" width={54}>
      <box height={1}><text fg={theme.primary}><strong>New Profile</strong></text></box>
      <box height={1} />
      <box height={1} flexDirection="row" backgroundColor={focusBg("name")}>
        <box width={11}><text fg={theme.textMuted}>Name</text></box>
        <text>
          <span fg={valid || !name ? theme.text : theme.error}>{name}</span>
          {field === "name" ? <span fg={theme.accent}>█</span> : null}
        </text>
      </box>
      <box height={1}><text fg={theme.textMuted}>  a-z 0-9 _ -  ·  lowercase</text></box>
      <box height={1} />
      <box height={1} backgroundColor={focusBg("clone")}>
        <text fg={theme.textMuted}>Clone from  (↑↓)</text>
      </box>
      {options.map((o, i) => (
        <box key={o} height={1} backgroundColor={focusBg("clone")}>
          <text fg={i === cloneIdx ? theme.accent : theme.text}>
            {i === cloneIdx ? "▸ " : "  "}{o}
          </text>
        </box>
      ))}
      <box height={1} />
      <box height={1} flexDirection="row" backgroundColor={focusBg("alias")}>
        <box width={11}><text fg={theme.textMuted}>Alias</text></box>
        <text fg={alias ? theme.accent : theme.textMuted}>
          {alias ? "[x] shell alias" : "[ ] shell alias"}
        </text>
      </box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {valid ? "Enter create  ·  Tab next field  ·  Space toggle  ·  Esc cancel" : err ?? "type a name"}
      </text></box>
    </box>
  )
}
