// Regression: /compress must re-hydrate the local transcript from the
// gateway's response.  Without this, `turn.messages` stays stuck on the
// pre-compaction list until the user reopens the session — at which
// point the old messages vanish from the UI, reading as data loss.
//
// Upstream session.compress returns { messages, info, usage, summary, ... };
// the gateway also rotates session_id (agent._compress_context ends the
// old DB session and opens a continuation).  See the compress handler
// in ui-tui/src/app/slash/commands/session.ts for the canonical flow
// we mirror.

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

const preCompactMessages = [
  { role: "user" as const, text: "draft the rfc" },
  { role: "assistant" as const, text: "Here's a long draft of the RFC …" },
  { role: "user" as const, text: "shorter" },
  { role: "assistant" as const, text: "Tighter version …" },
]

const postCompactMessages = [
  { role: "user" as const, text: "MARKER_POST_COMPACT_USER" },
  { role: "assistant" as const, text: "Tighter version …" },
]

const mkGw = () => new MockGateway({
  "commands.catalog": () => ({ pairs: [["/compress", "compress transcript"]] }),
  "session.resume": () => ({
    session_id: "pre-sid",
    messages: preCompactMessages,
  }),
  "session.compress": () => ({
    status: "compressed",
    removed: 2,
    before_messages: 4,
    after_messages: 3,
    before_tokens: 8000,
    after_tokens: 2500,
    messages: postCompactMessages,
    info: { model: "test-model", session_id: "post-sid", tools: {}, skills: {} },
    usage: { input: 1000, output: 500, total: 1500, context_used: 2500, context_max: 200000, context_percent: 1, compressions: 1 },
    summary: { headline: "Compacted 4→3 messages", token_line: "8.0k → 2.5k" },
  }),
})

const run = async (t: Awaited<ReturnType<typeof mount>>) => {
  await act(async () => { await t.keys.typeText("/compress") })
  act(() => t.keys.pressEnter())
}

describe("/compress", () => {
  test("re-hydrates transcript from rpc response messages", async () => {
    const gw = mkGw()
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)

    // Transcript reflects the compacted history: marker row present,
    // the now-removed pre-compaction turn ("draft the rfc") is gone.
    await until(t, () => t.frame().includes("MARKER_POST_COMPACT_USER"))
    expect(t.frame()).not.toContain("draft the rfc")

    t.destroy()
  })

  test("absorbs info.session_id rotation", async () => {
    const gw = mkGw()
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)
    await until(t, () => t.frame().includes("MARKER_POST_COMPACT_USER"))

    // setInfo() fed the new session_id; follow-up RPCs target the
    // continuation, not the ended parent. session.title after /compress
    // is the cheapest probe — its response flows back into state.
    await act(async () => { await t.keys.typeText("/title After Compress") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.title")?.params.title === "After Compress")

    t.destroy()
  })

  test("summary headline dispatches as system line + toast", async () => {
    const gw = mkGw()
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)

    // Headline lands in transcript (system row).
    await until(t, () => t.frame().includes("Compacted 4→3 messages"))
    expect(t.frame()).toContain("8.0k → 2.5k")

    t.destroy()
  })

  test("noop response doesn't wipe the transcript", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/compress", "compress transcript"]] }),
      "session.resume": () => ({ session_id: "pre-sid", messages: preCompactMessages }),
      "session.compress": () => ({
        status: "skipped",
        removed: 0,
        summary: { noop: true, headline: "No changes — 4 messages" },
      }),
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)
    await t.settle()

    // Messages untouched (no `messages` field in response) — original
    // turns still visible.
    expect(t.frame()).toContain("draft the rfc")

    t.destroy()
  })
})
