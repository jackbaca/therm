// Hermes tool name → one-line presentation. Data only — rendering
// lives in the dispatch switch. Covers the tool vocabulary the
// gateway emits (see hermes-agent model_tools + agent/display.py
// primary_args for the WHAT); icon glyphs follow oc's single-char
// convention (no emoji).

export type Spec = {
  icon: string
  /** Verb shown before the preview string on the collapsed row. */
  verb: string
  /** Gerund shown while status == running and no preview yet. */
  pending: string
}

const SPEC: Record<string, Spec> = {
  terminal:         { icon: "$", verb: "",         pending: "Writing command…" },
  process:          { icon: "⊚", verb: "Process",  pending: "Managing process…" },
  execute_code:     { icon: "»", verb: "Exec",     pending: "Writing script…" },

  read_file:        { icon: "→", verb: "Read",     pending: "Reading file…" },
  write_file:       { icon: "←", verb: "Write",    pending: "Preparing write…" },
  patch:            { icon: "←", verb: "Edit",     pending: "Preparing edit…" },

  search_files:     { icon: "✱", verb: "Search",   pending: "Searching…" },
  web_search:       { icon: "◈", verb: "Web",      pending: "Searching web…" },
  web_extract:      { icon: "%", verb: "Fetch",    pending: "Fetching page…" },
  session_search:   { icon: "↺", verb: "Recall",   pending: "Searching memory…" },

  browser_navigate: { icon: "%", verb: "Navigate", pending: "Navigating…" },
  browser_click:    { icon: "·", verb: "Click",    pending: "Clicking…" },
  browser_type:     { icon: "⌨", verb: "Type",     pending: "Typing…" },
  browser_snapshot: { icon: "⎙", verb: "Snapshot", pending: "Capturing…" },
  browser_vision:   { icon: "◉", verb: "Vision",   pending: "Looking…" },
  vision_analyze:   { icon: "◉", verb: "Vision",   pending: "Analyzing image…" },

  todo:             { icon: "☰", verb: "Todo",     pending: "Updating todos…" },
  memory:           { icon: "⚑", verb: "Memory",   pending: "Updating memory…" },
  clarify:          { icon: "?", verb: "Ask",      pending: "Asking…" },

  skill_view:       { icon: "◆", verb: "Skill",    pending: "Loading skill…" },
  skills_list:      { icon: "◆", verb: "Skills",   pending: "Listing skills…" },
  skill_manage:     { icon: "◆", verb: "Skill",    pending: "Managing skill…" },

  delegate_task:    { icon: "⊙", verb: "Delegate", pending: "Spawning agent…" },
  cronjob:          { icon: "◷", verb: "Cron",     pending: "Managing cron…" },
  text_to_speech:   { icon: "♪", verb: "TTS",      pending: "Synthesizing…" },
  image_generate:   { icon: "✦", verb: "Image",    pending: "Generating image…" },
  video_generate:   { icon: "✦", verb: "Video",    pending: "Generating video…" },
}

const GENERIC: Spec = { icon: "⚙", verb: "", pending: "Running…" }

export function spec(name: string): Spec {
  if (name.startsWith("subagent")) return { icon: "⊙", verb: "Subagent", pending: "Running…" }
  if (name.startsWith("mcp__") || name.startsWith("mcp:")) return { icon: "◇", verb: "MCP", pending: "Calling…" }
  return SPEC[name] ?? GENERIC
}

