# Herm - Dashboard TUI for Hermes
<img width="1711" height="927" alt="image" src="https://github.com/user-attachments/assets/d3b855a0-b1b2-4ea1-8eab-84f9716c8de9" />

> **herm** /hɜːm/ _noun_ : a sculptured head of Hermes on a square stone pillar, used in ancient Greece as a boundary marker at crossroads.

Herm is a tabbed, mouse-aware TUI built with [OpenTUI](https://github.com/anomalyco/opentui) (React renderer) and [Bun](https://bun.sh/). It talks to the same gateway `hermes` cli uses.

## What it does

- **Chat** with streaming, markdown, inline images (chafa), LaTeX→unicode, diff chips, tool-call expansion, and an animated ASCII avatar
- **Tabs** for sessions, context, agents, analytics, skills, cron, toolsets, config, env, memory, kanban
- **Profile switching** — hop between Hermes profiles without leaving the TUI
- **Command palette** (`Ctrl+K`), **slash popover**, **@-refs** for file/diff context
- **Fully rebindable keys** (`/keys`, opencode-compatible) and theme picker

## Install

Herm needs a working [Hermes Agent](https://github.com/NousResearch/hermes-agent) install and [Bun](https://bun.sh).

```bash
bunx herm-tui              # try without installing
bun add -g herm-tui        # stable
npm i -g herm-tui          # also fine
bun add -g herm-tui@next   # bleeding edge (every dev push)
herm                       # fresh session
herm -c                    # resume last session
```

Or from source:

```bash
git clone https://github.com/liftaris/herm.git
cd herm && bun install
bun run src/index.tsx
```

Herm looks for `~/.hermes`. If yours lives elsewhere, set `HERMES_HOME`. See [`.env.example`](./.env.example) for rarely-needed overrides.

## Quick Start

Once herm launches you'll see a splash screen with tips at the bottom — click them to cycle through more. From there:

**Change theme:** Type `/theme` in the composer to open the theme picker. Browse 40+ themes including Catppuccin, Dracula, Gruvbox, Nord, Tokyo Night, and many more. If text is hard to read (especially in tmux or with a dark terminal), pick a lighter theme like `daylight`, `mercury`, or `github`.

**Get help:** Type `/help` for keyboard shortcuts, or press `Ctrl+K` to open the command palette for all available actions.

**Navigate tabs:** Use `Tab` / `Shift+Tab` to move between top-level tabs (Sessions, Context, Config, etc.). Arrow keys navigate within a tab.

**Key commands:** Type `/` in the composer for slash commands including:
- `/new` — start a new session
- `/resume <id>` — switch to an existing session
- `/title <name>` — name the current session
- `/model <name>` — switch models
- `/skin <name>` — switch Hermes personality skins
- `/keys` — view and rebind all keybindings
- `/quit` — exit herm

**Tip:** If you run herm inside tmux and text is unreadable (dark-on-dark), it's likely a color escape issue. Try `/theme daylight` or another light theme first, then check your tmux config — `set -g default-terminal "tmux-256color"` in `~/.tmux.conf` often fixes color issues on macOS.

## Development

```bash
bun run dev            # watch mode
bun run typecheck
bun test
```

## Motivation
Before Hermes, OpenCode was my daily driver. I built Herm because I wanted Hermes capabilities with an OpenCode style interface. Herm uses the same TUI framework OpenCode is built with, OpenTUI, and also exposes dashboard style tabs that centralizes everything I need to do in Hermes in my interface of choice--the terminal.

## Acknowledgments

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — the brain
- [OpenTUI](https://github.com/anomalyco/opentui) — the TUI framework
- [OpenCode](https://github.com/anomalyco/opencode) — the inspiration

## License

MIT — see [LICENSE](./LICENSE).
