# Changelog

## Unreleased

- Shared tool contracts: `plugin/src/tools.ts` defines the six papercuts tools (name,
  description, zod args, and a run handler over `Journal`) once; both the native opencode
  plugin and the new Codex MCP server register against it, removing adapter drift.
- Codex MCP server: `plugin/src/mcp.ts` is a zero-dependency stdio MCP server (registered
  via `plugin/.mcp.json`) exposing the same tools as `mcp__papercuts__*`, defaulting
  attribution to `codex`; the CLI remains the standalone/CI surface.
- Codex installer pinning: `scripts/install-codex-plugin.mjs` now rewrites the copied
  `.mcp.json` so the MCP server path is an absolute path under the install target, making
  the launcher cwd-independent.
- Integration test for the real MCP server over stdio (`test/mcp.test.ts`).
- Sidebar mute: `papercuts_mute`/`papercuts_unmute` tools, `papercuts
  mute|unmute|toggle|status` CLI commands, and a `Papercuts: Toggle sidebar` TUI
  command (keybind `ctrl+x p`) hide and show the sidebar widget via append-only
  `mute`/`unmute` journal events — per-repository, shared across hosts, last event wins.
- Shared envelope contract (`plugin/src/envelope.ts`): both hosts now emit
  `{"ok":true,"data":...}` on success and `{"ok":false,"error":{"code","message"[,"candidates"]}}`
  on failure; the opencode tools throw errors (rendered natively) while the CLI maps error
  codes to exit codes (1 invalid/usage, 2 not found/ambiguous, 3 I/O).
- Typechecking now covers the whole tree: `tsconfig.json` includes `plugin/src/`,
  `scripts/`, and `test/` (previously hidden implicit-any errors fixed).
- The script-based eval harness (`scripts/eval.ts`) was folded into `npm test` as
  `test/eval.test.ts`; the tool-surface scenarios run as node:test blocks and the
  `npm run eval` script was removed from CI and package.json.
- `review-papercuts` methodology consolidated: `plugin/skills/review-papercuts/SKILL.md`
  is the canonical single source shared by both hosts; `skill/review-papercuts/SKILL.md`
  is a thin opencode wrapper pointing at it.
- Marketplace installer fix: `scripts/install-codex-plugin.mjs` now always forces the
  home-dir manifest name to `personal` instead of only when absent, so a pre-existing
  manifest with a different name no longer breaks registration/reinstall; new
  `marketplaceEntry(mode)` builder in `scripts/codex-marketplace.mjs` covers the
  git-subdir shape too.
- TUI sidebar widget (`src/tui.tsx`): renders open papercut count with today trend and
  severity breakdown in the right sidebar next to Context/LSP; theme-colored escalation
  (error for open blockers, warning at ≥3 opened today or ≥2 open majors); collapse
  matches the built-in Todo section.
- Codex plugin (`plugin/`): skills-based integration with a zero-dependency CLI
  (`bin/papercuts.mjs`) and an MCP server, distributable via git marketplace — no npm
  required.
- Agent attribution: store operations accept an `agent` option (default `opencode`);
  the skills instruct agents to pass `--agent codex` on writes, so journal entries record their source host.
- Repo marketplace manifest at `.agents/plugins/marketplace.json`.
- Private/local Codex install: `scripts/install-codex-plugin.mjs` (via `npm run
  install:codex`) copies the plugin tree into a personal marketplace, registers +
  (re)installs `papercuts@personal` headlessly, and prints the resolved CLI path. Designed
  for private repos or local dev — keeps the plugin offline, no public marketplace needed.
  `mergeMarketplace` (in `scripts/codex-marketplace.mjs`) is unit-tested with node:test.

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
