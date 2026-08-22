# Changelog

## 0.1.0

Initial release.

- Four agent tools over an append-only JSONL journal (`.papercuts.jsonl` at the repository root):
  `papercuts_add`, `papercuts_list`, `papercuts_resolve`, `papercuts_remove`.
- Content-addressed IDs (`pc_` + 12 hex) make adds duplicate-safe across sessions.
- Journal fold tolerates torn final lines, malformed lines, duplicate events, and orphans;
  anomalies surface as warnings instead of failures.
- Repository-specific storage: `PAPERCUTS_FILE` override, git-root discovery, working-directory
  anchor outside repositories; no global log.
- Bundled `review-papercuts` skill for triaging validated friction into durable fixes.
