# opencode-papercuts

A complaint box for coding agents — works with **opencode** and **Codex**, sharing one journal per repository.

Agents hit friction constantly — dead-end tool calls, broken links, misleading docs,
footgun configs — and silently push through. Papercuts gives them a one-call way to
file the complaint at the moment it happens, and a review workflow that turns validated
complaints into durable fixes. Inspired by [treygoff24/papercuts](https://github.com/treygoff24/papercuts).

## Quickstart

1. Install for your agent ([opencode](#install-for-opencode) or [Codex](#install-for-codex-plugin)) —
   or run the [one-command full install](#one-command-full-install) which does both hosts and the CLI.
2. Put the `papercuts` command on PATH — `npm run install:cli` in this repo (idempotent;
   also run automatically by `npm run install:codex`). Optional, but lets any shell, and
   either host, use `papercuts add|list|resolve|remove|mute|status` directly.
3. Add the [agent instructions](#give-your-agents-the-pen) to your project's `AGENTS.md`
4. In a new session, say: *"file a papercut: the test runner only worked from apps/web"*
5. Confirm it landed: `cat .papercuts.jsonl`

That's it — the journal is created on first write, no init step.

## One-command full install

From a clone of this repo, install for **both hosts and the CLI** in one shot:

```bash
npm run install:all
```

Run from any project directory — or target opencode's global config instead of the
current project with `--global`:

```bash
node ~/code/opencode-papercuts/scripts/install-all.mjs --global
```

The three steps, each idempotent and safe to re-run:

1. **opencode** (`install:opencode`) — merges `src/index.ts` and `skill/` into the
   project's `opencode.json` (or `~/.config/opencode/` with `--global`), and `src/tui.tsx`
   into `.opencode/tui.json` (or `~/.config/opencode/tui.json`). Existing config keys and
   plugin entries are preserved; JSONC configs are left alone with an error message.
2. **CLI** (`install:cli`) — links the `papercuts` command into `~/.local/bin`.
3. **Codex** (`install:codex`) — copies the plugin tree to `~/.codex/plugins/papercuts`
   and registers it in your personal marketplace.

Then restart opencode and start a new Codex session. The individual steps are also
exposed as `npm run install:opencode`, `install:cli`, and `install:codex`.

## Tools

| Tool | Purpose |
| --- | --- |
| `papercuts_add` | File a papercut (text, optional tag/severity/failed-command evidence). Duplicate-safe by content-addressed ID. |
| `papercuts_list` | List entries, severity-first then newest, with status/tag/severity filters and limit metadata. |
| `papercuts_resolve` | Mark a papercut fixed once its durable outcome exists and is verified (unique ID prefix, min 4 hex chars). |
| `papercuts_remove` | Drop false positives and duplicates from the queue. |
| `papercuts_mute` | Hide the PAPERCUTS section in the opencode TUI sidebar for this repository until unmuted; the journal keeps recording. |
| `papercuts_unmute` | Show the PAPERCUTS section again after a mute. |

Every surface emits the same envelope: success is `{"ok":true,"data":{...}}`, failure is
`{"ok":false,"error":{"code","message"[,"candidates"]}}` (the opencode tools throw errors
instead of emitting `ok:false`, which opencode renders natively). The CLI maps error codes
to exit codes: 1 invalid input or usage, 2 not found or ambiguous ID prefix, 3 I/O error.

## Storage

An append-only JSONL journal — `.papercuts.jsonl` at the repository root by default, so
complaints show up in `git diff` and travel with the repo. No server, no telemetry.

- **Discovery order**: `PAPERCUTS_FILE` env → `<git root>/.papercuts.jsonl` → the current
  directory when outside any repository. Papercuts are repository-specific friction;
  there is deliberately no global log, so complaints never mix across codebases.
- **Never rewrites history**: resolve/remove/mute/unmute are appended events; the fold
  tolerates torn final lines, malformed lines, duplicates, and orphan events with
  surfaced warnings.
- **Content-addressed IDs** (`pc_` + 12 hex of SHA-256 over text/severity/tags)
  make `add` duplicate-safe across sessions and across hosts: the same friction filed
  twice becomes one entry, attributed to the first filer.
- A removed papercut can be re-added later; the newer cut supersedes the remove event.

> **Security note:** `cmd`/`exitCode` evidence is stored verbatim — there is no secret
> redaction. Do not file papercuts with commands containing tokens or credentials, and
> review `.papercuts.jsonl` before committing it to a shared repository.

## Install for opencode

This project lives on GitHub and is not published to npm — clone it somewhere stable
and point your config at the file. From the clone, `npm run install:opencode` does this
wiring for you (current project; `--global` for `~/.config/opencode`); doing it by hand:

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

The review skill ships in `skill/` — an opencode wrapper whose canonical methodology
lives in the plugin's skills dir (see [Close the loop](#close-the-loop-review-papercuts));
add its path under `"skills": {"paths": [...]}`.

### The `papercuts` command

The CLI at `plugin/bin/papercuts.mjs` is zero-dependency and works on any machine with
Node 23+; it is the Codex-side surface and the terminal surface for opencode. Install it
once on your PATH (from a clone of this repo):

```bash
npm run install:cli
```

This creates `~/.local/bin/papercuts` as a symlink to the repo copy (so `git pull` keeps
the command fresh — no reinstall needed). Idempotent: re-run any time. It refuses to
clobber a non-papercuts file at the target; point it elsewhere with `PAPERCUTS_BIN_DIR`.
`npm run install:codex` runs the same step for you. `npm link` / `npm install -g .` /
`npx papercuts` also work, via the `bin` entry in package.json.

### TUI sidebar widget

The repo also ships a TUI plugin that makes friction visible at a glance: a PAPERCUTS
section in the right sidebar (next to Context and LSP) showing the open count, how many
were filed today, and a severity breakdown when majors or blockers are open. It hides
with the sidebar on narrow windows and disappears entirely when there is nothing open.

Color escalates with friction — muted normally, warning at three filed today (or two
open majors), error while any blocker is open. Collapse works like the built-in Todo
section: click the title to toggle; the chevron appears only above two open entries.

**Muting.** When the section gets noisy you can hide it without stopping the journal:
run the `Papercuts: Toggle sidebar` command (command palette, or `ctrl+x p`). A mute is
an append-only `mute`/`unmute` event in the journal, so the state is per-repository,
survives restarts, and is shared with the Codex CLI (`papercuts mute|unmute|toggle|status`).
Muted sections stay hidden even while agents keep filing.

Enable it by listing the TUI module in `.opencode/tui.json` (or
`~/.config/opencode/tui.json` for everywhere):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["~/code/opencode-papercuts/src/tui.tsx"]
}
```

## Install for Codex (plugin)

The same journal works in Codex through a plugin that bundles an MCP server and two skills
(`papercuts` for capture, `review-papercuts` for triage), plus a zero-dependency CLI
(`bin/papercuts.mjs`).

**Codex MCP tools.** The plugin ships an MCP stdio server (`plugin/.mcp.json` →
`plugin/src/mcp.ts`) so a Codex session can call the same structured tools natively — they
surface as `mcp__papercuts__add`, `mcp__papercuts__list`, `mcp__papercuts__resolve`,
`mcp__papercuts__remove`, `mcp__papercuts__mute`, and `mcp__papercuts__unmute`. These write
and read the same journal with the same `--agent codex` attribution semantics as the CLI.
The CLI remains the standalone/CI surface and stays the line the shared `AGENTS.md` pen uses
for Codex, so instructions never hardcode `mcp__` names that vanish when the plugin is absent.

Beyond `add`/`list`/`resolve`/`remove`, the CLI shares the TUI mute state:
`papercuts mute|unmute|toggle` hide or show the opencode sidebar section for the
repository, and `papercuts status` reports it.

Codex reads `AGENTS.md` natively; combined with the bundled skills it will file papercuts
as it works. Entries carry agent attribution (`--agent codex`) so you can tell which host
filed what. Requires Node 23+ on PATH for type-stripped execution of the CLI.

### Public / shared repos (Git marketplace)

If the repo is public (or you're sharing with a team), register it as a marketplace and
install from it:

```bash
codex plugin marketplace add nikkelly/opencode-papercuts
# then: /plugins → Papercuts → install, and start a new session
```

### Private / local development (one-command installer)

If the repo is private — or you're hacking on this plugin locally — don't register a
public marketplace. Use the bundled installer, which keeps everything offline on your
machine:

```bash
npm run install:codex
```

That single command (idempotent — safe to re-run):

1. copies the `plugin/` tree to `~/.codex/plugins/papercuts`,
2. ensures a `local` source entry in your personal marketplace
   (`~/.agents/plugins/marketplace.json`, merging, never clobbering other entries),
3. registers the `personal` marketplace if it isn't already listed,
4. (re)installs `papercuts@personal` headlessly — no `/plugins` menu needed,
5. prints the resolved CLI path and the exact `AGENTS.md` pen line to paste.

Then start a new Codex session. The installer only targets the Codex CLI config;
it does not touch the opencode side.

### Updating the plugin

The two hosts update differently, because opencode loads live while Codex copies:

- **opencode**: `git pull`, then restart opencode. Config points straight at
  `src/index.ts`, so `git pull` + restart is all it takes — no reinstall step.
- **Codex**: `git pull`, then re-run `npm run install:codex` (it reinstalls,
  refreshing the installed copy), then start a new session.

For a locally developed plugin like this one that both hosts use, the whole loop is
`git pull && npm run install:codex` on the Codex side, and just `git pull` + restart on
the opencode side.

## Close the loop: review papercuts

Logging is only half the point. Both hosts ship a `review-papercuts` workflow that
triages the journal into durable fixes. The canonical methodology lives in the plugin's
skills dir and is shared by both hosts: `plugin/skills/review-papercuts/SKILL.md` is the
single source of truth, and the opencode copy in `skill/` is a thin wrapper around it.

- **opencode**: the bundled skill directory — add to your config:
  ```json
  { "skills": { "paths": ["~/code/opencode-papercuts/skill"] } }
  ```
  Wrapper: [`skill/review-papercuts/SKILL.md`](skill/review-papercuts/SKILL.md) →
  canonical: [`plugin/skills/review-papercuts/SKILL.md`](plugin/skills/review-papercuts/SKILL.md).
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

MANDATORY: whenever a command you ran fails unexpectedly — a nonzero exit you could not
have predicted from the task — you MUST call out before doing anything else, then push
on without stopping. Same for broken links, misleading docs, and footgun configs:

- In opencode, use the native tool:
      papercuts_add(text="what you hit and what would have prevented it", tag="<area>")
- In Codex, use the bundled plugin CLI:
      node <plugin-root>/bin/papercuts.mjs add "what you hit and what would have prevented it" --tag <area> --agent codex

Do not file failures that ARE the assigned task itself (e.g. a test you were told to fix).
Severity: minor (default) for annoyances, major for time sinks, blocker for hard walls.
Never include secrets.
```

Then periodically have an agent review the journal — "review papercuts" — fix root
causes, and resolve what's verified fixed.

> **Codex path hint:** in the snippet above, replace `<plugin-root>` with the actual path.
> If you installed via `npm run install:codex`, that command prints the exact pen line
> (resolved to `~/.codex/plugins/papercuts`) for you to paste. If you ran
> `npm run install:cli`, the `papercuts` command is on PATH and the short pen works in
> either host: `papercuts add "<text>" --tag <area> --agent codex`.

## Development

```shell
npm install
npm test          # unit tests (node:test) + CLI tests + tool-surface evaluation
npm run typecheck # tsc --noEmit over src/, plugin/src/, scripts/, and test/
```

The tool-surface evaluation scenarios (parallel appends, corrupted journals, filter
combinations, and more) run as ordinary tests in `test/eval.test.ts`, so they are part
of `npm test` — there is no separate `npm run eval` step anymore.

### Behavioral evaluation (trigger rate)

`npm test` proves the tools do what they're told; `npm run eval:behavioral`
proves the agent doesn't call them too often. It drives real headless sessions
(`opencode run --auto`) against disposable fixture repositories — some seeded with
genuine friction, some deliberately clean — then grades `.papercuts.jsonl` and the
session's tool-call telemetry:

- **clean** sessions must file nothing; more than one spurious filing across all
  clean runs fails the over-triggering gate.
- **friction** sessions (broken cwd-dependent script, dead README command, build
  broken during an unrelated task) must produce at least one standing filing.
- **ambiguous** sessions (the failing test *is* the task) must not leave assigned
  work filed as open friction.

```shell
PAPERCUTS_EVAL_MODEL=anthropic/claude-sonnet-4-20250514 npm run eval:behavioral
# options: --only=<substring>  --repeat=<n>  --keep   (keeps fixtures for debugging)
```

Sessions cost tokens and are nondeterministic, so this is a gated statistical check,
not part of `npm test`. Configure a provider with `opencode auth` first, or pin a
model with `PAPERCUTS_EVAL_MODEL`; per-run timeout via `PAPERCUTS_EVAL_TIMEOUT_MS`.

### Architecture

One shared journal core, thin host adapters:

- `plugin/src/tools.ts` — shared tool contracts (name, description, zod args, run handler) for the six papercuts tools, written once and registered by both adapters
- `plugin/src/journal.ts` — the journal module: path discovery, content-addressed IDs, tolerant fold, and the mutable operations behind a single `Journal.open()` seam
- `plugin/src/envelope.ts` — shared output contract: `{ok:true,data}` on success,
  `{ok:false,error:{code,message,candidates?}}` on failure, and the CLI exit-code mapping
- `src/index.ts` — opencode adapter (native tools via `@opencode-ai/plugin`)
- `src/tui.tsx` + `src/tui-stats.ts` — opencode TUI sidebar widget (reads the same journal)
- `plugin/src/mcp.ts` — Codex MCP adapter (zero-dependency stdio MCP server over the shared tools, agent defaults to `codex`)
- `plugin/bin/papercuts.mjs` + `plugin/skills/` — Codex CLI + skill adapter (skills-guided CLI);
  `review-papercuts` is the canonical review methodology, with a thin opencode wrapper in `skill/`

Both adapters write identical `.papercuts.jsonl` records; entries record the filing agent.
A fix to the store lands in all hosts with one commit.
