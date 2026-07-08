import { describe, expect, test } from "bun:test"
import { model } from "../src/app/verification"
import type { VerificationStatus, VerificationState } from "../src/context/wire"

const statuses: VerificationStatus[] = ["not_applicable", "passed", "failed", "stale"]

describe("verification render model", () => {
  test("maps every upstream status distinctly", () => {
    const rows = statuses.map(status => model({ status, evidence: `${status} evidence` }))

    expect(rows.map(r => r?.status)).toEqual(statuses)
    expect(new Set(rows.map(r => r?.glyph)).size).toBe(statuses.length)
    expect(new Set(rows.map(r => r?.label)).size).toBe(statuses.length)
    expect(rows.map(r => r?.detail)).toEqual(statuses.map(status => `${status} evidence`))
    expect(rows.find(r => r?.status === "passed")?.tone).toBe("ok")
    expect(rows.find(r => r?.status === "failed")?.tone).toBe("err")
    expect(rows.find(r => r?.status === "not_applicable")?.tone).toBe("muted")
  })

  test("hides unverified status", () => {
    expect(model({ status: "unverified", evidence: "needs checks" })).toBeNull()
  })

  test("shows stale changed paths before evidence", () => {
    const state: VerificationState = {
      status: "stale",
      evidence: "old pass no longer covers the tree",
      changed_paths: ["src/app.tsx", "src/app/verification.ts", "test/verification.test.ts", "README.md"],
    }

    expect(model(state)?.detail).toBe("changed: src/app.tsx, src/app/verification.ts, test/verification.test.ts +1")
  })

  test("summarizes object evidence", () => {
    const state: VerificationState = {
      status: "passed",
      evidence: {
        command: "bun test",
        status: "passed",
      },
    }

    expect(model(state)?.detail).toBe("command: bun test")
  })

  test("falls back for stale object evidence without changed paths", () => {
    const state: VerificationState = {
      status: "stale",
      evidence: {
        status: "stale",
      },
    }

    expect(model(state)?.detail).toBe("verify stale")
  })
})
