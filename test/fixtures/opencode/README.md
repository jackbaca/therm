# OpenCode compatibility fixtures

Schema pin: OpenCode `4a1982f5c951850a1820e7eb0c9ed4b4613a2912`, package `1.17.18`.

Upstream paths:

- `packages/opencode/src/config/tui.ts`
- `packages/opencode/src/config/paths.ts`
- `packages/opencode/src/config/migrate-tui-config.ts`

Herm intentionally supports JSON `tui.json` in the current directory and
`.opencode/tui.json`, with the latter taking precedence. Herm does not claim
parity with OpenCode's JSONC, ancestor search, environment/custom paths, or
managed config layers. The fixtures cover only this declared import contract.
