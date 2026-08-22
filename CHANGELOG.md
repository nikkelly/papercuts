# Changelog

## Unreleased

- TUI sidebar widget (`src/tui.tsx`): renders open papercut count with today trend and
  severity breakdown in the right sidebar next to Context/LSP; theme-colored escalation
  (error for open blockers, warning at ≥3 opened today or ≥2 open majors); collapse
  matches the built-in Todo section.
- Codex plugin (`plugin/`): skills-based integration with a zero-dependency CLI
  (`bin/papercuts.mjs`), distributable via git marketplace — no npm or MCP required.
- Agent attribution: store operations accept an `agent` option (default `opencode`);
  the skills instruct agents to pass `--agent codex` on writes, so journal entries record their source host.
- Repo marketplace manifest at `.agents/plugins/marketplace.json`.

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
