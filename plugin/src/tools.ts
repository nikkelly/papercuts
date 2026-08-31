import { z } from "zod";
import type { Journal } from "./journal.ts";

export interface ToolContext {
  agent?: string;
}

export interface ToolEntry<TName extends string = string, TShape extends z.ZodRawShape = z.ZodRawShape> {
  name: TName;
  description: string;
  args: TShape;
  schema: z.ZodObject<TShape>;
  run: (journal: Journal, args: z.infer<z.ZodObject<TShape>>, context: ToolContext) => unknown;
}

export function defineTool<TName extends string, TShape extends z.ZodRawShape>(
  name: TName,
  description: string,
  args: TShape,
  run: ToolEntry<TName, TShape>["run"],
): ToolEntry<TName, TShape> {
  return { name, description, args, schema: z.object(args), run };
}

const severities = z.enum(["minor", "major", "blocker"]);

export const tools = [
  defineTool(
    "papercuts_add",
    "File a papercut: friction you hit during work such as a dead-end tool call, broken link, misleading doc, or footgun config. File it at the moment it happens, then push on without stopping.",
    {
      text: z.string().describe("What you hit and what would have prevented it, one sentence"),
      tag: z.string().optional().describe("Area label, e.g. tooling, docs"),
      severity: severities.optional().describe("minor (default) for annoyances, major for time sinks, blocker for hard walls"),
      cmd: z.string().optional().describe("The failed command, when filing a tool failure"),
      exitCode: z.number().optional().describe("Exit code of the failed command"),
    },
    (journal, args, context) =>
      journal.add({
        text: args.text,
        tag: args.tag,
        severity: args.severity,
        cmd: args.cmd,
        exitCode: args.exitCode,
        agent: context.agent,
      }),
  ),
  defineTool(
    "papercuts_list",
    "List logged papercuts for this repository, severity-first then newest. Use to review recurring friction before fixing root causes.",
    {
      status: z.enum(["open", "resolved", "all"]).optional().describe("Filter by status (default: open)"),
      tag: z.string().optional().describe("Only entries with this tag"),
      severity: severities.optional().describe("Only entries with this severity"),
      limit: z.number().optional().describe("Maximum entries returned (default 20)"),
    },
    (journal, args, context) =>
      journal.list({
        status: args.status,
        tag: args.tag,
        severity: args.severity,
        limit: args.limit,
        agent: context.agent,
      }),
  ),
  defineTool(
    "papercuts_resolve",
    "Mark a papercut as fixed once its durable outcome exists and has been verified. Accepts a unique ID prefix (minimum 4 hex digits, optional pc_ prefix); run papercuts_list first if unsure.",
    {
      id: z.string().describe("Papercut ID prefix, e.g. pc_9f2c41 or 9f2c41"),
      note: z.string().optional().describe("Where or how it was resolved"),
    },
    (journal, args, context) =>
      journal.resolve({
        idPrefix: args.id,
        note: args.note,
        agent: context.agent,
      }),
  ),
  defineTool(
    "papercuts_remove",
    "Remove a papercut that turned out to be invalid, a duplicate of another entry, or not worth acting on. Prefer papercuts_resolve when the problem was actually fixed.",
    {
      id: z.string().describe("Papercut ID prefix, e.g. pc_9f2c41 or 9f2c41"),
    },
    (journal, args, context) =>
      journal.remove({
        idPrefix: args.id,
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
