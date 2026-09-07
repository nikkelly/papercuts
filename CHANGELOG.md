# Changelog

## Unreleased

- The journal owns the Papercut vocabulary: `SEVERITIES` (values, hints, sort order) and
  `STATUSES` are exported from `plugin/src/journal.ts`, and the `Severity` type, the
  fold's severity rank, `parseCut`'s tolerant reading, the tool enum schemas, the
  severity description prose, and the CLI usage line all derive from them — one
  spelling for values, order, and prose.
- Strict about invalid calls, tolerant about data: `add` now rejects a severity
  outside the vocabulary or a fractional `exitCode` at write time (a cut written with
  a severity the fold would drop as malformed used to vanish silently on every read),
  and `list` rejects an invalid `status` or fractional `limit` with a clear error
  instead of returning an empty result or silently flooring. The fold stays tolerant
  of corrupt disk bytes; envelopes and exit codes are unchanged.
- One start-directory policy for the opencode adapters (`src/host-context.ts`): the
  tool surface and the TUI widget resolve the Journal's start directory through the
  same guarded rule (directory → worktree, rejecting empty strings and the `/` root
  sentinel), so a `worktree: "/"` session no longer sends the sidebar to
  `/.papercuts.jsonl`; the TUI toggle also re-reads fresh mute state.
- The repo's own AGENTS.md pen demonstrates the placeholder-free short command.

## 0.2.0 (2026-09-04)

- Renamed to `papercuts`: the project serves both opencode and Codex, so the
  opencode-only name retired. Package name, repository URLs, marketplace manifest,
  plugin metadata, and docs now point at `github.com/nikkelly/papercuts`; the TUI
  plugin id is `papercuts-tui`.
- `install:all` hardening: steps run CLI → Codex → opencode so codex-only machines
  get everything usable before any opencode-specific failure; an absent host is a
  `SKIPPED` note with exit 0 instead of failing the run; any other failure stops the
  run immediately. The final summary prints the paste-ready AGENTS.md pen, the
  verification command, and restart reminders.
- `install:codex` skips cleanly when the `codex` CLI is not on PATH, and surfaces
  nonzero codex command exits (with stderr) instead of silently reporting success;
  `codex plugin remove` stays best-effort for fresh installs.
- `install:opencode` reports a JSONC config as a clean status-1 error with guidance
  instead of crashing with an uncaught stack trace.
- `skill/` renamed to `skills/` to match `plugin/skills/`; opencode config paths and
  the installer updated.
- Dependency-free standalone plugin: `plugin/src/tools.ts` and `plugin/src/mcp.ts` now build and
  validate tool contracts with a small internal module (`plugin/src/schema.ts`) instead of zod, so
  the plugin subtree ships with zero runtime dependencies. The MCP server runs from any copied
  plugin tree (install target, codex cache snapshot, or git marketplace) without `node_modules`;
  zod remains a dependency only of the opencode host (`src/index.ts`), where the SDK requires it.
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
