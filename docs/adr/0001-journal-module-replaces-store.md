# Journal module replaces the fused store

The former `plugin/src/store.ts` fused path discovery, string-hacking of journal lines, storage I/O, and the fold that turns raw events into a status. We ran an architecture review and replaced it with a single deep module, `plugin/src/journal.ts` (`Journal.open(...)` with `add`, `list`, `resolve`, `remove`, `setMuted`, `status`, `preview`).

This is a full replace with **no compatibility wrapper**: `store.ts` and its test were deleted, not demoted to a facade. We deliberately keep storage I/O **and** the fold behind one seam rather than splitting them, because discovery + persistence + projection all serve the same callers and splitting would add plumbing without reducing what any caller needs to know. The fold is exported as the pure, injectable `fold(bytes)` so it stays harness-testable and hard-reversed.

Status: accepted
