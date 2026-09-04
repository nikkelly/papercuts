# Contributing

Papercuts is a small, dependency-free plugin for coding agents. This guide gets you
from clone to green in a minute.

## Setup

```shell
npm install   # Node 22+; plain TypeScript via Node's type stripping, no build step
npm test      # unit tests (node:test), CLI tests, tool-surface evaluation
npm run typecheck
```

## Conventions

See [AGENTS.md](AGENTS.md) for the full list. The essentials:

- Zero runtime dependencies except `zod`, pinned to the exact version
  `@opencode-ai/plugin` depends on. The Codex plugin subtree (`plugin/`) must stay
  dependency-free entirely.
- Store semantics are append-only: never rewrite or truncate the journal in code;
  corrections are new events.
- Every behavior change ships with a regression test that fails without the change.
- Local imports use explicit extensions (`.ts` for TypeScript, `.mjs` for the plain
  JS installers; `.mjs` modules imported from tests get a `.d.mts` sidecar).

## The eval harness

`npm test` includes the tool-surface evaluation (`test/eval.test.ts`). The behavioral
trigger-rate evaluation is separate and gated — see "Behavioral evaluation" in the
[README](README.md#behavioral-evaluation-trigger-rate). It drives real agent sessions,
costs tokens, and is not part of CI.

## Dogfooding

This repo uses its own plugin: friction you hit while working gets filed to
`.papercuts.jsonl`, and "review papercuts" turns validated complaints into fixes.
File a papercut when a command fails unexpectedly; don't file the task itself.
