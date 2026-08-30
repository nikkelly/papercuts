---
name: papercuts
description: File and manage papercuts — small, concrete moments of workflow friction an agent hits while working (dead-end tool calls, broken links, misleading docs, footgun configs). Use when the agent hits friction it should log, or when asked to list, resolve, or remove papercuts.
---

# Papercuts

Papercuts live in an append-only journal, `.papercuts.jsonl`, at the repository root. The bundled CLI reads and writes it.

The CLI sits at `bin/papercuts.mjs` inside this plugin's folder — the directory containing this plugin's `.codex-plugin/plugin.json`, two levels up from this skill file. Run it with Node 23+ (Node 22 works with `--experimental-strip-types`):

```bash
node <plugin-root>/bin/papercuts.mjs <command> ...
```

## When to file

When you hit friction during work — a command that failed for a non-obvious reason, a doc that misled you, a missing helper, a footgun config — file it **at the moment it happens**, then push on without stopping:

```bash
node <plugin-root>/bin/papercuts.mjs add "what you hit and what would have prevented it" --tag <area> --agent codex
```

- `--tag`: short area label such as `tooling`, `docs`, `deps`
- `--severity`: `minor` (default) for annoyances, `major` for time sinks, `blocker` for hard walls
- `--cmd`/`--exit`: attach when filing a tool failure; never include secrets
- Always pass `--agent codex` so entries record their source

Do not change the repo just because something annoyed you; filing is evidence gathering.

## Reviewing

```bash
node <plugin-root>/bin/papercuts.mjs list                          # open entries, severity-first
node <plugin-root>/bin/papercuts.mjs list --status all             # include resolved
node <plugin-root>/bin/papercuts.mjs resolve <id-prefix> --note "where the fix lives" --agent codex
node <plugin-root>/bin/papercuts.mjs remove <id-prefix> --agent codex   # false positives only
```

Resolve only after the durable outcome exists and has been verified. For full triage methodology follow the `review-papercuts` skill.

## Muting the sidebar

The opencode TUI shows a PAPERCUTS section in the sidebar while friction is open. When
the user asks to quiet it (or you are told to toggle it), the state is per-repository
and shared through the journal:

```bash
node <plugin-root>/bin/papercuts.mjs status      # is the section muted?
node <plugin-root>/bin/papercuts.mjs mute        # hide it; journal keeps recording
node <plugin-root>/bin/papercuts.mjs unmute      # show it again
node <plugin-root>/bin/papercuts.mjs toggle      # flip whichever way it is
```

Muting is an operator preference, not evidence — only run these when the user asks.
Attribution: `--agent codex` is accepted here too, but the default is fine for mute
events.

## Output contract

Every command prints one JSON envelope on stdout: `{"ok":true,"data":...}` on success, `{"ok":false,"error":{"code","message"}}` on failure (with `candidates` listed when an ID prefix is ambiguous) (exit code 1 invalid input or usage, 2 not found or ambiguous ID prefix, 3 I/O error). Empty results are success.
