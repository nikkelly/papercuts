# Argument surfaces left un-unified (survey only)

Papercuts exposes the same core actions (`add`, `list`, `resolve`, `remove`, `status`, `mute`) through three surfaces: the opencode plugin tools, the `papercuts` CLI (`bin/papercuts.mjs`), and the TUI widget. A review surveyed unifying these into one argument surface and explicitly chose **not to build it**: the three hosts have genuinely different argument-passing constraints (tool JSON schema, shell argv, internal function calls), and forcing one surface onto all three would add indirection with no user-visible gain.

Each surface stays thin and delegates to the same `Journal` modules, so behavior stays consistent without an imposed shared schema.

Status: accepted
