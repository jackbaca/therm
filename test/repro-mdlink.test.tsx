// Repro for the Al Jazeera link bug report. Renders the content through
// MessageItem in every relevant path. B/E use a sibling conceal=true
// sentinel to detect async-highlight completion, since conceal={false}
// output is char-identical pre/post highlight and captureCharFrame
// doesn't see SGR. Run:  bun test test/repro-mdlink.test.tsx

import { describe, expect, test } from "bun:test"
import { mountNode, until, type Harness } from "./harness"
import { MessageItem } from "../src/components/chat/MessageItem"
import { useTheme } from "../src/theme"
import type { Message } from "../src/types/message"

const LINE =
  "On May 10, 2026, Iran officially sent its response to the latest " +
  "U.S. ceasefire proposal through Pakistani mediators " +
  "[Al Jazeera](https://www.aljazeera.com/video/newsfeed/2026/5/10/" +
  "iran-sends-response-to-us-ceasefire-proposal-via-pakistan)."

function msg(content: string): Message {
  return {
    id: "a1", role: "assistant", timestamp: 0,
    parts: [{ type: "text", content, streaming: false }],
  }
}

// Sibling <code conceal> so we can observe highlight completion: when
// `**done**` → `done`, the tree-sitter pass for markdown has landed.
function Sentinel() {
  const s = useTheme().syntaxStyle
  return <code content="**done**" filetype="markdown" syntaxStyle={s} conceal wrapMode="none" />
}

async function render(content: string, width = 120, sentinel = false): Promise<Harness> {
  const t = await mountNode(
    <box flexDirection="column" width="100%" height="100%">
      <MessageItem message={msg(content)} streaming={false} />
      {sentinel ? <box marginTop={1}><Sentinel /></box> : null}
    </box>,
    { width, height: 24 },
  )
  await t.settle()
  return t
}

function dump(label: string, t: Harness) {
  console.log(`\n── ${label} ` + "─".repeat(Math.max(0, 76 - label.length)))
  for (const row of t.frame().split("\n"))
    if (row.trim()) console.log(row.replace(/\s+$/, ""))
}

describe("repro: Al Jazeera link", () => {
  // ```-fenced, no info-string. Header shows "text", body via <text> —
  // no tree-sitter, no conceal, no OSC-8. This is what the screenshot
  // actually depicts (header "text", brackets visible). Correct as-is;
  // any hover there is the terminal emulator's own URL detection.
  test("A. bare fence (no lang) — literal via <text>", async () => {
    const t = await render("```\n" + LINE + "\n```")
    await until(t, () => t.frame().includes("1 ln"))
    dump("A. bare fence (no lang)", t)
    const f = t.frame()
    expect(f).toContain("text")
    expect(f).toContain("[Al Jazeera](https://www.aljazeera.com")
    t.destroy()
  })

  // ```md / ```markdown → CodeBlock with filetype="markdown". Wait on
  // the sibling sentinel (`**done**` → `done`) to know highlighting ran,
  // then assert the CodeBlock body stayed byte-literal.
  for (const lang of ["md", "markdown"] as const) {
    test(`B. ${lang} fence — verbatim via <code conceal={false}>`, async () => {
      const t = await render("```" + lang + "\n" + LINE + "\n```", 260, true)
      await until(t, () => t.frame().includes("done") && !t.frame().includes("**done**"), 4000)
      dump(`B. ${lang} fence`, t)
      const f = t.frame()
      expect(f).toContain("[Al Jazeera](https://www.aljazeera.com")
      t.destroy()
    })
  }

  // Raw prose → <markdown>. sanitizeLinks leaves this link intact
  // (https: is openable). Renderable conceals `[`→"" and `]`→" ", keeps
  // `(url)` visible, tagged @markup.link.url → OSC-8 applied.
  test("C. prose — <markdown> conceals brackets, keeps (url)", async () => {
    const t = await render(LINE)
    await until(t, () => t.frame().includes("Al Jazeera"), 4000)
    await until(t, () => !t.frame().includes("[Al Jazeera]"), 4000)
    dump("C. prose (markdown renderable)", t)
    const f = t.frame()
    expect(f).toContain("Al Jazeera (https://www.aljazeera.com")
    expect(f).not.toContain("[Al Jazeera]")
    t.destroy()
  })

  // Prose with NON-openable dest. sanitizeLinks inserts a space so
  // tree-sitter never produces inline_link → no OSC-8 href=#install.
  // captureCharFrame can't see link attrs, so this test asserts visual
  // parity (sanitizer output renders same as unsanitized would have) and
  // no backslash artifact from the old `\(` approach. OSC-8 suppression
  // itself is unit-tested in sanitize-md.test.ts.
  test("D. prose with #anchor dest — sanitizer visual parity", async () => {
    const t = await render("jump to [section 3](#install) for setup")
    await until(t, () => t.frame().includes("section 3"), 4000)
    await until(t, () => !t.frame().includes("[section 3]"), 4000)
    dump("D. prose (#anchor, sanitized)", t)
    const f = t.frame()
    expect(f).toContain("section 3 (#install)")
    expect(f).not.toContain("\\")
    t.destroy()
  })
})
