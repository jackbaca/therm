# Diff renderer golden fixture matrix

Goal: add a small regression floor for `DiffBlock`/`DiffTabs` cell output before the diff renderer refactor. The suite should borrow the catwalk-style idea of enumerated testdata cases, not its visual style or framework.

## Layout

Use plain files under `test/testdata/diff-renderer/`:

```
test/testdata/diff-renderer/
  README.md
  cases.ts
  basic-width-80.input.diff
  basic-width-80.cells.txt
  narrow-width-32.input.diff
  narrow-width-32.cells.txt
  short-height-6.input.diff
  short-height-6.cells.txt
  inset-x2-y1.input.diff
  inset-x2-y1.cells.txt
  tabs-frame-width-48.input.json
  tabs-frame-width-48.cells.txt
  linebreak-crlf-tabs.input.diff
  linebreak-crlf-tabs.cells.txt
```

`cases.ts` exports the matrix metadata and loads sibling fixture files with `Bun.file`. Keep dimensions explicit so future cases can be added without guessing what each fixture proves:

```ts
type Case = {
  name: string
  component: "DiffBlock" | "DiffTabs"
  width: number
  height: number
  x?: number
  y?: number
  input: string
  expect: string
}
```

For `x`/`y`, mount the renderer in a small wrapper:

```tsx
<box flexDirection="column">
  {Array.from({ length: c.y ?? 0 }, (_, i) => <box key={i} height={1} />)}
  <box marginLeft={c.x ?? 0}><DiffBlock text={diff} /></box>
</box>
```

## Minimal matrix

Six cases are enough. They cover every roadmap dimension once, with one combined case for tabs inside content and line-break normalization.

| Case | Width | Height | XOffset | YOffset | Tabs | LineBreak | Purpose |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| `basic-width-80` | 80 | 14 | 0 | 0 | no | LF | Baseline unified diff: headers, hunk row, context, paired `-/+` lines, intraline spans. |
| `narrow-width-32` | 32 | 14 | 0 | 0 | no | LF | Width clipping/wrapping guard for long changed lines. |
| `short-height-6` | 80 | 6 | 0 | 0 | no | LF | Viewport truncation: visible top rows are stable when the screen is shorter than the fixture. |
| `inset-x2-y1` | 80 | 14 | 2 | 1 | no | LF | Offset handling: cell grid includes a blank top row and two leading blank cells before diff content. |
| `tabs-frame-width-48` | 48 | 16 | 0 | 0 | tab strip | LF | `DiffTabs` chrome: active tab, count row, wrapped/narrow tab labels, body handoff to `DiffBlock`. |
| `linebreak-crlf-tabs` | 80 | 14 | 0 | 0 | literal tab chars in diff text | CRLF input | Sanitization/normalization: CRLF does not add phantom rows; literal `\t` remains encoded predictably. |

Do not add a full Cartesian product. The dimensions interact mostly through OpenTUI's final cell grid, so pairwise coverage is the right floor here. Add new cases only for a bug class with a distinct failure mode.

## Naming

Use stable, hyphenated names:

```
<feature>-<dimension>-<value>[--<qualifier>]
```

Examples:

- `basic-width-80`
- `narrow-width-32`
- `short-height-6`
- `inset-x2-y1`
- `tabs-frame-width-48`
- `linebreak-crlf-tabs`

Each case has one input and one expected file:

- `*.input.diff` for raw `DiffBlock` input.
- `*.input.json` for `DiffTabs` `ToolPart[]` input.
- `*.cells.txt` for the golden cell output.

The test name should match the fixture stem exactly:

```ts
test.each(cases)("%s", async c => { ... })
```

## Cell output encoding

Snapshot OpenTUI cell output, not semantic assertions. Prefer `captureSpans()` over `frame()` so color/style regressions are visible. Encode one physical terminal row per line, with each span bracketed by foreground/background/style tags:

```
@ 00 | fg=textMuted bg=backgroundPanel |--- a/x.ts|
@ 01 | fg=textMuted bg=backgroundPanel |+++ b/x.ts|
@ 02 | fg=accent    bg=backgroundPanel |@@ -1,3 +1,3 @@|
@ 03 | fg=textMuted bg=backgroundPanel | keep|
@ 04 | fg=error     bg=backgroundPanel |-const | fg=error bg=diffRemovedBg |foo| fg=error bg=backgroundPanel | = 1|
@ 05 | fg=success   bg=backgroundPanel |+const | fg=success bg=diffAddedBg   |bar| fg=success bg=backgroundPanel | = 1|
```

Rules for deterministic encoding:

1. Use theme token names, not raw RGB values. Build a reverse lookup from `useTheme().theme` inside the test helper and map captured `RGBA` values to token names.
2. Preserve physical rows and columns. Prefix each row with zero-padded row index: `@ 00`, `@ 01`, etc.
3. Preserve spaces inside `|...|`. Do not trim span text. Empty rows encode as `@ 03 |`.
4. Escape control characters in span text: `\t`, `\r`, `\n`, `\x1b`. This keeps the `linebreak-crlf-tabs` fixture readable.
5. Coalesce adjacent spans only when text attributes, fg token, and bg token are identical. Do not merge across highlighted intraline spans.
6. Include style attrs when non-zero: `attrs=bold`, `attrs=underline`, or numeric fallback if OpenTUI adds an unknown bit.
7. Keep terminal size in the test metadata, not in the golden body. The file is the cell grid; `cases.ts` carries width/height/x/y.

`*.cells.txt` should end with a trailing newline so diffs stay clean.

## Test harness shape

Add a small helper in the test file or `test/fixtures/cells.ts`:

```ts
function cells(t: Harness, theme: Theme): string {
  return encode(t.renderer.captureSpans(), theme)
}
```

If `captureSpans()` is only exposed by `testRender`, extend `test/harness.tsx` to return it alongside `frame()`; this is a testability adjustment, not renderer behavior.

The golden test should:

1. Mount `DiffBlock` or `DiffTabs` at the case width/height.
2. Wait until a hunk marker or tab label appears.
3. Encode spans to text.
4. Compare exactly to `*.cells.txt`.

Use a separate `UPDATE_DIFF_GOLDENS=1` path only if the project already accepts update flags. Otherwise require manual edits to golden files so visual changes are reviewed deliberately.
