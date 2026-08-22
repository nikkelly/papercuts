# opencode-papercuts

A complaint box for coding agents — works with **opencode** and **Codex**, sharing one journal per repository.

Agents hit friction constantly — dead-end tool calls, broken links, misleading docs,
footgun configs — and silently push through. Papercuts gives them a one-call way to
file the complaint at the moment it happens, and a review workflow that turns validated
complaints into durable fixes. Inspired by [treygoff24/papercuts](https://github.com/treygoff24/papercuts).

## Quickstart

1. Install for your agent ([opencode](#install-for-opencode) or [Codex](#install-for-codex-plugin))
2. Add the [agent instructions](#give-your-agents-the-pen) to your project's `AGENTS.md`
3. In a new session, say: *"file a papercut: the test runner only worked from apps/web"*
4. Confirm it landed: `cat .papercuts.jsonl`

That's it — the journal is created on first write, no init step.

## Tools

| Tool | Purpose |
| --- | --- |
| `papercuts_add` | File a papercut (text, optional tag/severity/failed-command evidence). Duplicate-safe by content-addressed ID. |
| `papercuts_list` | List entries, severity-first then newest, with status/tag/severity filters and limit metadata. |
| `papercuts_resolve` | Mark a papercut fixed once its durable outcome exists and is verified (unique ID prefix, min 4 hex chars). |
| `papercuts_remove` | Drop false positives and duplicates from the queue. |

## Storage

An append-only JSONL journal — `.papercuts.jsonl` at the repository root by default, so
complaints show up in `git diff` and travel with the repo. No server, no telemetry.

- **Discovery order**: `PAPERCUTS_FILE` env → `<git root>/.papercuts.jsonl` → the current
  directory when outside any repository. Papercuts are repository-specific friction;
  there is deliberately no global log, so complaints never mix across codebases.
- **Never rewrites history**: resolve/remove are appended events; the fold tolerates torn
  final lines, malformed lines, duplicates, and orphan events with surfaced warnings.
- **Content-addressed IDs** (`pc_` + 12 hex of SHA-256 over text/severity/tags)
  make `add` duplicate-safe across sessions and across hosts: the same friction filed
  twice becomes one entry, attributed to the first filer.
- A removed papercut can be re-added later; the newer cut supersedes the remove event.

> **Security note:** `cmd`/`exitCode` evidence is stored verbatim — there is no secret
> redaction. Do not file papercuts with commands containing tokens or credentials, and
> review `.papercuts.jsonl` before committing it to a shared repository.

## Install for opencode

This project lives on GitHub and is not published to npm — clone it somewhere stable
and point your config at the file:

```bash
git clone https://github.com/nikkelly/opencode-papercuts.git ~/code/opencode-papercuts
```

Add to your project's `opencode.json` (or `~/.config/opencode/opencode.json` to enable everywhere):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["~/code/opencode-papercuts/src/index.ts"]
}
```

Only top-level `.ts`/`.js` files in `.opencode/plugin/` or `.opencode/plugins/` are
auto-discovered — subdirectories are not. For nested layouts (e.g.
`.opencode/plugins/my-plugin/index.ts`), list the file explicitly:

```json
{
  "plugin": [".opencode/plugins/my-plugin/index.ts"]
}
```

Restart opencode after changing plugins — config is loaded once at startup.

The review skill ships in `skill/`; add its path under `"skills": {"paths": [...]}`.

## Install for Codex (plugin)

The same journal works in Codex through a skills-based plugin — no MCP server, no npm.
The plugin bundles two skills (`papercuts` for capture, `review-papercuts` for triage)
and a zero-dependency CLI (`bin/papercuts.mjs`) that both hosts' agents can drive.

Register this repo as a marketplace and install:

```bash
codex plugin marketplace add nikkelly/opencode-papercuts
# then: /plugins → Papercuts → install, and start a new session
```

For local testing without git, copy `plugin/` into `~/.codex/plugins/papercuts` and add
a personal marketplace entry at `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "personal",
  "plugins": [
    {
      "name": "papercuts",
      "source": { "source": "local", "path": "./.codex/plugins/papercuts" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer tools"
    }
  ]
}
```

Codex reads `AGENTS.md` natively; combined with the bundled skills it will file papercuts
as it works. Entries carry agent attribution (`--agent codex`) so you can tell which host
filed what. Requires Node 23+ on PATH for type-stripped execution of the CLI.

## Close the loop: review papercuts

Logging is only half the point. Both hosts ship a `review-papercuts` workflow that
triages the journal into durable fixes.

- **opencode**: the bundled skill directory — add to your config:
  ```json
  { "skills": { "paths": ["~/code/opencode-papercuts/skill"] } }
  ```
  Methodology: [`skill/review-papercuts/SKILL.md`](skill/review-papercuts/SKILL.md).
- **Codex**: bundled in the plugin's `skills/review-papercuts` — installed with the plugin,
  nothing extra to configure.

Then ask an agent to "review papercuts" — it will dedupe entries, validate the friction
is real, turn each validated item into a repo change / workflow change / agent instruction /
guardrail, and only then resolve or remove.

## Give your agents the pen

Agent behavior is driven by instructions, not by installation — paste this into your
project's `AGENTS.md` (both hosts read it; keep both lines so either host knows its path):

```
## Papercuts

When you hit friction during work — a dead-end tool call, a broken link, a misleading
doc, a footgun config — file it before moving on, then push on. Don't stop working.

- In opencode, use the native tool:
      papercuts_add(text="what you hit and what would have prevented it", tag="<area>")
- In Codex, use the bundled plugin CLI:
      node <plugin-root>/bin/papercuts.mjs add "what you hit and what would have prevented it" --tag <area> --agent codex

Severity: minor (default) for annoyances, major for time sinks, blocker for hard walls.
Attach cmd/exitCode when filing tool failures. Never include secrets.
```

Then periodically have an agent review the journal — "review papercuts" — fix root
causes, and resolve what's verified fixed.

## Development

```shell
npm install
npm test          # unit tests (node:test) + CLI tests
npm run typecheck # tsc --noEmit
npm run eval      # end-to-end evaluation through the opencode plugin tool surface
```

### Architecture

One shared journal core, thin host adapters:

- `plugin/src/store.ts` — canonical store: discovery, content-addressed IDs, tolerant fold
- `src/index.ts` — opencode adapter (native tools via `@opencode-ai/plugin`)
- `plugin/bin/papercuts.mjs` + `plugin/skills/` — Codex adapter (skills-guided CLI)

Both adapters write identical `.papercuts.jsonl` records; entries record the filing agent.
A fix to the store lands in both hosts with one commit.
