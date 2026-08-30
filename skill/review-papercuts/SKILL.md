---
name: review-papercuts
description: Review logged papercuts (.papercuts.jsonl via papercuts_list) and improve how future agents operate by turning validated friction into repo changes, workflow changes, agent instructions, guardrails, warnings, or dismissal. Use when asked to review, triage, or clean up papercuts.
---

# Review Papercuts

This is the opencode wrapper. The canonical methodology (workflow, guardrails, routing)
lives at `../../plugin/skills/review-papercuts/SKILL.md` relative to this skill directory —
**read it and follow its workflow**.

## Invocation (opencode)

- List with the `papercuts_list` tool — use `status: "all"` to see resolved entries too.
- Resolve verified fixes with `papercuts_resolve(id, note="where the fix lives")`.
- Remove invalid, duplicate, or not-worth-acting-on entries with `papercuts_remove(id)`.

Report each reviewed papercut as one of:

- repo changed
- workflow changed
- agent instruction added or refined
- guardrail added
- warning retained
- dismissed
- unresolved

For every addressed entry, state where the durable change now lives.
