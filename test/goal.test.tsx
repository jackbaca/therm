import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { act } from "react"
import { useEffect } from "react"
import { Database } from "bun:sqlite"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { mount, mountNode, until, MockGateway } from "./harness"
import { openCountdown } from "../src/dialogs/countdown"
import { useDialog } from "../src/ui/dialog"
import { goalState, resetDb } from "../src/utils/sessions-db"

// ─── goalState reader ────────────────────────────────────────────────

describe("sessions-db.goalState", () => {
  const HH = process.env.HERMES_HOME!

  beforeAll(() => {
    mkdirSync(HH, { recursive: true })
    const db = new Database(join(HH, "state.db"))
    db.run("CREATE TABLE IF NOT EXISTS state_meta (key TEXT PRIMARY KEY, value TEXT)")
    db.run("INSERT OR REPLACE INTO state_meta VALUES (?, ?)", [
      "goal:sid-done",
      JSON.stringify({ goal: "ship it", status: "done", turn_count: 3, max_turns: null }),
    ])
    db.run("INSERT OR REPLACE INTO state_meta VALUES (?, ?)", [
      "goal:sid-active", JSON.stringify({ goal: "wip", status: "active" }),
    ])
    db.close()
    resetDb() // drop any cached handle so q() reopens against the now-seeded file
  })

  // The fixture db has state_meta only — enough for goalState() but
  // not for roots()/lastReal() (COLS references messages). Drop it
  // before the /goal routing block below does full mount()s, so
  // stateDb() returns null and the readers short-circuit to [].
  afterAll(() => {
    resetDb()
    rmSync(join(HH, "state.db"), { force: true })
  })

  test("parses done + active; null on missing", () => {
    const d = goalState("sid-done")
    expect(d?.status).toBe("done")
    expect(d?.goal).toBe("ship it")
    expect(d?.turn_count).toBe(3)
    expect(goalState("sid-active")?.status).toBe("active")
    expect(goalState("nope")).toBeNull()
  })
})

// ─── countdown dialog ────────────────────────────────────────────────

const Host = (p: { seconds: number; out: { v?: boolean } }) => {
  const dialog = useDialog()
  useEffect(() => {
    void openCountdown(dialog, {
      title: "Goal complete — suspending",
      body: "ship it",
      action: "→ systemctl suspend",
      seconds: p.seconds,
    }).then(ok => { p.out.v = ok })
  }, [])
  return null
}

describe("countdown dialog", () => {
  test("seconds=0 fires immediately", async () => {
    const out: { v?: boolean } = {}
    const t = await mountNode(<Host seconds={0} out={out} />)
    await until(t, () => out.v !== undefined)
    expect(out.v).toBe(true)
    t.destroy()
  })

  test("any key cancels before fire", async () => {
    const out: { v?: boolean } = {}
    const t = await mountNode(<Host seconds={10} out={out} />)
    await until(t, () => t.frame().includes("systemctl suspend"))
    expect(t.frame()).toContain("10s")
    expect(t.frame()).toContain("press any key to cancel")
    await act(async () => { await t.keys.typeText("x") })
    await until(t, () => out.v !== undefined)
    expect(out.v).toBe(false)
    t.destroy()
  })
})

// ─── /goal slash → command.dispatch path ─────────────────────────────
// Stock tui_gateway rejects /goal from slash.exec (it's a
// _PENDING_INPUT_COMMANDS entry — the slash-worker CLI has no input
// loop to kick off with) and handles it in command.dispatch instead,
// where it drives GoalManager directly and returns {type:"send",
// notice, message: goal}. herm must route it as target=gateway so the
// generic slash.exec-catch → command.dispatch fallback fires.

describe("/goal slash routing", () => {
  test("slash.exec reject → command.dispatch; notice + kickoff prompt", async () => {
    const slashes: string[] = []
    const dispatches: Array<{ name: string; arg: string }> = []
    const submits: string[] = []
    const gw = new MockGateway({
      "slash.exec": (p) => {
        slashes.push(String(p.command))
        throw new Error("pending-input command: use command.dispatch for /goal")
      },
      "command.dispatch": (p) => {
        dispatches.push({ name: String(p.name), arg: String(p.arg ?? "") })
        return p.arg
          ? { type: "send", notice: "⊙ Goal set (20-turn budget): x", message: String(p.arg) }
          : { type: "exec", output: "No active goal." }
      },
      "prompt.submit": (p) => { submits.push(String(p.text)); return {} },
    })
    const t = await mount({ gw, width: 140, height: 30 })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/goal ship it") })
    act(() => t.keys.pressEnter())
    await until(t, () => submits.length === 1)

    expect(slashes[0]).toBe("/goal ship it")
    expect(dispatches[0]).toEqual({ name: "goal", arg: "ship it" })
    expect(submits[0]).toBe("ship it")
    // notice rendered as a system line before the kickoff.
    expect(t.frame()).toContain("⊙ Goal set")
    t.destroy()
  })

  test("verbs → {type: exec, output}; no prompt.submit", async () => {
    const submits: string[] = []
    const gw = new MockGateway({
      "slash.exec": () => { throw new Error("pending-input command") },
      "command.dispatch": () => ({ type: "exec", output: "⏸ Goal paused: x" }),
      "prompt.submit": (p) => { submits.push(String(p.text)); return {} },
    })
    const t = await mount({ gw, width: 140, height: 30 })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/goal pause") })
    // First Enter accepts the subcommand-popover completion ("/goal
    // pause "); second dispatches.
    act(() => t.keys.pressEnter()); await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("⏸ Goal paused"))
    expect(submits.length).toBe(0)
    t.destroy()
  })
})
