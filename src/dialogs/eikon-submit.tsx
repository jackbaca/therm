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
    setResult(null)
  }

  const prep = async () => {
    if (flight.current) return
    flight.current = true
    setBusy(true)
    setResult(null)
    try {
      setStatus("Running registry preflight…")
      if (prepared) svc.cleanup(prepared)
      const next = await svc.prepare({ path: props.path, meta, includeSource: false })
      setPrepared(next)
      setStatus(`This will create a PR in ${next.target} for review. Press Enter to submit.`)
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
    flight.current = true
    setBusy(true)
    setResult(null)
    try {
      setStatus("Submitting…")
      const next = await props.submit(prepared)
      setResult(next)
      if (next.kind === "submitted") {
        svc.cleanup(prepared)
        setStatus("Your Eikon has been submitted and is being reviewed.")
      } else if (next.kind === "setup-needed") setStatus(`GitHub CLI unavailable. Follow the manual PR instructions below. ${svc.failureText(next.failures)}`)
      else setStatus(`Submit failed. Follow the manual PR instructions below. ${svc.failureText(next.failures)}`)
    } catch (e) {
      setStatus(`Submit failed. Follow the manual PR instructions below. ${svc.redact(e instanceof Error ? e.message : String(e))}`)
    } finally {
      flight.current = false
      setBusy(false)
    }
  }

  const open = () => {
    if (!prepared) return
    const ok = openUrl(prepared.url)
    setStatus(ok ? "Opened GitHub compare page" : `Open failed; copy ${prepared.url}`)
  }

  const move = (by: number) => {
    const i = FIELDS.indexOf(field)
    setField(FIELDS[(i + by + FIELDS.length) % FIELDS.length]!)
  }

  useKeyboard(key => {
    if (key.name === "escape") return close()
    if (busy) return
    if (!prepared && key.name === "up") return move(-1)
    if (!prepared && key.name === "down") return move(1)
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
      {!prepared ? <Meta meta={meta} field={field} setField={setField} setMeta={edit} /> : <Preview prepared={prepared} result={result} />}
      <box height={1} />
      <text fg={bad ? theme.error : warn ? theme.warning : theme.textMuted} wrapMode="word">
        {status || (prepared ? "Enter submit  ·  o open GitHub compare  ·  Esc cancel" : "↑↓ field  ·  Enter continue  ·  Esc cancel")}
      </text>
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

function Preview(props: { prepared: svc.PreparedSubmit; result: SubmitResult | null }) {
  const theme = useTheme().theme
  const manual = props.result?.kind === "setup-needed" || props.result?.kind === "backend-failed"
  return (
    <box flexDirection="column">
      <text fg={theme.textMuted}>Registry preflight</text>
      {props.prepared.lint.map(line => <text key={line} fg={theme.accent}>{line}</text>)}
      <box height={1} />
      <text fg={theme.textMuted}>Package</text>
      <text fg={theme.text}>{props.prepared.files.length} files prepared for registry review</text>
      <box height={1} flexDirection="row"><box width={8}><text fg={theme.textMuted}>Bundle:</text></box><FileLink source={props.prepared.bundleSource}>{props.prepared.bundleDir}</FileLink></box>
      <box height={1} />
      <text fg={theme.textMuted}>Metadata</text>
      <text fg={theme.textMuted}>Title: {props.prepared.meta.title}</text>
      <text fg={theme.textMuted}>Author: {props.prepared.meta.author}</text>
      <text fg={theme.textMuted} wrapMode="word">Description: {props.prepared.meta.description}</text>
      <text fg={theme.textMuted}>Glyph: {props.prepared.meta.glyph}</text>
      {manual ? <box flexDirection="column">
        <box height={1} />
        <text fg={theme.warning}>Manual PR</text>
        {props.prepared.steps.map(step => <text key={step} fg={theme.textMuted} wrapMode="word">• {step}</text>)}
        <text fg={theme.textMuted}>Compare: {props.prepared.url}</text>
      </box> : null}
    </box>
  )
}
