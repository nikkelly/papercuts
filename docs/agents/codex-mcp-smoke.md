# Codex MCP smoke test

Procedure for verifying the Codex plugin ships and serves the papercuts MCP tools end-to-end, plus
the findings so far. Run cheap models (`-m gpt-5.5`) for test sessions.

## Preconditions (verified 2026-08-31)

- `codex-cli 0.151.0` (plugin-bundled MCP needs v0.117+)
- `node` on PATH ≥ 22 (type stripping) — here `v24.19.0`
- Plugin installed + enabled: `codex plugin list` shows `papercuts@personal`
  `installed, enabled` at `~/.codex/plugins/papercuts`
- `codex mcp list` shows the `papercuts` stdio server with the pinned absolute path
- `plugin/.codex-plugin/plugin.json` declares the component pointer `"mcpServers": "./.mcp.json"`

## Reproduce the live session failure/verification

```bash
npm run install:codex          # refresh install target + codex cache snapshot
cd "$(mktemp -d)" && git init  # fixture repo so discovery anchors there
codex exec --skip-git-repo-check --sandbox workspace-write -m gpt-5.5 \
  "Call the MCP tool mcp__papercuts__add with text '<t>' tag 'tooling'"
```

Interactive TUI sessions exercise the same server (`/plugins` selection is not needed for an
installed plugin; the server starts automatically). The terminal shows a startup line
`papercuts mcp: journal target <path>` on the server's stderr only when the server fails loudly.

## Expected results

- A `codex`-attributed `cut` lands in the fixture repo's `.papercuts.jsonl` (if the server is the
  one writing, `repo` is the fixture root; the CLI fallback also writes identical records there).
- `papercuts list --agent codex` in the fixture repo reads it back.

## Findings

### 1. Standalone plugin crashed at `initialize` — missing runtime dep (fixed)

Codex launches the server from a standalone copy of `plugin/`, which previously contained no
`node_modules`; `mcp.ts`/`tools.ts` imported zod → the process exited before answering
`initialize`, surfacing in-codex as:
`MCP client for 'papercuts' failed to start: handshaking with MCP server failed: connection closed: initialize response`.

Fixed by removing zod from the plugin subtree entirely: `plugin/src/schema.ts` is a small internal
module (string/number/enum/optional fields + `validate()` + `toJsonSchema()`) used by `tools.ts`
and `mcp.ts`. zod remains only in `src/index.ts` (the opencode SDK requires zod arg shapes). The
installed plugin now runs with no `node_modules` present (verified by deleting it and re-running
the stdio handshake: `initialize` → `tools/list` → `tools/call` all succeed).

### 2. Manifest must declare the MCP component (fixed)

`codex-plugin/plugin.json` requires the component pointer `"mcpServers": "./.mcp.json"`; without
it, sessions never attempt the server.

### 3. `codex exec` never injects MCP tools into the model schema (upstream limitation)

Headless `codex exec` did not expose `mcp__*` tools under any configuration tried (plugin-bundled,
`-c 'mcp_servers.<name>={...}'` override, project `.codex/config.toml`, `danger-full-access`
sandbox, `default_tools_approval_mode="approve"`). This matches openai/codex issues
[#17904](https://github.com/openai/codex/issues/17904),
[#38689](https://github.com/openai/codex/issues/38689),
[#14115](https://github.com/openai/codex/issues/14115). Interactive sessions are the MCP path;
the bundled CLI/skill remains the headless and CI surface (shared `AGENTS.md` pen lines already
stay CLI-based).

### 4. cwd anchoring

Codex launches the server with no `cwd` override; the server anchors the journal at
`process.cwd()` (git-root discovery), so sessions in a repo write to that repo's journal. The
installer still pins the absolute `src/mcp.ts` path for launcher-cwd independence.

## Automated coverage

`npm test` drives the real server over stdio (`test/mcp.test.ts`: initialize, tools/list, add,
invalid-argument envelope, unknown-tool JSON-RPC error) and the installer pins the absolute path
(`test/install-codex.test.ts`). Typecheck: `npm run typecheck`.