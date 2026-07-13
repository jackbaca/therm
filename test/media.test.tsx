import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { splitContent, classify } from "../src/components/chat/MediaChip"
import { ChafaImage } from "../src/ui/ChafaImage"

describe("media segmentation", () => {
  test("splits protocol lines and markdown images in source order", () => {
    expect(splitContent([
      "before",
      "`MEDIA: /tmp/a.png`",
      "\"MEDIA:/tmp/b.mp3\"",
      "see ![alt](https://x.test/c.png) now",
    ].join("\n"))).toEqual([
      { md: "before" },
      { media: "/tmp/a.png" },
      { media: "/tmp/b.mp3" },
      { md: "see " },
      { media: "https://x.test/c.png" },
      { md: " now" },
    ])
  })

  test("leaves ordinary prose and mid-line MEDIA text as markdown", () => {
    expect(splitContent("plain text\nno directives")).toEqual([
      { md: "plain text\nno directives" },
    ])
    expect(splitContent("see MEDIA:/tmp/x.png here")).toEqual([
      { md: "see MEDIA:/tmp/x.png here" },
    ])
  })

  test("keeps MEDIA examples fenced while recognizing a following directive", () => {
    expect(splitContent("before\n```sh\nMEDIA:/tmp/x.png\n```\nMEDIA:/tmp/y.png\nafter")).toEqual([
      { md: "before" },
      { code: "MEDIA:/tmp/x.png", lang: "sh" },
      { media: "/tmp/y.png" },
      { md: "after" },
    ])
  })

  test("respects fence markers and preserves an unfinished streaming tail", () => {
    expect(splitContent("~~~\nraw\n~~~")).toEqual([
      { code: "raw", lang: undefined },
    ])
    expect(splitContent("````md\n```ts\ninner\n```\n````")).toEqual([
      { code: "```ts\ninner\n```", lang: "md" },
    ])
    expect(splitContent("intro\n```ts\npartial")).toEqual([
      { md: "intro\n```ts\npartial" },
    ])
  })

  test("classifies local media extensions and remote links", () => {
    expect([
      "/tmp/a.png",
      "/tmp/a.JPG",
      "/tmp/a.mp3",
      "/tmp/a.mp4",
      "/tmp/a.pdf",
      "https://x.test/a.png",
    ].map(classify)).toEqual(["img", "img", "audio", "video", "file", "url"])
  })
})

describe("image preview wiring", () => {
  test("clicking a rendered preview collapses it without leaking to its parent action", async () => {
    let outer = 0
    await using t = await mountNode(
      <box width="100%" height="100%" onMouseDown={() => { outer++ }}>
        <ChafaImage
          path="assets/readme-splash.png"
          chafa={true}
          load={async () => ({ rows: [[{ ch: "X", fg: null, bg: null }]] })}
        />
      </box>,
      { width: 80, height: 12 },
    )
    await until(t, () => t.frame().includes("X"))

    const lines = t.frame().split("\n")
    const y = lines.findIndex(line => line.includes("X"))
    const x = lines[y].indexOf("X")
    await act(async () => { await t.mouse.pressDown(x, y) })

    await until(t, () => !t.frame().includes("X") && t.frame().includes("readme-splash.png"))
    expect(outer).toBe(0)
  })
})
