import { useState, memo } from "react"
import type { MemoryProviderInfo, MemoryFileInfo } from "../service/hermes-home"
import type { MemoryActivity } from "../service/memory-activity"
import { useHome, home } from "../home"
import { ago } from "../ui/fmt"
import { useTheme, type Theme } from "../theme"
import { useListKeys } from "../keys"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useGateway } from "../context/gateway"
import { openConfirm } from "../dialogs/confirm"
import { TabShell } from "../ui/shell"
import { HintBar } from "../ui/hint"
import { KVBlock } from "../ui/kv"

import type { RGBA } from "@opentui/core"

function usageColor(pct: number, theme: Theme): RGBA {
  if (pct >= 95) return theme.error
  if (pct >= 80) return theme.warning
  return theme.success
}

function bar(pct: number, w: number): string {
  const filled = Math.round((pct / 100) * w)
  return "█".repeat(filled) + "░".repeat(w - filled)
}

const DESC: Record<string, string> = {
  builtin: "File-based §-delimited entries (MEMORY.md + USER.md). Always active.",
  mem0: "Server-side LLM fact extraction with semantic search and reranking.",
  honcho: "AI-native cross-session user modeling with dialectic Q&A.",
  hindsight: "Knowledge graph with entity resolution and multi-strategy retrieval.",
  holographic: "Local SQLite fact store with FTS5, trust scoring, HRR retrieval.",
  openviking: "Session-managed memory with tiered retrieval.",
  retaindb: "Cloud memory API with hybrid search and 7 memory types.",
  byterover: "Persistent knowledge tree via brv CLI.",
  supermemory: "Semantic long-term memory with profile recall and session ingest.",
}

export const Memory = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const toast = useToast()
  const gw = useGateway()
  const [sel, setSel] = useState(0)

  const config = useHome("config")
  const memory = useHome("memory")
  const userProfile = useHome("userProfile")
  const providers = useHome("memoryProviders") ?? []
  const activity = useHome("memoryActivity") ?? []

  const cfg = config?.memory
  const active = cfg?.provider || ""

  const cur = providers[sel]
  const on = !!cur && (cur.name === "builtin" || cur.name === active)

  // Activate/deactivate writes memory.provider to disk via cli.exec
  // (the gateway's config.set whitelist doesn't include it, so the RPC
  // path 4002s). Applies on the next session — the running agent keeps
  // the provider it was constructed with.
  const toggle = async () => {
    if (!cur || cur.name === "builtin") return
    const isOn = cur.name === active
    const ok = await openConfirm(dialog, {
      title: isOn ? "Deactivate memory provider?" : "Activate memory provider?",
      body: isOn
        ? `Clear '${cur.name}' as the active provider (revert to built-in only).`
        : `Set '${cur.name}' as the active provider. Ensure required env vars are set (Env tab).`,
      yes: isOn ? "deactivate" : "activate",
    })
    if (!ok) return
    const { writeConfig } = await import("../config/lane")
    const r = await writeConfig(gw, [{ key: "memory.provider", to: isOn ? "" : cur.name }])
    if (r.failed.length) return toast.show({ variant: "error", message: r.failed[0].err })
    home.invalidate("config")
    home.invalidate("memoryProviders")
    toast.show({ variant: "success", message: isOn ? "Deactivated" : `Activated ${cur.name} — new sessions pick this up` })
  }

  const keys = useListKeys({
    active: () => !!props.focused && !dialog.open(),
    count: providers.length, setSel,
    onToggle: toggle,
    onRefresh: () => {
      home.invalidate("memoryProviders")
      home.invalidate("memoryActivity")
      toast.show({ variant: "info", message: "Reloaded", duration: 1000 })
    },
  })

  const feed = !cur ? []
    : cur.name === "builtin" ? activity
    : activity.filter(a => a.provider === cur.name)

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
    <box flexDirection="row" flexGrow={1}>
      <TabShell title="Memory Providers" grow={1}>
        <scrollbox scrollY flexGrow={1}>
          {providers.map((p, i) => {
            const pOn = p.name === "builtin" || p.name === active
            const has = Object.keys(p.config).length > 0
            const dot = pOn ? "●" : has ? "◐" : "○"
            const fg = pOn ? theme.success : has ? theme.warning : theme.textMuted
            const tag = pOn ? "active" : has ? "configured" : ""
            return (
              <box
                key={p.name}
                flexDirection="column"
                marginBottom={1}
                backgroundColor={i === sel ? theme.backgroundElement : undefined}
                onMouseDown={() => setSel(i)}
                onMouseMove={() => setSel(i)}
              >
                <box height={1}>
                  <text>
                    <span fg={fg}>{dot} </span>
                    <span fg={i === sel ? theme.accent : theme.text}>{p.name}</span>
                    {tag ? <span fg={fg}> ({tag})</span> : null}
                  </text>
                </box>
                <box height={1} overflow="hidden" paddingLeft={2}>
                  <text fg={theme.textMuted}>{DESC[p.name] || "—"}</text>
                </box>
              </box>
            )
          })}
        </scrollbox>
      </TabShell>

      <TabShell
        title={cur?.name ?? "Provider"}
        grow={2}
      >
        {cur ? (
          <ProviderDetail provider={cur} active={active} cfg={cfg}
                          memory={memory} userProfile={userProfile} feed={feed} />
        ) : (
          <text fg={theme.textMuted}>Select a provider</text>
        )}
      </TabShell>
    </box>
    <HintBar
      pairs={[
        ["↑↓", "select"],
        [keys.print("list.toggle"), "activate"],
      ]}
      suffix={on ? "● active" : "○ inactive"}
    />
    </box>
  )
})

type MemoryCfg = {
  memory_enabled: boolean
  user_profile_enabled: boolean
  memory_char_limit: number
  user_char_limit: number
  provider: string
  nudge_interval: number
  flush_min_turns: number
}

const ProviderDetail = memo((props: {
  provider: MemoryProviderInfo
  active: string
  cfg: MemoryCfg | undefined
  memory: MemoryFileInfo | null | undefined
  userProfile: MemoryFileInfo | null | undefined
  feed: MemoryActivity[]
}) => {
  const theme = useTheme().theme
  const p = props.provider
  const on = p.name === "builtin" || p.name === props.active

  return (
    <scrollbox scrollY flexGrow={1}>
      <box flexDirection="column">
        <box minHeight={1}>
          <text wrapMode="word" fg={theme.textMuted}>{DESC[p.name] || "Memory provider"}</text>
        </box>
        <box height={1} />

        {p.name === "builtin" ? (
          <box flexDirection="column">
            {props.cfg ? (
              <>
                <KVBlock rows={[
                  ["Notes", props.cfg.memory_enabled ? "enabled" : "disabled",
                    props.cfg.memory_enabled ? theme.success : theme.error],
                  ["Profile", props.cfg.user_profile_enabled ? "enabled" : "disabled",
                    props.cfg.user_profile_enabled ? theme.success : theme.error],
                ]} />
                <box height={1} />
              </>
            ) : null}
            <CapacityBar title="Notes (MEMORY.md)" info={props.memory ?? null} />
            <box height={1} />
            <CapacityBar title="Profile (USER.md)" info={props.userProfile ?? null} />
          </box>
        ) : null}

        {p.name !== "builtin" && on && props.cfg ? (
          <>
            <box height={1}><text fg={theme.accent}><strong>Agent Settings</strong></text></box>
            <KVBlock rows={[
              ["Nudge", `every ${props.cfg.nudge_interval} turns`],
              ["Flush", `after ${props.cfg.flush_min_turns} turns`],
            ]} />
            <box height={1} />
          </>
        ) : null}

        {Object.keys(p.config).length > 0 ? (
          <>
            <box height={1}><text fg={theme.accent}><strong>Local Configuration</strong></text></box>
            <KVBlock rows={Object.entries(p.config).map(([k, v]) => [k, String(v)] as [string, string])} />
          </>
        ) : p.name !== "builtin" ? (
          <box height={1} marginTop={1}>
            <text fg={theme.textMuted}>No local config found. Run `hermes memory setup` to configure.</text>
          </box>
        ) : null}

        <ActivityFeed items={props.feed} own={p.name} />
      </box>
    </scrollbox>
  )
})

const OP_GLYPH = { write: "+", read: "?" } as const

const ActivityFeed = memo((props: { items: MemoryActivity[]; own: string }) => {
  const theme = useTheme().theme
  const all = props.own === "builtin"
  const nW = props.items.filter(a => a.op === "write").length
  return (
    <box flexDirection="column" marginTop={1}>
      <box height={1}>
        <text>
          <span fg={theme.accent}><strong>Recent Activity</strong></span>
          {props.items.length
            ? <span fg={theme.textMuted}> · {nW} writes, {props.items.length - nW} reads</span>
            : null}
        </text>
      </box>
      {props.items.length === 0 ? (
        <box height={1}>
          <text fg={theme.textMuted}>No memory-tool calls in the last ~2000 messages</text>
        </box>
      ) : null}
      {props.items.map((a, i) => (
        <box key={i} height={1} flexDirection="row" overflow="hidden">
          <text>
            <span fg={a.op === "write" ? theme.success : theme.textMuted}>{OP_GLYPH[a.op]} </span>
            <span fg={theme.textMuted}>{ago(a.ts).padEnd(8)}</span>
            {all && a.provider !== "builtin"
              ? <span fg={theme.primary}>{a.provider}·</span>
              : null}
            <span fg={theme.text}>{a.verb}</span>
            <span fg={theme.textMuted}>  {a.summary}</span>
          </text>
        </box>
      ))}
    </box>
  )
})

const CapacityBar = memo((props: { title: string; info: MemoryFileInfo | null }) => {
  const theme = useTheme().theme
  if (!props.info) {
    return <box height={1}><text fg={theme.textMuted}>{props.title}: unavailable</text></box>
  }
  const color = usageColor(props.info.usagePercent, theme)
  return (
    <box flexDirection="column">
      <box height={1}>
        <text>
          <span fg={theme.text}>{props.title}</span>
          <span fg={theme.textMuted}> · {props.info.entryCount} entries</span>
        </text>
      </box>
      <box height={1}>
        <text>
          <span fg={color}>{bar(props.info.usagePercent, 20)}</span>
          <span fg={theme.textMuted}> {props.info.charCount}/{props.info.charLimit} ({props.info.usagePercent}%)</span>
        </text>
      </box>
    </box>
  )
})
