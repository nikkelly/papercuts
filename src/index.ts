import type { Plugin, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { ok } from "../plugin/src/envelope.ts";
import {
  Journal,
  PapercutsError,
} from "../plugin/src/journal.ts";
import { tools } from "../plugin/src/tools.ts";

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

type ToolName = (typeof tools)[number]["name"];
type ToolMap = { [K in ToolName]: ToolDefinition };

export const papercutsPlugin = (async () => {
  const registered = {} as ToolMap;
  for (const entry of tools) {
    (registered as Record<string, ToolDefinition>)[entry.name] = tool({
      description: entry.description,
      args: entry.args,
      async execute(args, context) {
        return run(() => entry.run(journalFor(context), args as never, {}));
      },
    });
  }
  return { tool: registered };
}) satisfies Plugin;

export default papercutsPlugin;
