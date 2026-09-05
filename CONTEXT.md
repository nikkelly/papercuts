# Papercuts

A small plugin that records — in an append-only journal on disk — the "papercuts": moments of friction an agent hits while working, so they can be revisited and acted on later.

## Language

**Papercut**:
A single, concrete piece of friction an agent hit ("a dead-end tool call", "a misleading doc") and chose to record, tagged with a severity and an area. The canonical unit the whole repo is about.
_Avoid_: Bug, annoyance, TODO

**Journal**:
The append-only event store on disk (`.papercuts.jsonl`) plus the module that owns discovering, reading, appending to, and folding it. The single seam through which everyone — plugin tools, the TUI, and the CLI — records and reads papercuts.
_Avoid_: Store, log file, database

**Fold**:
The pure projection that reduces the journal's append-only events into the current snapshot: which papercuts are open, their severities, the resolved set, and the current mute state. The folder is the only part that reads meaning out of raw events.
_Avoid_: Aggregate, summarize

**Start directory**:
The directory from which Journal discovery begins, resolved by each host from its session context (opencode: session directory, then worktree, rejecting empty strings and the `/` root sentinel, falling back to the process working directory). Discovery itself then anchors at the git repository root.
_Avoid_: Root, cwd, base path

**Severity**:
The triage weight of a papercut: `minor`, `major`, or `blocker`. Drives what the TUI surfaces and the aggregate "level" reported.
_Avoid_: Priority, impact level

**Mute**:
An explicit per-repository switch that hides the papercuts UI without deleting history; recorded as its own event in the journal, last-writer-wins.
_Avoid_: Dismiss, silence, suppress
