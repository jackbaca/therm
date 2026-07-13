# Curator run fixtures

Producer: Hermes Agent `agent/curator.py::_write_run_report`.

- Run report writer: `bc0d8a941ed9e41ca90f46d353c9db0b421b3c85`
- `consolidated` / `pruned` additions: `8b290a5908fbac354180d0069cf12645343bc9d5`
- `cron_rewrites` / `counts.cron_jobs_rewritten`: `e2eb561e8`
- Fixture payload release: `v2026.5.7`

Fixtures preserve every top-level field guaranteed by `_write_run_report`,
including the complete count object. Names, timestamps, counts, model/provider
values, summaries, and reasons are synthetic and contain no profile data.
