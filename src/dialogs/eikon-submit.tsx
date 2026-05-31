import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import * as svc from "../service/eikon-submit"
import type { SubmitResult } from "eikon"

const FIELDS = ["license", "provenance"] as const
type Field = typeof FIELDS[number]

type Props = {
  name: string
  path: string
  submitReview: svc.SubmitReview
  done: () => void
}

export function openEikonSubmit(dialog: DialogContext, opts: Omit<Props, "done">) {
  return new Promise<void>(resolve => {
    dialog.replace(
      <Form {...opts} done={() => { dialog.clear(); resolve() }} />,
      () => resolve(),
    )
  })
}

const Form = (props: Props) => {
  const theme = useTheme().theme
  const [license, setLicense] = useState("")
  const [provenance, setProvenance] = useState("")
  const [field, setField] = useState<Field>("license")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>("")
  const [result, setResult] = useState<SubmitResult | null>(null)

  const input = { path: props.path, license, provenance }
  const submit = async () => {
    if (busy) return
    if (!license.trim()) { setField("license"); setStatus("license required"); return }
    if (!provenance.trim()) { setField("provenance"); setStatus("provenance required"); return }
    setBusy(true)
    setStatus("Submitting…")
    const next = await props.submitReview(input)
    setResult(next)
    setBusy(false)
    if (next.kind === "review-created") setStatus(`Submitted for review: ${next.url}`)
    else if (next.kind === "setup-needed") setStatus(`Setup needed: ${svc.failureText(next.failures)}`)
    else setStatus(`Submit failed: ${svc.failureText(next.failures)}`)
  }

  useKeyboard(key => {
    if (key.name === "escape") return props.done()
    if (key.name === "tab") {
      const i = FIELDS.indexOf(field)
      return setField(FIELDS[(i + (key.shift ? -1 : 1) + FIELDS.length) % FIELDS.length]!)
    }
    if (key.name === "return") return void submit()
    if (field === "license") {
      if (key.name === "backspace") return setLicense(s => s.slice(0, -1))
      if (key.raw && key.raw.length === 1 && key.raw >= " ") return setLicense(s => s + key.raw)
      return
    }
    if (key.name === "backspace") return setProvenance(s => s.slice(0, -1))
    if (key.raw && key.raw.length === 1 && key.raw >= " ") return setProvenance(s => s + key.raw)
  })

  const bg = (f: Field) => field === f ? theme.backgroundElement : undefined
  return (
    <box flexDirection="column" width={72}>
      <box height={1}><text fg={theme.primary}><strong>Submit eikon</strong></text></box>
      <box height={1}><text fg={theme.textMuted}>{props.name} · submit-for-review</text></box>
      <box height={1} />
      <box height={1} flexDirection="row" backgroundColor={bg("license")}>
        <box width={12}><text fg={theme.textMuted}>License</text></box>
        <text><span fg={theme.text}>{license}</span>{field === "license" ? <span fg={theme.accent}>█</span> : null}</text>
      </box>
      <box height={1} flexDirection="row" backgroundColor={bg("provenance")}>
        <box width={12}><text fg={theme.textMuted}>Provenance</text></box>
        <text><span fg={theme.text}>{provenance}</span>{field === "provenance" ? <span fg={theme.accent}>█</span> : null}</text>
      </box>
      <box height={1} />
      <text fg={theme.textMuted}>Included files are previewed by eikon preflight; hidden, secret, escape, and symlink paths are excluded or blocked.</text>
      <box height={1} />
      <text fg={status.startsWith("Submit failed") ? theme.error : status.startsWith("Setup") ? theme.warning : theme.textMuted} wrapMode="word">
        {status || "Enter submit  ·  Tab next field  ·  Esc cancel"}
      </text>
      {result?.kind === "review-created" ? <text fg={theme.accent}>{result.url}</text> : null}
    </box>
  )
}
