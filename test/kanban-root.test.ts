// gh#28 — kanban paths must collapse …/profiles/<name> to the shared
// Hermes root so the TUI sees the same boards `hermes kanban` does.
// Mirrors upstream hermes_cli/kanban_db.py::kanban_home() resolution.

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { setHome } from "../src/service/hermes-home"
import { kanbanRoot, resetKanban } from "../src/service/hermes-kanban"

const HH = process.env.HERMES_HOME!   // preload.ts sandboxes this

describe("kanbanRoot (gh#28)", () => {
  let pin: string | undefined
  beforeEach(() => { pin = process.env.HERMES_KANBAN_HOME; delete process.env.HERMES_KANBAN_HOME })
  afterEach(() => {
    if (pin === undefined) delete process.env.HERMES_KANBAN_HOME
    else process.env.HERMES_KANBAN_HOME = pin
    setHome(HH); resetKanban()
  })

  test("HERMES_HOME at root → root", () => {
    setHome("/h/.hermes")
    expect(kanbanRoot()).toBe("/h/.hermes")
  })

  test("HERMES_HOME inside profiles/<name> collapses to parent root", () => {
    setHome("/h/.hermes/profiles/ops-manager")
    expect(kanbanRoot()).toBe("/h/.hermes")
  })

  test("trailing slashes trimmed before collapse", () => {
    setHome("/h/.hermes/profiles/home-assistant///")
    expect(kanbanRoot()).toBe("/h/.hermes")
  })

  test("HERMES_KANBAN_HOME override wins over profile collapse", () => {
    setHome("/h/.hermes/profiles/ops-manager")
    process.env.HERMES_KANBAN_HOME = "/pinned/kanban/"
    expect(kanbanRoot()).toBe("/pinned/kanban")
  })

  test("non-'profiles' penultimate segment is left alone", () => {
    setHome("/srv/profiles-data/hermes")
    expect(kanbanRoot()).toBe("/srv/profiles-data/hermes")
    setHome("/h/.hermes/profiles")   // 'profiles' is the leaf, not the parent
    expect(kanbanRoot()).toBe("/h/.hermes/profiles")
  })
})
