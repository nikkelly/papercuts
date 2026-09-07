import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";

const MCP_PATH = fileURLToPath(new URL("../plugin/src/mcp.ts", import.meta.url));

function createTemporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-mcp-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

type Reply = { result?: unknown; error?: { code: number; message: string } };

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending = new Map<
    string,
    { resolve: (value: Reply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(directory: string) {
    this.child = spawn(process.execPath, [MCP_PATH], {
      cwd: directory,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PAPERCUTS_FILE: "",
        PAPERCUTS_START_DIR: directory,
        PAPERCUTS_MCP_AGENT: "codex",
      },
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim() !== "") this.onLine(line);
    }
  }

  private onLine(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const msg = message as { id?: unknown; result?: unknown; error?: { code: number; message: string } };
    const entry = this.pending.get(String(msg.id));
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(String(msg.id));
    if (msg.error) {
      entry.resolve({ error: msg.error });
    } else {
      entry.resolve({ result: msg.result });
    }
  }

  request(method: string, params?: unknown, timeoutMs = 5000): Promise<Reply> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }) + "\n",
      );
    });
  }

  kill() {
    this.child.kill();
  }
}

function textContent(result: unknown): string {
  const value = result as { content: { type: string; text: string }[] };
  assert.equal(Array.isArray(value.content), true);
  return value.content[0]!.text;
}

test("mcp initialize returns the protocol version, server info, and tools capability", async () => {
  const directory = createTemporaryRepository();
  const client = new McpClient(directory);
  try {
    const reply = await client.request("initialize");
    const result = reply.result as {
      protocolVersion: string;
      capabilities: { tools: { listChanged: boolean } };
      serverInfo: { name: string; version: string };
    };
    assert.equal(reply.error, undefined);
    assert.equal(result.protocolVersion, "2025-06-18");
    assert.equal(result.serverInfo.name, "papercuts");
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  } finally {
    client.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mcp tools/list advertises the six papercuts tools with object input schemas", async () => {
  const directory = createTemporaryRepository();
  const client = new McpClient(directory);
  try {
    const reply = await client.request("tools/list");
    const result = reply.result as { tools: { name: string; description: string; inputSchema: { type: string } }[] };
    assert.equal(reply.error, undefined);
    assert.equal(result.tools.length, 6);
    const add = result.tools.find((entry) => entry.name === "papercuts_add");
    assert.ok(add);
    assert.equal(add.inputSchema.type, "object");
  } finally {
    client.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mcp tools/call papercuts_add writes a codex-attributed cut and returns an ok envelope", async () => {
  const directory = createTemporaryRepository();
  const client = new McpClient(directory);
  try {
    const reply = await client.request("tools/call", {
      name: "papercuts_add",
      arguments: { text: "the docs pointed at the wrong command", tag: "docs" },
    });
    const result = reply.result as { isError?: boolean; content: { type: string; text: string }[] };
    assert.equal(reply.error, undefined);
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(textContent(reply.result));
    assert.deepEqual(parsed.ok, true);
    assert.equal(parsed.data.changed, true);

    const record = JSON.parse(readFileSync(join(directory, ".papercuts.jsonl"), "utf8").trim());
    assert.equal(record.kind, "cut");
    assert.equal(record.agent, "codex");
    assert.equal(record.text, "the docs pointed at the wrong command");
  } finally {
    client.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mcp tools/call with an empty text returns an invalid_argument error and creates no journal", async () => {
  const directory = createTemporaryRepository();
  const client = new McpClient(directory);
  try {
    const reply = await client.request("tools/call", {
      name: "papercuts_add",
      arguments: { text: "" },
    });
    const result = reply.result as { isError: boolean; content: { type: string; text: string }[] };
    assert.equal(reply.error, undefined);
    assert.equal(result.isError, true);
    const parsed = JSON.parse(textContent(reply.result));
    assert.deepEqual(parsed.ok, false);
    assert.equal(parsed.error.code, "invalid_argument");
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
  } finally {
    client.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mcp tools/call with an unknown tool name returns a JSON-RPC error", async () => {
  const directory = createTemporaryRepository();
  const client = new McpClient(directory);
  try {
    const reply = await client.request("tools/call", {
      name: "papercuts_bogus",
      arguments: {},
    });
    assert.equal(reply.result, undefined);
    assert.equal(reply.error!.code, -32602);
  } finally {
    client.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
