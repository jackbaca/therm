// Per-tool dispatch — oc's `<Switch>` over part.tool. Each hermes
// tool name maps to either an InlineTool row or a BlockTool card.
//
// Data constraint: the stock tui_gateway emits only
//   tool.start    {name, context: build_tool_preview() string ≤80ch}
//   tool.complete {summary, inline_diff?, error?, duration_s}
// — NOT the raw args JSON or the tool result body. So per-tool
// *bodies* (bash stdout, todo checklist, grep matches) are blocked
// on the wire carrying more (→ docs/UPSTREAM.md). The dispatch and
// frame grammar here are ready for them.

import { memo } from "react"
import type { ToolPart as Part } from "../../../types/message"
import type { DetailMode } from "../../../context/preferences"
import { InlineTool } from "./frame"
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
  return <Inline tool={tool} />
})
