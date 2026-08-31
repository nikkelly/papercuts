import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { z } from "zod";
import { ok } from "../plugin/src/envelope.ts";
import {
  Journal,
  PapercutsError,
} from "../plugin/src/journal.ts";

function startDirectory(context: { worktree?: string; directory?: string }): string {
  const candidates = [context.directory, context.worktree];
  for (const candidate of candidates) {
    if (candidate && candidate.trim() !== "" && resolve(candidate) !== "/") {
      return candidate;
    }
  }
  return process.cwd();
}

function fail(error: unknown): never {
  if (error instanceof PapercutsError) {
    throw error;
  }
  throw new PapercutsError("io_error", String(error));
}

async function run(execute: () => unknown): Promise<string> {
  try {
    const result = await execute();
    return JSON.stringify(ok(result), null, 2);
  } catch (error) {
    return fail(error);
  }
}

function journalFor(context: { worktree?: string; directory?: string }): Journal {
  return Journal.open({ startDirectory: startDirectory(context) });
}

export const papercutsPlugin = (async () => ({
  tool: {
    papercuts_add: tool({
      description:
        "File a papercut: friction you hit during work such as a dead-end tool call, broken link, misleading doc, or footgun config. File it at the moment it happens, then push on without stopping.",
      args: {
        text: z
          .string()
          .describe(
            "What you hit and what would have prevented it, one sentence",
          ),
        tag: z.string().optional().describe("Area label, e.g. tooling, docs"),
        severity: z
          .enum(["minor", "major", "blocker"])
          .optional()
          .describe(
            "minor (default) for annoyances, major for time sinks, blocker for hard walls",
          ),
        cmd: z
          .string()
          .optional()
          .describe("The failed command, when filing a tool failure"),
        exitCode: z.number().optional().describe("Exit code of the failed command"),
      },
      async execute(args, context) {
        return run(() =>
          journalFor(context).add({
            text: args.text,
            tag: args.tag,
            severity: args.severity,
            cmd: args.cmd,
            exitCode: args.exitCode,
          }),
        );
      },
    }),
    papercuts_list: tool({
      description:
        "List logged papercuts for this repository, severity-first then newest. Use to review recurring friction before fixing root causes.",
      args: {
        status: z
          .enum(["open", "resolved", "all"])
          .optional()
          .describe("Filter by status (default: open)"),
        tag: z.string().optional().describe("Only entries with this tag"),
        severity: z
          .enum(["minor", "major", "blocker"])
          .optional()
          .describe("Only entries with this severity"),
        limit: z.number().optional().describe("Maximum entries returned (default 20)"),
      },
      async execute(args, context) {
        return run(() =>
          journalFor(context).list({
            status: args.status,
            tag: args.tag,
            severity: args.severity,
            limit: args.limit,
          }),
        );
      },
    }),
    papercuts_resolve: tool({
      description:
        "Mark a papercut as fixed once its durable outcome exists and has been verified. Accepts a unique ID prefix (minimum 4 hex digits, optional pc_ prefix); run papercuts_list first if unsure.",
      args: {
        id: z.string().describe("Papercut ID prefix, e.g. pc_9f2c41 or 9f2c41"),
        note: z.string().optional().describe("Where or how it was resolved"),
      },
      async execute(args, context) {
        return run(() =>
          journalFor(context).resolve({
            idPrefix: args.id,
            note: args.note,
          }),
        );
      },
    }),
    papercuts_remove: tool({
      description:
        "Remove a papercut that turned out to be invalid, a duplicate of another entry, or not worth acting on. Prefer papercuts_resolve when the problem was actually fixed.",
      args: {
        id: z.string().describe("Papercut ID prefix, e.g. pc_9f2c41 or 9f2c41"),
      },
      async execute(args, context) {
        return run(() =>
          journalFor(context).remove({
            idPrefix: args.id,
          }),
        );
      },
    }),
    papercuts_mute: tool({
      description:
        "Hide the PAPERCUTS section in the opencode TUI sidebar for this repository until unmuted. Use when the user asks to quiet papercut reminders; the journal keeps recording.",
      args: {},
      async execute(_args, context) {
        return run(() =>
          journalFor(context).setMuted(true),
        );
      },
    }),
    papercuts_unmute: tool({
      description:
        "Show the PAPERCUTS section in the opencode TUI sidebar again after a papercuts_mute.",
      args: {},
      async execute(_args, context) {
        return run(() =>
          journalFor(context).setMuted(false),
        );
      },
    }),
  },
})) satisfies Plugin;

export default papercutsPlugin;