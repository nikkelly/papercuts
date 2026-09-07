import { createInterface } from "node:readline";
import { errorEnvelope, ok } from "./envelope.ts";
import { Journal, PapercutsError } from "./journal.ts";
import { toJsonSchema, validate } from "./schema.ts";
import { tools } from "./tools.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "papercuts";
const SERVER_VERSION = "0.2.0";

const startDirectory = process.env.PAPERCUTS_START_DIR?.trim() || process.cwd();
const agent = process.env.PAPERCUTS_MCP_AGENT?.trim() || "codex";

const journal = Journal.open({ startDirectory });
process.stderr.write(`papercuts mcp: journal target ${journal.path}\n`);

function send(id: unknown, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id: unknown, code: number, message: string): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
  );
}

function listTools(): unknown {
  return {
    tools: tools.map((entry) => ({
      name: entry.name,
      description: entry.description,
      inputSchema: toJsonSchema(entry.args),
    })),
  };
}

function callTool(name: string, args: unknown): unknown {
  const entry = tools.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new ToolNotFoundError(name);
  }
  const parsed = validate(entry.args, args ?? {});
  if (!parsed.success) {
    return operationError(
      new PapercutsError("invalid_argument", `invalid arguments: ${parsed.messages.join("; ")}`),
    );
  }
  try {
    const data = entry.run(journal, parsed.data, { agent });
    return {
      content: [{ type: "text", text: JSON.stringify(ok(data), null, 2) }],
    };
  } catch (error) {
    return operationError(error);
  }
}

function operationError(error: unknown): { isError: true; content: { type: "text"; text: string }[] } {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(errorEnvelope(error), null, 2) }],
  };
}

class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`unknown tool ${name}`);
    this.name = "ToolNotFoundError";
  }
}

function handle(message: unknown): { id: unknown; result: unknown } | { id: unknown; errorCode: number; errorMessage: string } | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const request = message as Record<string, unknown>;
  const id = request.id;
  const method = request.method;

  if (method === "initialize") {
    return {
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    };
  }
  if (method === "notifications/initialized") {
    return null;
  }
  if (method === "ping") {
    return { id, result: {} };
  }
  if (method === "tools/list") {
    return { id, result: listTools() };
  }
  if (method === "tools/call") {
    const params = (request.params ?? {}) as Record<string, unknown>;
    const name = typeof params.name === "string" ? params.name : "";
    try {
      return { id, result: callTool(name, params.arguments) };
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        return { id, errorCode: -32602, errorMessage: error.message };
      }
      return { id, result: operationError(error) };
    }
  }
  return { id, errorCode: -32601, errorMessage: `method not found: ${method}` };
}

function reply(frame: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return;
  }
  const outcome = handle(parsed);
  if (outcome === null) {
    return;
  }
  if ("result" in outcome) {
    send(outcome.id, outcome.result);
  } else {
    sendError(outcome.id, outcome.errorCode, outcome.errorMessage);
  }
}

const stdin = createInterface({ input: process.stdin });
stdin.on("line", reply);
stdin.on("close", () => process.exit(0));
