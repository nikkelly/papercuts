# AGENTS.md

Guidance for agents working in this repository.

## Papercuts

When you hit friction during work — a dead-end tool call, a broken link, a misleading
doc, a footgun config — file it before moving on:

- In opencode, use the native tool:
      papercuts_add(text="what you hit and what would have prevented it", tag="<area>")
- In Codex, use the bundled plugin CLI:
      node <plugin-root>/bin/papercuts.mjs add "..." --tag <area> --agent codex

Don't stop working; file it and push on. Severity: minor (default) for annoyances,
major for time sinks, blocker for hard walls.

This repo dogfoods its own plugin: the journal lives at `.papercuts.jsonl` here. When
asked to review papercuts, follow `skill/review-papercuts/SKILL.md`.

## Conventions

- Node >= 22; plain TypeScript executed with Node's type stripping (no build step).
  Import local modules with explicit `.ts` extensions.
- Zero runtime dependencies except `zod` pinned to the exact version
  `@opencode-ai/plugin` depends on.
- Tests use `node:test`; run `npm test`. End-to-end coverage lives in
  `scripts/eval.ts` (`npm run eval`), which must exercise the real plugin tool surface,
  not the store directly.
- Store semantics are append-only: never rewrite or truncate the journal in code;
  corrections are new events.
- Every behavior change ships with a regression test that fails without the change.
