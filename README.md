# papercuts

[![ci](https://github.com/nikkelly/papercuts/actions/workflows/ci.yml/badge.svg)](https://github.com/nikkelly/papercuts/actions/workflows/ci.yml)

A complaint box for coding agents — works with **opencode** and **Codex**, sharing one journal per repository.

Agents hit friction constantly — dead-end tool calls, broken links, misleading docs, footgun configs — and push through silently. Papercuts gives them a one-call way to file the complaint at the moment it happens, and a review workflow that turns validated complaints into fixes. Inspired by [treygoff24/papercuts](https://github.com/treygoff24/papercuts).

## Quickstart

```bash
git clone https://github.com/nikkelly/papercuts.git ~/code/papercuts
cd ~/code/papercuts
npm run install:all
```

One command installs everything — no `npm install` needed. Then:

1. Paste the [agent instructions](#give-your-agents-the-pen) into your project's `AGENTS.md`
2. Restart opencode; start a new Codex session
3. Say *"file a papercut: the test runner only worked from apps/web"*
4. Confirm it landed: `papercuts list`

Only one host? Missing hosts are skipped (`SKIPPED` in the output) and the exit is clean. `npm run install:opencode`, `install:cli`, and `install:codex` install one piece at a time.

## Requirements

- Node 22+
- git — the journal anchors at the repository root
- macOS or Linux for the CLI symlink; on Windows, run `node <clone>/plugin/bin/papercuts.mjs` directly
- opencode and/or Codex

## Give your agents the pen

Paste this into your project's `AGENTS.md`:

```
## Papercuts

MANDATORY: whenever a command you ran fails unexpectedly — a nonzero exit you could not
have predicted from the task — you MUST call out before doing anything else, then push
on without stopping. Same for broken links, misleading docs, and footgun configs:

- If the `papercuts` command is on PATH, use it (works in either host):
      papercuts add "what you hit and what would have prevented it" --tag <area> --agent codex
- In opencode, the native tool also works:
      papercuts_add(text="what you hit and what would have prevented it", tag="<area>")
- In Codex with the plugin installed:
      node <plugin-root>/bin/papercuts.mjs add "..." --tag <area> --agent codex

Do not file failures that ARE the assigned task itself (e.g. a test you were told to fix).
Severity: minor (default) for annoyances, major for time sinks, blocker for hard walls.
Never include secrets.
```

Then periodically ask an agent to "review papercuts" — see [Review](#review-papercuts).

## Using it

Six tools, available as opencode native tools, Codex MCP tools (`mcp__papercuts__*`), and CLI commands (`papercuts add|list|resolve|remove|mute|unmute|toggle|status`). All write the same journal; entries record which host filed them.

| Action | Purpose |
| --- | --- |
| `add` | File a papercut (text, optional tag/severity, failed-command evidence). Duplicate-safe. |
| `list` | List entries, severity-first then newest; filter by status/tag/severity. |
| `resolve <id>` | Mark fixed once the durable outcome exists and is verified. |
| `remove <id>` | Drop false positives and duplicates. |
| `mute` / `unmute` | Hide the opencode TUI sidebar section; the journal keeps recording. |
| `status` | Is the sidebar muted? |

## Storage

Append-only JSONL at `.papercuts.jsonl` in the repository root — complaints show up in `git diff` and travel with the repo. `PAPERCUTS_FILE` overrides the location. Adds are content-addressed, so filing the same friction twice is a no-op; resolve/remove/mute are appended events, and the journal is never rewritten.

> **Security:** `cmd`/`exitCode` evidence is stored verbatim — no secret redaction. Don't file commands containing tokens or credentials, and review the journal before committing it to a shared repository. Journal entries are plain repo content that agents read and act on.

## Install for opencode

`npm run install:opencode` copies the plugin to `~/.local/share/papercuts/opencode/` and wires your `opencode.json` (tools + skills) and `.opencode/tui.json` (widget). `--global` targets `~/.config/opencode/` instead of the current project. Existing config entries are preserved; JSONC configs are skipped with an error. Restart opencode after changes.

## The `papercuts` command

`npm run install:cli` installs a self-contained copy to `~/.local/share/papercuts/` and links `~/.local/bin/papercuts`. Node 22+, macOS or Linux (`PAPERCUTS_BIN_DIR` overrides the target). The clone's name and location don't matter — the command survives moving, renaming, or deleting the clone.

npm-based installs from GitHub (`npx github:…`) don't work: the CLI is plain TypeScript and Node won't type-strip inside `node_modules`.

## Install for Codex

`npm run install:codex` copies the plugin to `~/.codex/plugins/papercuts` and installs it through your personal marketplace — headless and idempotent; skips cleanly if `codex` isn't installed. Bundles the MCP server, the two skills, and the CLI.

`codex exec` does not inject plugin MCP tools — for headless and CI runs, use the CLI.

Public repo? Install via the git marketplace instead:

```bash
codex plugin marketplace add nikkelly/papercuts
# then: /plugins → Papercuts → install, and start a new session
```

## Updating

```bash
git pull && npm run install:all
```

Refreshes every installed copy (CLI bundle, opencode plugin, Codex plugin). Configs point at stable locations and never need editing again, wherever your clone lives.

## Review papercuts

Ask an agent to "review papercuts" — it dedupes entries, validates the friction is real, turns each validated item into a fix, and only then resolves or removes.

## Development

```shell
npm install
npm test
npm run typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the behavioral evaluation and architecture notes.

## Troubleshooting

- **Plugin not loading in opencode** — config loads once at startup; restart after changes.
- **`papercuts: command not found`** — re-run `npm run install:cli`; make sure `~/.local/bin` is on PATH.
- **Moved or deleted your clone?** Nothing breaks. Re-run `npm run install:all` from the new location to update.
- **Journal in an unexpected place** — it anchors at the git root; set `PAPERCUTS_FILE` to pin a path.
- **TUI section missing** — run `npm run install:opencode` and restart opencode.
- **`SKIPPED` in the install output** — that host isn't installed or needs Node 22+; fix and re-run.

## License

[MIT](LICENSE)
