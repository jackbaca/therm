import { test, expect } from "bun:test"
import { createRef } from "react"
import { act } from "react"
import { mountNode, until } from "./harness"
import { tmpHome } from "./fixture/home"
import { openThemePicker } from "../src/dialogs/theme-picker"
import { useDialog } from "../src/ui/dialog"
import { useTheme } from "../src/theme"

type Handle = { open: () => void; theme: () => string; mode: () => "dark" | "light" }

const Probe = ({ handle }: { handle: React.RefObject<Handle | null> }) => {
  const dialog = useDialog()
  const ctx = useTheme()
  handle.current = {
    open: () => openThemePicker(dialog, ctx),
    theme: () => ctx.name,
    mode: () => ctx.mode,
  }
  return <text>{"probe"}</text>
}

test("theme picker: Tab toggles mode, Esc reverts, Enter keeps it", async () => {
  await using _home = await tmpHome({ prefs: { theme: "tokyonight", themeMode: "dark" } })
  const handle = createRef<Handle>()
  await using t = await mountNode(<Probe handle={handle} />)

  act(() => handle.current!.open())
  await t.settle()

  act(() => t.keys.pressTab())
  await until(t, () => handle.current!.mode() === "light")
  act(() => t.keys.pressEscape())
  await until(t, () => handle.current!.mode() === "dark")
  expect(handle.current!.mode()).toBe("dark")

  act(() => handle.current!.open())
  await t.settle()
  act(() => t.keys.pressTab())
  await until(t, () => handle.current!.mode() === "light")
  act(() => t.keys.pressEnter())
  await t.settle()
  expect(handle.current!.mode()).toBe("light")
})
