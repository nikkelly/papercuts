# Shared tool contracts and the Codex MCP adapter

The six papercuts tool definitions (add / list / resolve / remove / mute / unmute) were
duplicated across the opencode adapter and the skills-and-CLI Codex surface — the one solid
argument for moving opencode to a single MCP-only surface. We instead extracted the contracts
into one shared module, `plugin/src/tools.ts`, and gave Codex a structured-tools MCP server
on top of it, keeping opencode native:

- `plugin/src/tools.ts` — each tool's name, description, zod args, and a `run(journal, args, context)`
  handler, written once. This removes adapter drift without opencode paying MCP's costs.
- **opencode stays native** — `src/index.ts` registers the shared contracts via
  `@opencode-ai/plugin`'s `tool()` (names, error rendering, worktree-aware discovery all unchanged).
- **Codex gets an MCP stdio adapter** — `plugin/src/mcp.ts` (registered via `plugin/.mcp.json`),
  surfacing the same tools as `mcp__papercuts__*` with `codex` as the default agent.
- **CLI retained as the standalone surface** — `bin/papercuts.mjs` stays the zero-dependency,
  CI-friendly surface.
- **Shared AGENTS.md pen lines stay CLI-based** — shared instructions never hardcode `mcp__`
  names that break when the plugin is absent; the bundled `papercuts` skill prefers MCP tools
  when available and falls back to the CLI otherwise.

Both adapters remain thin registrations over `tools.ts`; all unique behavior lives in `journal.ts`.

The plugin subtree is dependency-free: `plugin/src/schema.ts` is a small internal schema module
(string/number/enum/optional fields with `validate()` and `toJsonSchema()`) that `tools.ts` and
`mcp.ts` use instead of zod. The opencode adapter (`src/index.ts`) is the only zod consumer — the
`@opencode-ai/plugin` SDK's native `tool({ args })` format requires zod shapes — so the standalone
Codex plugin copy needs no `node_modules` and works from any distribution path (personal install,
cache snapshot, git marketplace).

Status: accepted
