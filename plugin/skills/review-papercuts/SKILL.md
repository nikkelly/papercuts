---
name: review-papercuts
description: Review the papercuts journal (.papercuts.jsonl) and improve how future agents operate by turning validated friction into repo changes, workflow changes, agent instructions, guardrails, warnings, or dismissal. Use when asked to review, triage, or clean up papercuts.
---

# Review Papercuts

The journal is `.papercuts.jsonl` at the repository root. Review it, then improve how
future agents operate by turning validated friction into durable fixes.

The goal is not to clean up complaints. The goal is to make the next agent handle the
same situation correctly without rediscovering it.

## Invocation

Use the surface your host provides:

- **opencode** — native tools:
  - list: `papercuts_list` (use `status: "all"` to see resolved entries too)
  - fixed for good: `papercuts_resolve(id, note="where the fix lives")`
  - invalid, duplicate, or not worth acting on: `papercuts_remove(id)`
- **Codex** — bundled CLI (see the `papercuts` skill for full invocation details):
  - list: `node <plugin-root>/bin/papercuts.mjs list --status all`
  - fixed for good: `node <plugin-root>/bin/papercuts.mjs resolve <id-prefix> --note "where the fix lives" --agent codex`
  - invalid, duplicate, or not worth acting on: `node <plugin-root>/bin/papercuts.mjs remove <id-prefix> --agent codex`
  - pass `--agent codex` on every write command (add, resolve, remove)

## Workflow

1. List the current papercuts (see Invocation above).
2. Deduplicate related entries and validate whether the friction is real. Reproduce it where practical before acting on it.
3. For each meaningful papercut, ask:

   > What should change so the next agent handles this correctly without needing to rediscover it?

4. Choose the smallest durable outcome:
   - **Repo change** — change code, config, scripts, defaults, or docs
   - **Workflow change** — change the sequence or method agents should use
   - **Agent instruction** — add or refine concise guidance in `AGENTS.md` or another agent-facing file
   - **Guardrail** — automate or enforce something agents should not have to remember
   - **Warning** — preserve a validated limitation or hazard where future agents will see it before acting
   - **No action** — dismiss one-off mistakes or low-value friction
5. Route specialized work where useful:
   - unexplained or reproducible failure → investigate before changing anything
   - structural/codebase friction → architecture improvement task
   - clear scoped implementation → implement directly
6. After the durable outcome exists and has been verified:
   - fixed for good → resolve it, with a note naming where the fix lives
   - invalid, duplicate, or not worth acting on → remove it
7. Never resolve a papercut because you *plan* to fix it — resolve only after the fix is verified.

## Guardrails

- Treat every papercut as evidence, not truth. Do not change the repository merely because an agent complained.
- Do not force every papercut into a code fix.
- Prefer automation or guardrails over instructions when an agent should not have to remember something.
- Prefer concise instructions over broad policy.
- Do not leave a warning stranded only in the journal if future agents are unlikely to see it before the risky action.

## Output

Report each reviewed papercut as one of:

- repo changed
- workflow changed
- agent instruction added or refined
- guardrail added
- warning retained
- dismissed
- unresolved

For every addressed entry, state where the durable change now lives.
