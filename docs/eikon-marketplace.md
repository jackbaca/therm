# Eikon Marketplace

Herm owns the native Eikon Marketplace loop. The eikon package owns the registry,
catalog data, browser mirror, install resolver, and submit-for-review primitives.
Herm imports those public package exports only; it does not reach into eikon
internal source paths or couple to the browser mirror implementation.

## Open and leave Marketplace

Open Gallery, then press `M` to enter Marketplace. `‹ Back` or `Esc` returns to
Gallery. Backspace is not a back action outside text entry; it remains reserved
for composer and text-field behavior.

Marketplace is a two-pane list/detail surface that follows
`docs/nav_and_ui_standards.md`:

- `↑↓`, `PgUp/PgDn`, `Home/End` move the selected catalog item.
- `/` enters search; `Esc` leaves search before leaving Marketplace.
- `Enter` activates the selected action.
- `Space` toggles the selected preview state.
- `Tab` and `Shift+Tab` move between grid and detail panes.
- Mouse hover selects rows; mouse down activates rows, Back, preview state, and
  action controls.

The footer is the source of truth for live key hints.

## Discovery mirror handoff

The eikon domain is an eikon-owned static discovery mirror. It can load the
public catalog, filter by name or author, preview `.eikon` files, copy an
`eikon install ...` command, and open a Herm detail URL.

The mirror must not publish, authenticate, install into the browser, activate an
eikon, or submit reviews. Native install/use and submit-for-review remain Herm
Marketplace flows; CLI install/publish remain eikon CLI flows.

## Install, use, and preview

Marketplace actions are intentionally separate:

- `Install` writes the selected eikon into local Herm eikon state, then keeps
  focus on that catalog item.
- `Use` activates an already-installed eikon.
- `Active` marks the current avatar and performs no write.
- `Retry` appears when an install failed and can be attempted again.

Selecting a marketplace item does not change the active eikon preference. The
sidebar preview follows the selected marketplace item while the sidebar is
visible. If the app sidebar is hidden or too narrow, the detail pane renders the
single selected preview instead. Leaving Marketplace clears the transient preview
and restores the normal active-eikon sidebar.

The marketplace grid is poster-first. It does not start one animation driver per
card. See `docs/performance/eikon-marketplace.md` for the baseline and PERF
counter policy.

## Submit for review

Local non-bundled eikons expose `u` in Gallery and Studio to submit for review.
Herm runs the eikon package preflight before final submission and shows the exact
included bundle files. Hidden files, secret-looking paths, symlinks, path escapes,
and missing source metadata are blocked or omitted by the eikon primitive before
Herm can submit.

Published marketplace installs are not silently resubmitted as new catalog
entries. Create a local draft/new identity before submitting derivative work.

Submission requires license and provenance metadata and an authenticated backend.
If backend auth or creation fails, Herm keeps typed metadata in the dialog and
surfaces the actionable error with token-like secrets redacted.

## Launch smoke gate

Before calling the v1 loop ready, verify both staging and production:

1. The eikon domain resolves to the eikon-owned Vercel project and serves the
   mirror build from the eikon repo, not the Herm repo or any website repo.
2. `/eikons/index.json` loads with expected CORS and cache headers. Catalog JSON
   should be revalidated; packed assets and posters can be long-cache immutable.
3. A catalog entry appears in the browser mirror, preview loads, and available
   actions stay limited to copy instructions and open Herm detail.
4. The same catalog base loads in Herm Marketplace, the selected preview renders,
   `Install` writes local state without activation, and `Use` is the only
   activation path.
5. Submit preflight for a local non-bundled eikon shows the bundle and blocks
   missing license/provenance, hidden files, secret-looking paths, and symlink or
   path escapes before backend creation.

Current local verification covered the catalog-to-Herm loop with fixtures and
confirmed production is not ready yet: `https://eikon.liftaris.dev/` and
`/eikons/index.json` currently return Vercel `DEPLOYMENT_NOT_FOUND` 404s. Fix
Vercel project/domain mapping before launch.

## Package handoff

This integration pins Herm's `eikon` dependency to the reviewed local handoff:

`/home/kaio/Dev/eikon/.worktrees/t_e2a58089`

That worktree is an ancestor of eikon `integration/eikon-share-v1` at
`6e0e48bc4078be6b9378ae70018624b8a5477034`, which contains the final catalog,
install, browser-safe player, and publish exports used by Herm. The eikon
integration artifact recorded by the board is:

`/home/kaio/.hermes/kanban/boards/herm/workspaces/t_69085913/eikon-integration-eikon-share-v1-6e0e48b.tgz`

Bun currently reports `ENOENT: failed opening cache/package/version dir for
package eikon` for this local package form. The verified test workaround is to
symlink `node_modules/eikon` to the handoff worktree after `bun install`.
