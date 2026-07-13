# Legacy session fixtures

## `sessions-v2026.7.7.json`

Producer: Hermes Agent `gateway/session.py::SessionEntry.to_dict` and
`SessionStore._save`.

- Introduced: `619c72e566fa4f79e6792c3fab71d08794292872`
- First release: `v2026.3.12`
- DB-backed legacy mirror: `94205a113915c2435f5687efb7b8b3d6a248776f`
- Mirror release: `v2026.7.7`

The fixture preserves required keys and types while redacting routing IDs,
display data, timestamps, and token values.

## `session_20260509_002407_e8b6e4.json`

Producer: Hermes Agent `run_agent.py` JSON snapshot writer.

- Writer: `bbeed5b5d12dd3619809d2dc26ade95aedd3d244`
- Tools field: `0512ada793b323a0f28269c01968c7f0203b2331`
- First release: `v2026.3.12`
- Current status: opt-in via `sessions.write_json_snapshots`

The fixture preserves the producer top-level shape and OpenAI function-tool
schema while redacting model, URL, prompt, timestamps, and messages.
