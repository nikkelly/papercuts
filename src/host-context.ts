import { resolve } from "node:path";

/**
 * The one policy for where Journal discovery starts in an opencode session:
 * prefer the session directory, then the worktree, rejecting empty strings
 * and the "/" root sentinel (a synthetic worktree that would otherwise send
 * discovery to /.papercuts.jsonl and find nothing). Both adapters — the tool
 * surface and the TUI widget — resolve through this module, so the sentinel
 * regression class is unrepresentable at either.
 */
export function startDirectory(context: { worktree?: string; directory?: string }): string {
  const candidates = [context.directory, context.worktree];
  for (const candidate of candidates) {
    if (candidate && candidate.trim() !== "" && resolve(candidate) !== "/") {
      return candidate;
    }
  }
  return process.cwd();
}
