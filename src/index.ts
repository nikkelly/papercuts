import type { Plugin, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { z } from "zod";
import { ok } from "../plugin/src/envelope.ts";
import {
  Journal,
  PapercutsError,
} from "../plugin/src/journal.ts";
import type { Fields } from "../plugin/src/schema.ts";
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

function toZod(fields: Fields): z.ZodRawShape {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(fields)) {
    let schema: z.ZodTypeAny;
    if (field.type === "number") {
      schema = z.number();
    } else if (field.enum) {
      schema = z.enum(field.enum as [string, ...string[]]);
    } else {
      schema = z.string();
    }
    if (field.description) schema = schema.describe(field.description);
    shape[key] = field.optional ? schema.optional() : schema;
  }
  return shape as z.ZodRawShape;
}

export const papercutsPlugin = (async () => {
  const registered = {} as ToolMap;
  for (const entry of tools) {
    (registered as Record<string, ToolDefinition>)[entry.name] = tool({
      description: entry.description,
      args: toZod(entry.args),
      async execute(args, context) {
        return run(() => entry.run(journalFor(context), args as never, {}));
      },
    });
  }
  return { tool: registered };
}) satisfies Plugin;

export default papercutsPlugin;
