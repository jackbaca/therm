# Eikon compatibility fixtures

## `mono-v1.6.0-extract.eikon`

Released source: `git show v1.6.0:assets/eikons/mono.eikon`

- Herm tag: `v1.6.0`
- Commit containing tag: `0f456cb`
- Git blob: `d9255bfb0b8361fbe1016eaebd9c8f83a3952780`
- Full artifact SHA-256: `c27339b43dd9c6d5c3231f2c03b3d7b2be9f9b5d8bfa19b238c4e04e7b5a467d`
- Extract SHA-256: `6f4b6c159ddd5cabfc3ba9ff62a8480eb3c717ae94f6bd5c3d8a2e4f1ec2c302`

Deterministic extraction keeps the released header, the first state declaration,
and its first two frames. It changes `frame_count` to `2` and clamps
`loop_from` to the extracted range. Frame payloads and header fields, including
the historical `source_url`, are otherwise unchanged.

Current reader: `src/components/avatar/eikon.ts::parseEikon` via the pinned
Eikon parser. Current writers emit typed launch streams, so this fixture exists
only for the released pre-launch reader contract.
