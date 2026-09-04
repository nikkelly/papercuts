# AGENTS.md

Guidance for agents working in this repository.

## Papercuts

MANDATORY: whenever a command you ran fails unexpectedly — a nonzero exit you could not
have predicted from the task — file it before moving on:

- In opencode, use the native tool:
      papercuts_add(text="what you hit and what would have prevented it", tag="<area>")
- In Codex, use the bundled plugin CLI:
      node <plugin-root>/bin/papercuts.mjs add "..." --tag <area> --agent codex

Do not file failures that ARE the assigned task itself (e.g. a test you were told to fix).
Severity: minor (default) for annoyances, major for time sinks, blocker for hard walls.

This repo dogfoods its own plugin: the journal lives at `.papercuts.jsonl` here. When
asked to review papercuts, follow `skill/review-papercuts/SKILL.md`.

## Conventions

- Node >= 22; plain TypeScript executed with Node's type stripping (no build step).
  Import local modules with explicit `.ts` extensions.
- Zero runtime dependencies except `zod` pinned to the exact version
  `@opencode-ai/plugin` depends on.
- Tests use `node:test`; run `npm test`. End-to-end coverage lives in
  `test/eval.test.ts` (part of `npm test`), which must exercise the real plugin tool surface,
  not the store directly.
- Store semantics are append-only: never rewrite or truncate the journal in code;
  corrections are new events.
- Every behavior change ships with a regression test that fails without the change.
