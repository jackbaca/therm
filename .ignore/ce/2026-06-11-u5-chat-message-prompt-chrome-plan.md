---
title: "U5: Chat message and prompt chrome"
type: feat
status: active
date: 2026-06-11
parent: /home/kaio/Dev/herm/.ignore/ce/2026-06-11-001-feat-herm-ux-polish-child-prs-plan.md
---

# U5: Chat message and prompt chrome

## Scope

Implement the U5 slice only on `feat/chat-message-prompt-chrome` targeting `dev`:

- Remove user-message top/bottom border-rule glyph indicators.
- Keep user turns easier to scan through token-driven background, spacing, label, and a non-border structural cue.
- Preserve assistant/tool/system/error/media/code/diff rendering.
- Preserve prompt question context after clarify outcomes, including selected and freeform answers.
- Preserve safe context for approval/sudo/secret outcomes without leaking secret values or full command bodies.

Explicitly out of scope: portability, Docker, OpenTUI upgrade, broad Sidebar work, responsive/mobile layout, TabShell/selected-panel border redesigns, fit-to-content pane alignment, skill composer redesign, kanban-detail keyboard overhaul, and new Hermes Agent gateway RPCs.

## Current findings

- `MessageItem.tsx` currently renders user turns with `BOTTOM_RULE` and `TOP_RULE` one-cell-high border rows around the user body. Tests assert `▁` and `▔`, so implementation must update those assertions.
- Assistant/tool/system rendering is separated from `UserMessage`; preserving it mainly means avoiding broad changes outside `UserMessage`.
- `PromptCard.tsx` collapses answered prompts to one line. Clarify outcomes currently show only `chose: <answer>`, losing the question. Approval outcomes show only the choice, sudo/secret show safe labels.
- `PromptPart` already carries the original request under `part.req`, so no gateway contract change is needed for live prompts.
- Replayed prompt-like transcript rows may already contain question text as normal text plus an outcome part; answer rendering must avoid duplicating question text inside the same outcome if the answer label already includes it.

## Implementation plan

1. Replace `UserMessage` rule rows with a compact token-based card:
   - Add a left structural glyph/rail using text/glyph weight rather than OpenTUI border rules.
   - Add a `You` label row with muted/accent text so low-color terminals still distinguish user turns.
   - Use existing theme tokens (`backgroundElement`, `backgroundPanel`, `primary`, `text`, `textMuted`) and existing `mix()` helper for hover/highlight; no raw colors.
   - Preserve click-to-rewind behavior and all part rendering for text, media, and code.

2. Enrich prompt answered state:
   - Extend `PromptPart.answered` with optional `question?: string` so the reducer can persist answer context even if a prompt part is later serialized or replayed with reduced request payload.
   - On `prompt.answered`, derive a safe question string from `PromptReq` and store it in `answered.question`.
   - Keep type changes Herm-local only.

3. Update `PromptCard` outcome rendering:
   - Clarify outcome: show `ask <question>` and `answer: <label>` in a compact transcript-safe block.
   - Avoid duplicate question text if the answer label already includes the question.
   - Approval outcome: preserve subject/description context, not full command body.
   - Sudo outcome: show safe elevation context only.
   - Secret outcome: show env var and provided/cancelled label only; never render the secret value.

4. Update tests:
   - `test/messagelist.test.tsx`: assert user message has no `▁`/`▔`, contains the user label/cue, and assistant trail/header still render.
   - `test/prompt-card.test.tsx`: answered clarify shows question and answer; freeform answer wraps/truncates safely enough to keep question visible; approval/sudo/secret outcomes hide sensitive command/secret bodies.
   - `test/app.test.tsx`: clarify outcome persists with question and selected answer after turn completion; secret remains masked and outcome safe.

## Verification plan

Run, in order:

```bash
export PATH="/home/kaio/.bun/bin:$PATH"
bun test test/prompt-card.test.tsx test/messagelist.test.tsx test/app.test.tsx
bun test
bunx tsc --noEmit
```

If browser smoke is applicable, run the available CE/browser smoke command discovered in the repo. If no browser-specific surface exists for this OpenTUI-only change, record it as not applicable with focused component/app frame tests as the smoke gate.

## Risks

- OpenTUI frame rendering can make visual assertions brittle. Prefer semantic strings/glyph absence over exact full-frame snapshots.
- Prompt outcomes need context without leaking command or secret values. Keep approval command body out of answered rows and preserve only description/subject.
- Do not change gateway wire types beyond local optional fields; upstream events remain unchanged.
