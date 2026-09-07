# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**) — please do not open a public issue for
something you believe is exploitable. Include what you did, what you expected,
and what happened; a proof of concept helps but is not required.

You can expect an initial response within a few days and honest triage
thereafter: fixed, mitigated, or explained why it is out of scope.

## Scope

Papercuts is a local-first tool: it reads and writes an append-only journal
(`.papercuts.jsonl`) inside your repositories and runs entirely on your
machine.

- **No network.** Nothing phones home; there is no telemetry and no server.
- **No privilege escalation.** The installers only write to your own user
  config paths (`~/.config/opencode`, `~/.codex`, `~/.agents`,
  `~/.local/bin`) and the current project.
- **Evidence is stored verbatim.** `cmd`/`exitCode` fields are written as
  given — there is no secret redaction. Do not file papercuts containing
  tokens or credentials, and review the journal before committing it to a
  shared repository. See the security note in the [README](README.md).
- **Journal entries are agent-readable repo content.** In repositories you
  don't trust, treat journal entries like any other untrusted input.

Out of scope: vulnerabilities in the hosts papercuts runs inside (opencode,
Codex, Node.js) — report those upstream.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | yes |
| < 0.2.0 | no |
