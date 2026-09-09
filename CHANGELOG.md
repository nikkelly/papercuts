# Changelog

## Unreleased

- Robust to the shell's `node` version: installers skip cleanly with a clear message on Node < 22, and the Codex MCP config pins the installer's node binary (fixes initialize-handshake failures when the PATH `node` is older than 22).
- Location-independent installs: self-contained CLI bundle in `~/.local/share/papercuts/`, opencode plugin copies with write-once configs, manifest-tracked config repair. One refresh story for both hosts: `git pull && npm run install:all`.

## 0.2.0 (2026-09-04) — initial public release

- Multi-host complaint box: opencode native tools, Codex MCP server (`mcp__papercuts__*`), and a zero-dependency CLI — one shared journal core, identical records, per-host attribution.
- Append-only journal (`.papercuts.jsonl` at the git root): content-addressed IDs (duplicate-safe adds), tolerant fold, `PAPERCUTS_FILE` override, mute/unmute as journal events.
- One-command `install:all` (CLI + Codex + opencode) with fail-soft host skips, clean JSONC-config errors, and loud aborts on unparseable marketplace manifests.
- TUI sidebar widget with severity escalation and per-repository muting.
- Security: SHA-pinned CI actions, `contents: read` workflow token, Dependabot, SECURITY.md, agent-readable-entries guidance.
- Renamed to `papercuts` from the opencode-only original.

## 0.1.0

Development release: four tools over the append-only journal and the bundled `review-papercuts` skill.
