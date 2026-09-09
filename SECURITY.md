# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting (**Security → Report a vulnerability**) — not a public issue. Include what you did and what happened; a proof of concept helps but isn't required. Expect an initial response within a few days.

## Scope

Papercuts is local-first: an append-only journal (`.papercuts.jsonl`) inside your repositories, no server, no telemetry, no network calls.

- The installers only write to your own user paths (`~/.config/opencode`, `~/.codex`, `~/.agents`, `~/.local/share/papercuts`, `~/.local/bin`) and the current project.
- `cmd`/`exitCode` evidence is stored verbatim — no secret redaction. Don't file secrets, and review the journal before committing it to shared repositories.
- Journal entries are agent-readable repo content; in repositories you don't trust, treat them like any other untrusted input.

Vulnerabilities in the hosts papercuts runs inside (opencode, Codex, Node.js) are out of scope — report those upstream.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | yes |
| < 0.2.0 | no |
