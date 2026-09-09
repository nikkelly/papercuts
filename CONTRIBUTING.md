# Contributing

Papercuts is a small, dependency-free plugin for coding agents. From clone to green in a minute:

```shell
npm install   # Node 22+; plain TypeScript via Node's type stripping, no build step
npm test      # unit tests (node:test), CLI tests, tool-surface evaluation
npm run typecheck
```

## Conventions

See [AGENTS.md](AGENTS.md) for the full list. The essentials:

- Zero runtime dependencies except `zod`, pinned to the exact version `@opencode-ai/plugin` depends on. The Codex plugin subtree (`plugin/`) must stay dependency-free entirely.
- Store semantics are append-only: never rewrite or truncate the journal in code; corrections are new events.
- Every behavior change ships with a regression test that fails without the change.
- Local imports use explicit extensions (`.ts` for TypeScript, `.mjs` for the plain JS installers; `.mjs` modules imported from tests get a `.d.mts` sidecar).

## Architecture

One shared journal core, thin host adapters:

- `plugin/src/journal.ts` — the journal: path discovery, content-addressed IDs, tolerant fold, all operations behind `Journal.open()`
- `plugin/src/tools.ts` — the six tools' contracts (name, description, args, run handler), written once
- `plugin/src/envelope.ts` — the `{ok:true,data}` / `{ok:false,error:{code,message}}` envelope and CLI exit-code mapping
- `plugin/src/schema.ts` — dependency-free field schemas; the plugin subtree never imports zod
- `plugin/src/mcp.ts` — Codex MCP adapter (zero-dependency stdio server over the shared tools)
- `src/index.ts` — opencode adapter (native tools; the only zod consumer)
- `src/tui.tsx` + `src/tui-stats.ts` — opencode TUI sidebar widget
- `plugin/bin/papercuts.mjs` + `plugin/skills/` — CLI and Codex skills; `skills/` at the root is the opencode wrapper

All surfaces write identical records; a fix to the journal core lands in every host at once.

## Behavioral evaluation

`npm run eval:behavioral` drives real headless opencode sessions against disposable fixture repositories and grades the journal plus tool-call telemetry:

- **clean** sessions must file nothing (over-triggering gate)
- **friction** sessions must file at least once
- **ambiguous** sessions — where the failing test is the task — must not file

```shell
PAPERCUTS_EVAL_MODEL=anthropic/claude-sonnet-4-20250514 npm run eval:behavioral
# options: --only=<substring>  --repeat=<n>  --keep
```

Sessions cost tokens and are nondeterministic, so this is a gated check, not part of `npm test`. Configure a provider with `opencode auth` or pin a model with `PAPERCUTS_EVAL_MODEL`; per-run timeout via `PAPERCUTS_EVAL_TIMEOUT_MS`.

## Dogfooding

This repo uses its own plugin: friction you hit while working gets filed to `.papercuts.jsonl`, and "review papercuts" turns validated complaints into fixes. File a papercut when a command fails unexpectedly; don't file the task itself.
