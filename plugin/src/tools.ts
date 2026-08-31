import type { Severity } from "./journal.ts";
import type { Journal } from "./journal.ts";
import { num, str, type Fields } from "./schema.ts";

export interface ToolContext {
  agent?: string;
}

export interface ToolEntry<TName extends string = string> {
  name: TName;
  description: string;
  args: Fields;
  run: (journal: Journal, args: Record<string, unknown>, context: ToolContext) => unknown;
}

export function defineTool<TName extends string>(
  name: TName,
  description: string,
  args: Fields,
  run: ToolEntry<TName>["run"],
): ToolEntry<TName> {
  return { name, description, args, run };
}

export const severities = ["minor", "major", "blocker"] as const;

export const tools = [
  defineTool(
    "papercuts_add",
    "File a papercut: friction you hit during work such as a dead-end tool call, broken link, misleading doc, or footgun config. File it at the moment it happens, then push on without stopping.",
    {
      text: str("What you hit and what would have prevented it, one sentence"),
      tag: str("Area label, e.g. tooling, docs", { optional: true }),
      severity: str("minor (default) for annoyances, major for time sinks, blocker for hard walls", {
        optional: true,
        enum: [...severities],
      }),
      cmd: str("The failed command, when filing a tool failure", { optional: true }),
      exitCode: num("Exit code of the failed command", { optional: true }),
    },
    (journal, args, context) =>
      journal.add({
        text: args.text as string,
        tag: args.tag as string | undefined,
        severity: args.severity as Severity | undefined,
        cmd: args.cmd as string | undefined,
        exitCode: args.exitCode as number | undefined,
        agent: context.agent,
      }),
  ),
  defineTool(
    "papercuts_list",
    "List logged papercuts for this repository, severity-first then newest. Use to review recurring friction before fixing root causes.",
    {
      status: str("Filter by status (default: open)", { optional: true, enum: ["open", "resolved", "all"] }),
      tag: str("Only entries with this tag", { optional: true }),
      severity: str("Only entries with this severity", { optional: true, enum: [...severities] }),
      limit: num("Maximum entries returned (default 20)", { optional: true }),
    },
    (journal, args, context) =>
      journal.list({
        status: args.status as "open" | "resolved" | "all" | undefined,
        tag: args.tag as string | undefined,
        severity: args.severity as Severity | undefined,
        limit: args.limit as number | undefined,
        agent: context.agent,
      }),
  ),
  defineTool(
    "papercuts_resolve",
    "Mark a papercut as fixed once its durable outcome exists and has been verified. Accepts a unique ID prefix (minimum 4 hex digits, optional pc_ prefix); run papercuts_list first if unsure.",
    {
      id: str("Papercut ID prefix, e.g. pc_9f2c41 or 9f2c41"),
      note: str("Where or how it was resolved", { optional: true }),
    },
    (journal, args, context) =>
      journal.resolve({
        idPrefix: args.id as string,
        note: args.note as string | undefined,
        agent: context.agent,
      }),
  ),
  defineTool(
    "papercuts_remove",
    "Remove a papercut that turned out to be invalid, a duplicate of another entry, or not worth acting on. Prefer papercuts_resolve when the problem was actually fixed.",
    {
      id: str("Papercut ID prefix, e.g. pc_9f2c41 or 9f2c41"),
    },
    (journal, args, context) =>
      journal.remove({
        idPrefix: args.id as string,
        agent: context.agent,
      }),
  ),
  defineTool(
    "papercuts_mute",
    "Hide the PAPERCUTS section in the opencode TUI sidebar for this repository until unmuted. Use when the user asks to quiet papercut reminders; the journal keeps recording.",
    {},
    (journal, _args, context) => journal.setMuted(true, { agent: context.agent }),
  ),
  defineTool(
    "papercuts_unmute",
    "Show the PAPERCUTS section in the opencode TUI sidebar again after a papercuts_mute.",
    {},
    (journal, _args, context) => journal.setMuted(false, { agent: context.agent }),
  ),
];