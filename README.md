# papercuts

[![ci](https://github.com/nikkelly/papercuts/actions/workflows/ci.yml/badge.svg)](https://github.com/nikkelly/papercuts/actions/workflows/ci.yml)

A complaint box for coding agents — works with **opencode** and **Codex**, sharing one journal per repository.

Agents hit friction constantly — dead-end tool calls, broken links, misleading docs,
footgun configs — and silently push through. Papercuts gives them a one-call way to
file the complaint at the moment it happens, and a review workflow that turns validated
complaints into durable fixes. Inspired by [treygoff24/papercuts](https://github.com/treygoff24/papercuts).

## Quickstart

```bash
git clone https://github.com/nikkelly/papercuts.git ~/code/papercuts
cd ~/code/papercuts
npm run install:all
```

That installs for **both hosts and the CLI** in three idempotent steps — no `npm install`
needed, the installers are dependency-free and resolve their own paths. Then:

1. Paste the [agent instructions](#give-your-agents-the-pen) into your project's `AGENTS.md`
2. Restart opencode; start a new Codex session
3. Say *"file a papercut: the test runner only worked from apps/web"*
4. Confirm it landed: `papercuts list`

Only one host? `npm run install:all` skips hosts that aren't installed (look for
`SKIPPED` in the output) and exits clean. `npm run install:opencode` and
`npm run install:codex` install for a single host.

That's it — the journal is created on first write, no init step.

## Requirements

- **Node 22+** — the CLI and installers run on Node's built-in type stripping
- **git** — the journal is discovered at the repository root
- **macOS or Linux** for the CLI symlink (`~/.local/bin`); on Windows, run the CLI
  directly: `node <clone>/plugin/bin/papercuts.mjs`
- **opencode and/or Codex** — one is enough; the journal is shared

## Give your agents the pen

Agent behavior is driven by instructions, not by installation — paste this into your
project's `AGENTS.md`:

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

The first line works in both hosts with no placeholders — `install:all` puts the
`papercuts` command on PATH. In Codex you can also prefer the plugin's MCP tools
(`mcp__papercuts__add`) when they are available; the skills bundled with the plugin
explain the precedence.

Then periodically have an agent review the journal — "review papercuts" — fix root
causes, and resolve what's verified fixed.

## What you get

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

The same six actions are available three ways: opencode native tools, the Codex MCP
server (`mcp__papercuts__*`), and the zero-dependency CLI (`papercuts add|list|resolve|remove|mute|unmute|toggle|status`).
All of them write the same journal with the same attribution semantics — entries record
which host filed them (`opencode` or `codex`).

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
> review `.papercuts.jsonl` before committing it to a shared repository. Filed text is
> also plain repo content that agents read and act on: in repositories you don't trust,
> treat journal entries like any other untrusted input, and never file instructions you
> wouldn't want followed.

## Install for opencode

`npm run install:opencode` wires everything for opencode (run from the clone; add
`--global` to target `~/.config/opencode` instead of the current project). It copies
the plugin into `~/.local/share/papercuts/opencode/` — a stable location, independent
of your clone — and points your `opencode.json` (tools + skills) and
`.opencode/tui.json` (widget) there, preserving existing config keys and entries.
JSONC configs are left alone with an error message. Re-runs refresh the copies; the
config entries are written once, and if your clone moves or disappears they are healed
by re-running the installer.

Doing it by hand (if you cloned somewhere other than `~/code/papercuts`, substitute
your path — or prefer the installer, which resolves it for you):

```bash
git clone https://github.com/nikkelly/papercuts.git ~/code/papercuts
```

Add to your project's `opencode.json` (or `~/.config/opencode/opencode.json` to enable everywhere):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["~/code/papercuts/src/index.ts"],
  "skills": { "paths": ["~/code/papercuts/skills"] }
}
```

Only top-level `.ts`/`.js` files in `.opencode/plugin/` or `.opencode/plugins/` are
auto-discovered — subdirectories are not. For nested layouts (e.g.
`.opencode/plugins/my-plugin/index.ts`), list the file explicitly.

Restart opencode after changing plugins — config is loaded once at startup.

### The `papercuts` command

The CLI at `plugin/bin/papercuts.mjs` is zero-dependency and works on any machine with
Node 22+; it is the Codex-side surface and the terminal surface for opencode. Install it
once on your PATH (from a clone of this repo):

```bash
npm run install:cli
```

This installs a self-contained copy of the CLI to `~/.local/share/papercuts/` and links
`~/.local/bin/papercuts` to it — your clone's name and location are irrelevant, and the
command keeps working even if you delete the clone. Idempotent: re-run any time (that
is also how the command gets updated after a `git pull`). It refuses to clobber a
foreign file at the target; point it elsewhere with `PAPERCUTS_BIN_DIR`. The package is
not published to npm, and npm-style installs straight from GitHub (`npx github:…`) do
not work either: the CLI ships as plain TypeScript and Node refuses to type-strip
files inside `node_modules`. The git-clone + installer path (Quickstart above) is the
supported install.

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
`~/.config/opencode/tui.json` for everywhere) — `install:opencode` does this too:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["~/code/papercuts/src/tui.tsx"]
}
```

## Install for Codex (plugin)

`npm run install:codex` copies the plugin tree to `~/.codex/plugins/papercuts` and
registers it in your personal marketplace, headlessly (idempotent, safe to re-run).
If the `codex` CLI is not installed, it skips with a message instead of failing.

What the plugin bundles:

- An **MCP stdio server** (`plugin/.mcp.json` → `plugin/src/mcp.ts`) so a Codex session
  can call the same structured tools natively — `mcp__papercuts__add`, `mcp__papercuts__list`,
  `mcp__papercuts__resolve`, `mcp__papercuts__remove`, `mcp__papercuts__mute`,
  `mcp__papercuts__unmute` — with the same journal and attribution semantics as the CLI.
- **Two skills**: `papercuts` (capture) and `review-papercuts` (triage) — installed with
  the plugin, nothing extra to configure.
- The **zero-dependency CLI** (`bin/papercuts.mjs`), the standalone/CI surface.

Codex reads `AGENTS.md` natively; combined with the bundled skills it will file papercuts
as it works. Entries carry agent attribution so you can tell which host filed what.

> **Headless note:** interactive Codex sessions get the MCP tools automatically, but
> `codex exec` does not inject plugin MCP tools into the model's tool schema (an upstream
> Codex limitation). For headless and CI runs, use the bundled CLI — the shared
> `AGENTS.md` pen lines already stay CLI-based for exactly this reason.

### Public / shared repos (Git marketplace)

If the repo is public (or you're sharing with a team), register it as a marketplace and
install from it:

```bash
codex plugin marketplace add nikkelly/papercuts
# then: /plugins → Papercuts → install, and start a new session
```

### Updating the plugin

One flow for both hosts: `git pull && npm run install:all`, then restart opencode and
start a new Codex session. The installer refreshes every installed copy (the CLI
bundle, the opencode plugin, the Codex plugin) — your configs point at stable
locations and never need editing again, wherever the clone lives.

## Close the loop: review papercuts

Logging is only half the point. Both hosts ship a `review-papercuts` workflow that
triages the journal into durable fixes. The canonical methodology lives in the plugin's
skills dir and is shared by both hosts: `plugin/skills/review-papercuts/SKILL.md` is the
single source of truth, and the opencode copy in `skills/` is a thin wrapper around it.

- **opencode**: add the bundled skill directory to your config:
  ```json
  { "skills": { "paths": ["~/code/papercuts/skills"] } }
  ```
  Wrapper: [`skills/review-papercuts/SKILL.md`](skills/review-papercuts/SKILL.md) →
  canonical: [`plugin/skills/review-papercuts/SKILL.md`](plugin/skills/review-papercuts/SKILL.md).
- **Codex**: bundled in the plugin's `skills/review-papercuts` — installed with the plugin,
  nothing extra to configure.

Then ask an agent to "review papercuts" — it will dedupe entries, validate the friction
is real, turn each validated item into a repo change / workflow change / agent instruction /
guardrail, and only then resolve or remove.

## Development

```shell
npm install
npm test          # unit tests (node:test) + CLI tests + tool-surface evaluation
npm run typecheck # tsc --noEmit over src/, plugin/src/, scripts/, and test/
```

The tool-surface evaluation scenarios (parallel appends, corrupted journals, filter
combinations, and more) run as ordinary tests in `test/eval.test.ts`, so they are part
of `npm test` — there is no separate `npm run eval` step.

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
  `review-papercuts` is the canonical review methodology, with a thin opencode wrapper in `skills/`

Both adapters write identical `.papercuts.jsonl` records; entries record the filing agent.
A fix to the store lands in all hosts with one commit.

## Troubleshooting

- **Plugin not loading in opencode** — config is read once at startup; restart opencode
  after any config change.
- **`papercuts: command not found`** — re-run `npm run install:cli` and make sure
  `~/.local/bin` is on PATH (override the target with `PAPERCUTS_BIN_DIR`).
- **Moved, renamed, or deleted your clone?** Nothing breaks — the install lives in
  `~/.local/share/papercuts/` and `~/.codex/plugins/papercuts`, independent of the
  clone. To update it, run `git pull && npm run install:all` from wherever the clone
  now lives.
- **Journal landed in an unexpected place** — it anchors at the git repository root;
  set `PAPERCUTS_FILE` to pin a different path.
- **TUI section missing** — add `src/tui.tsx` to `.opencode/tui.json` (or run
  `npm run install:opencode`) and restart opencode.
- **`install:all` printed `SKIPPED`** — that host's CLI isn't installed; install it,
  then re-run `npm run install:opencode` or `npm run install:codex`.

## License

[MIT](LICENSE)
