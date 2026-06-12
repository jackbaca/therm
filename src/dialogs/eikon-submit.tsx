import { useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import { FileLink } from "../components/ui/FileLink"
import { openUrl } from "../utils/open-file"
import * as svc from "../service/eikon-submit"
import type { SubmitResult } from "../service/eikon-submit"

type Props = {
  name: string
  path: string
  submit: svc.Submit
  done: () => void
}

type Field = keyof svc.SubmitMeta
const FIELDS: Field[] = ["title", "author", "description", "glyph"]

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
  const touched = useRef<Partial<Record<Field, true>>>({})
  const flight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>("")
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [prepared, setPrepared] = useState<svc.PreparedSubmit | null>(null)
  const [consent, setConsent] = useState(false)
  const [field, setField] = useState<Field>("title")
  const [meta, setMeta] = useState<svc.SubmitMeta>({
    title: props.name,
    author: "unknown",
    description: "Monochrome terminal avatar.",
    glyph: "◆",
  })

  useEffect(() => {
    let dead = false
    touched.current = {}
    void svc.defaults({ path: props.path }).then(next => {
      if (dead) return
      setMeta(prev => ({
        title: touched.current.title ? prev.title : next.title,
        author: touched.current.author ? prev.author : next.author,
        description: touched.current.description ? prev.description : next.description,
        glyph: touched.current.glyph ? prev.glyph : next.glyph,
      }))
    }).catch(e => setStatus(`Defaults failed: ${svc.redact(e instanceof Error ? e.message : String(e))}`))
    return () => { dead = true }
  }, [props.path])

  const close = () => {
    if (prepared && !status.includes("fallback")) svc.cleanup(prepared)
    props.done()
  }

  const edit = (key: Field, value: string) => {
    touched.current[key] = true
    setMeta(m => ({ ...m, [key]: value }))
    if (prepared) svc.cleanup(prepared)
    setPrepared(null)
    setConsent(false)
    setResult(null)
  }

  const prep = async () => {
    if (flight.current) return
    flight.current = true
    setBusy(true)
    setResult(null)
    try {
      setStatus("Preparing public bundle…")
      if (prepared) svc.cleanup(prepared)
      const next = await svc.prepare({ path: props.path, meta, includeSource: false })
      setPrepared(next)
      setConsent(false)
      setStatus("Review bundle, then press c to consent")
    } catch (e) {
      setStatus(`Submit failed: ${svc.redact(e instanceof Error ? e.message : String(e))}`)
    } finally {
      flight.current = false
      setBusy(false)
    }
  }

  const send = async () => {
    if (flight.current) return
    if (!prepared) return prep()
    if (!consent) {
      setStatus("Press c to consent before publishing")
      return
    }
    flight.current = true
    setBusy(true)
    setResult(null)
    try {
      setStatus("Submitting…")
      const next = await props.submit(prepared)
      setResult(next)
      if (next.kind === "submitted") {
        svc.cleanup(prepared)
        setStatus(`Submitted: ${next.url}`)
      } else if (next.kind === "setup-needed") setStatus(`GitHub setup needed; browser fallback ready: ${svc.failureText(next.failures)}`)
      else setStatus(`Submit failed; browser fallback ready: ${svc.failureText(next.failures)}`)
    } catch (e) {
      setStatus(`Submit failed; browser fallback ready: ${svc.redact(e instanceof Error ? e.message : String(e))}`)
    } finally {
      flight.current = false
      setBusy(false)
    }
  }

  const open = () => {
    if (!prepared) return
    if (!consent) {
      setStatus("Press c to consent before opening browser fallback")
      return
    }
    const ok = openUrl(prepared.url)
    setStatus(ok ? "Opened browser fallback" : `Open failed; copy ${prepared.url}`)
  }

  useKeyboard(key => {
    if (key.name === "escape") return close()
    if (busy) return
    if (key.name === "tab" && !prepared) {
      const i = FIELDS.indexOf(field)
      setField(FIELDS[(i + (key.shift ? FIELDS.length - 1 : 1)) % FIELDS.length]!)
      return
    }
    if (key.name === "c" && prepared) {
      setConsent(v => !v)
      setStatus(!consent ? "Consented to public PR submission" : "Consent cleared")
      return
    }
    if (key.name === "o" && prepared) return open()
    if (key.name === "return") return void send()
  })

  const bad = status.startsWith("Submit failed")
  const warn = status.startsWith("GitHub") || status.includes("fallback") || status.includes("consent")
  return (
    <box flexDirection="column" width={84}>
      <box height={1}><text fg={theme.primary}><strong>Submit eikon</strong></text></box>
      <box height={1}><text fg={theme.textMuted}>{props.name} · official registry PR</text></box>
      <box height={1}><text fg={theme.textMuted}>{svc.targetRepo()}</text></box>
      <box height={1} />
      {!prepared ? <Meta meta={meta} field={field} setField={setField} setMeta={edit} /> : <Preview prepared={prepared} consent={consent} />}
      <box height={1} />
      <text fg={bad ? theme.error : warn ? theme.warning : theme.textMuted} wrapMode="word">
        {status || (prepared ? "c consent  ·  Enter submit  ·  o open browser fallback  ·  Esc cancel" : "Tab field  ·  Enter preview public bundle  ·  Esc cancel")}
      </text>
      {result?.kind === "submitted" ? <text fg={theme.accent}>{result.url}</text> : null}
    </box>
  )
}

function Meta(props: {
  meta: svc.SubmitMeta
  field: Field
  setField: (field: Field) => void
  setMeta: (field: Field, value: string) => void
}) {
  return (
    <box flexDirection="column">
      <text fg="gray">Public metadata</text>
      <Input label="title" value={props.meta.title} on={props.field === "title"} setOn={() => props.setField("title")} set={v => props.setMeta("title", v)} />
      <Input label="author" value={props.meta.author} on={props.field === "author"} setOn={() => props.setField("author")} set={v => props.setMeta("author", v)} />
      <Input label="description" value={props.meta.description} on={props.field === "description"} setOn={() => props.setField("description")} set={v => props.setMeta("description", v)} />
      <Input label="glyph" value={props.meta.glyph} on={props.field === "glyph"} setOn={() => props.setField("glyph")} set={v => props.setMeta("glyph", v)} />
    </box>
  )
}

function Input(props: { label: string; value: string; on: boolean; setOn: () => void; set: (v: string) => void }) {
  const theme = useTheme().theme
  return (
    <box height={1} flexDirection="row" onMouseDown={props.setOn}>
      <box width={13}><text fg={props.on ? theme.primary : theme.textMuted}>{props.on ? "▸ " : "  "}{props.label}</text></box>
      <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
        <input
          value={props.value}
          onInput={props.set}
          focused={props.on}
          textColor={theme.text}
          backgroundColor={theme.backgroundElement}
          focusedBackgroundColor={theme.backgroundElement}
        />
      </box>
    </box>
  )
}

function Preview(props: { prepared: svc.PreparedSubmit; consent: boolean }) {
  const theme = useTheme().theme
  return (
    <box flexDirection="column">
      <text fg={theme.textMuted}>Included files ({props.prepared.files.length}) · {props.prepared.source ? "source included" : "runtime-only"}</text>
      {props.prepared.files.slice(0, 6).map(f => <text key={f.path} fg={theme.text}>• {f.path} · {f.bytes} B</text>)}
      {props.prepared.files.length > 6 ? <text fg={theme.textMuted}>… {props.prepared.files.length - 6} more</text> : null}
      <text fg={theme.textMuted}>Title: {props.prepared.meta.title}</text>
      <text fg={theme.textMuted}>Author: {props.prepared.meta.author}</text>
      <text fg={theme.textMuted} wrapMode="word">Description: {props.prepared.meta.description}</text>
      <text fg={theme.textMuted}>Glyph: {props.prepared.meta.glyph}</text>
      <box height={1} flexDirection="row"><box width={8}><text fg={theme.textMuted}>Bundle:</text></box><FileLink source={props.prepared.bundleSource}>{props.prepared.bundleDir}</FileLink></box>
      <text fg={props.consent ? theme.accent : theme.warning}>{props.consent ? "● public PR consent" : "○ consent required"}</text>
      <text fg={theme.textMuted}>PR title: {props.prepared.title}</text>
      <text fg={theme.textMuted} wrapMode="word">PR body: {props.prepared.body}</text>
      <text fg={theme.textMuted}>Manual steps:</text>
      {props.prepared.steps.map(step => <text key={step} fg={theme.textMuted} wrapMode="word">• {step}</text>)}
      <text fg={theme.textMuted}>Fallback: {props.prepared.url}</text>
    </box>
  )
}
