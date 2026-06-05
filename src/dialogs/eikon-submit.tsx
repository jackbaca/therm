import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import * as svc from "../service/eikon-submit"
import type { SubmitResult } from "eikon"

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
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>("")
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [preview, setPreview] = useState<svc.SubmitPreview | null>(null)

  const input = { path: props.path }
  const submit = async () => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      if (!preview) {
        setStatus("Previewing files…")
        const next = await svc.preview(input)
        setPreview(next)
        setStatus("Review included files, then Enter to submit")
        return
      }
      setStatus("Submitting…")
      const next = await props.submitReview(input)
      setResult(next)
      if (next.kind === "review-created") setStatus(`Submitted for review: ${next.url}`)
      else if (next.kind === "setup-needed") setStatus(`Setup needed: ${svc.failureText(next.failures)}`)
      else setStatus(`Submit failed: ${svc.failureText(next.failures)}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Submit failed: ${svc.redact(msg)}`)
    } finally {
      setBusy(false)
    }
  }

  useKeyboard(key => {
    if (key.name === "escape") return props.done()
    if (key.name === "return") return void submit()
  })

  return (
    <box flexDirection="column" width={72}>
      <box height={1}><text fg={theme.primary}><strong>Submit eikon</strong></text></box>
      <box height={1}><text fg={theme.textMuted}>{props.name} · submit-for-review</text></box>
      <box height={1}><text fg={theme.textMuted}>{props.path}</text></box>
      <box height={1} />
      {preview ? (
        <box flexDirection="column">
          <text fg={theme.textMuted}>Included files ({preview.files.length})</text>
          {preview.files.slice(0, 8).map(f => (
            <text key={f.path} fg={theme.text}>• {f.path} · {f.bytes} B</text>
          ))}
          {preview.files.length > 8 ? <text fg={theme.textMuted}>… {preview.files.length - 8} more</text> : null}
        </box>
      ) : <text fg={theme.textMuted}>Enter previews the exact review bundle before submission.</text>}
      <box height={1} />
      <text fg={status.startsWith("Submit failed") ? theme.error : status.startsWith("Setup") ? theme.warning : theme.textMuted} wrapMode="word">
        {status || (preview ? "Enter submit  ·  Esc cancel" : "Enter preview  ·  Esc cancel")}
      </text>
      {result?.kind === "review-created" ? <text fg={theme.accent}>{result.url}</text> : null}
    </box>
  )
}
