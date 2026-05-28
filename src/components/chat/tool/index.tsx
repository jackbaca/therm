// Per-tool dispatch — oc's `<Switch>` over part.tool. Each hermes
// tool name maps to either an InlineTool row or a BlockTool card.
//
// Gateway rows stay compact by default: context/summary/inline_diff
// feed the one-line row, while redacted verbose args/results render
// only when the existing detail mode is expanded.

import { memo } from "react"
import type { ToolPart as Part } from "../../../types/message"
import type { DetailMode } from "../../../context/preferences"
import { InlineTool, type Detail } from "./frame"
import { Subagent } from "./Subagent"
import { spec } from "./preview"

function short(s: string | undefined, n = 120): string {
  if (!s) return ""
  const one = s.replace(/\s+/g, " ").trim()
  return one.length > n ? one.slice(0, n - 1) + "…" : one
}

const Inline = memo(({ tool }: { tool: Part }) => {
  const s = spec(tool.name)
  const body = tool.preview ? short(tool.preview) : ""
  return (
    <InlineTool part={tool} complete={!!body || tool.status !== "running"}>
      {s.verb ? `${s.verb} ${body}` : body || tool.name}
    </InlineTool>
  )
})

export const Tool = memo(({ tool, detail = "expanded" }: { tool: Part; detail?: DetailMode }) => {
  if (detail === "hidden" && tool.status !== "running") return null
  if (tool.trail || tool.name === "delegate_task") return <Subagent tool={tool} />
  if (detail !== "expanded") return <Inline tool={tool} />
  const details = [
    tool.verboseArgs ? { label: "Args", text: tool.verboseArgs } : undefined,
    tool.verboseResult ? { label: tool.status === "error" ? "Error" : "Result", text: tool.verboseResult } : undefined,
  ].filter((d): d is Detail => !!d)
  const s = spec(tool.name)
  const body = tool.preview ? short(tool.preview) : ""
  return (
    <InlineTool part={tool} complete={!!body || tool.status !== "running"} details={details}>
      {s.verb ? `${s.verb} ${body}` : body || tool.name}
    </InlineTool>
  )
})
