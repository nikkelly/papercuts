import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { z } from "zod";
import {
  PapercutsError,
  addPapercut,
  listPapercuts,
  removePapercut,
  resolvePapercut,
} from "../plugin/src/store.ts";

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
        try {
          const result = addPapercut({
            text: args.text,
            tag: args.tag,
            severity: args.severity,
            cmd: args.cmd,
            exitCode: args.exitCode,
            startDirectory: startDirectory(context),
          });
          return JSON.stringify({ ok: true, ...result }, null, 2);
        } catch (error) {
          return fail(error);
        }
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
        try {
          const result = listPapercuts({
            status: args.status,
            tag: args.tag,
            severity: args.severity,
            limit: args.limit,
            startDirectory: startDirectory(context),
          });
          return JSON.stringify({ ok: true, ...result }, null, 2);
        } catch (error) {
          return fail(error);
        }
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
        try {
          const result = resolvePapercut({
            idPrefix: args.id,
            note: args.note,
            startDirectory: startDirectory(context),
          });
          return JSON.stringify({ ok: true, ...result }, null, 2);
        } catch (error) {
          return fail(error);
        }
      },
    }),
    papercuts_remove: tool({
      description:
        "Remove a papercut that turned out to be invalid, a duplicate of another entry, or not worth acting on. Prefer papercuts_resolve when the problem was actually fixed.",
      args: {
        id: z.string().describe("Papercut ID prefix, e.g. pc_9f2c41 or 9f2c41"),
      },
      async execute(args, context) {
        try {
          const result = removePapercut({
            idPrefix: args.id,
            startDirectory: startDirectory(context),
          });
          return JSON.stringify({ ok: true, ...result }, null, 2);
        } catch (error) {
          return fail(error);
        }
      },
    }),
  },
})) satisfies Plugin;

export default papercutsPlugin;