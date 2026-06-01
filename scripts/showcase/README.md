# scripts/showcase/

Scripted herm demo recorder. One command → `.cast`.

```
scripts/showcase/record.sh [out.cast]
```

Pieces:
- `record.sh` — wraps `asciinema rec`, spawns driver in bg
- `drive.ts` — step interpreter, talks to `CONTROL=1` herm on :7777
- `scenes.ts` — the tour (data). Edit this to change the demo.

Env: `COLS`/`ROWS` (default 160×42), `CONTROL_PORT`, `HERM_CMD`.

Post: `asciinema play out.cast` · `agg out.cast out.gif` · upload to asciinema.org.

Retiming: `.cast` is NDJSON `[t,"o",bytes]` after a header line — trivially
post-processable to cap idle gaps without re-recording.

See `.ignore/showcase-plan.md` for the why.
