
## approval.respond: accept reject-message

`approval.respond` currently takes `{choice, all}`. opencode's permission
flow has a "reject with reason" stage — deny → freeform textarea → the
agent sees the reason as a system note. Extend the handler to accept an
optional `message: str` and have `resolve_gateway_approval` plumb it
through so `tools/approval.py` can include it in the BLOCKED return.

## approval.request: include tool_name / args

`tools/approval.py` only gates terminal commands, so the approval UI can
only show `$ command`. If edit/write/fetch tools ever route through the
same approval path, the payload should include `tool_name` and structured
args so the TUI can render a diff/url/pattern body (oc routes/session/permission.tsx).
