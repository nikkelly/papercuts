import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

import papercutsPlugin from "../src/index.ts";

function createTemporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-eval-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

function makeContext(directory: string) {
  return {
    sessionID: "eval-session",
    messageID: "eval-message",
    agent: "build",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  } as never;
}

const plugin = await papercutsPlugin();
const tools = plugin.tool;
assert.ok(tools, "plugin must register tools");

test("ambiguous prefix surfaces candidates instead of guessing", async () => {
  const directory = createTemporaryRepository();
  const log = join(directory, ".papercuts.jsonl");
  const lines = [
    { kind: "cut", id: "pc_111100000000", ts: "2026-08-01T00:00:00.000Z", agent: "opencode", text: "a", tags: [], severity: "minor", cwd: directory, repo: directory },
    { kind: "cut", id: "pc_1111ffffffff", ts: "2026-08-02T00:00:00.000Z", agent: "opencode", text: "b", tags: [], severity: "minor", cwd: directory, repo: directory },
  ];
  appendFileSync(log, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  try {
    await assert.rejects(
      () => tools.papercuts_resolve.execute({ id: "1111" }, makeContext(directory)),
      /ambiguous/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid input is rejected without creating a journal", async () => {
  const directory = createTemporaryRepository();
  try {
    await assert.rejects(
      () => tools.papercuts_add.execute({ text: "" }, makeContext(directory)),
      /empty or whitespace/,
    );
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupted journal degrades gracefully for the reviewer", async () => {
  const directory = createTemporaryRepository();
  try {
    const added = JSON.parse(
      await tools.papercuts_add.execute({ text: "survives" }, makeContext(directory)) as string,
    );
    appendFileSync(join(directory, ".papercuts.jsonl"), "\ngarbage line\n{\"kind\":\"future\"}\n");
    const listed = JSON.parse(
      await tools.papercuts_list.execute({ status: "all" }, makeContext(directory)) as string,
    );
    assert.equal(listed.data.items[0].cut.id, added.data.record.id);
    assert.ok(listed.data.warnings.length >= 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAPERCUTS_FILE override routes tool writes to a private log", async () => {
  const directory = createTemporaryRepository();
  const override = mkdtempSync(join(tmpdir(), "opencode-papercuts-eval-file-"));
  const previous = process.env.PAPERCUTS_FILE;
  process.env.PAPERCUTS_FILE = join(override, "private.jsonl");
  try {
    const added = JSON.parse(
      await tools.papercuts_add.execute({ text: "private note" }, makeContext(directory)) as string,
    );
    assert.equal(added.ok, true);
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
    const listed = JSON.parse(
      await tools.papercuts_list.execute({}, makeContext(directory)) as string,
    );
    assert.equal(listed.data.file, join(override, "private.jsonl"));
    assert.equal(listed.data.count, 1);
    const resolved = JSON.parse(
      await tools.papercuts_resolve.execute({ id: added.data.record.id }, makeContext(directory)) as string,
    );
    assert.equal(resolved.data.changed, true);
  } finally {
    if (previous === undefined) {
      delete process.env.PAPERCUTS_FILE;
    } else {
      process.env.PAPERCUTS_FILE = previous;
    }
    rmSync(directory, { recursive: true, force: true });
    rmSync(override, { recursive: true, force: true });
  }
});

test("many sessions appending in quick succession keep the fold consistent", async () => {
  const directory = createTemporaryRepository();
  try {
    const writes = Array.from({ length: 20 }, (_, index) =>
      tools.papercuts_add.execute({ text: `parallel friction ${index}` }, makeContext(directory)),
    );
    await Promise.all(writes);
    const listed = JSON.parse(
      await tools.papercuts_list.execute({ status: "all", limit: 50 }, makeContext(directory)) as string,
    );
    assert.equal(listed.data.total, 20);
    assert.deepEqual(listed.data.warnings, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("list filter combinations compose through the tool surface", async () => {
  const directory = createTemporaryRepository();
  try {
    const add = (args: Parameters<typeof tools.papercuts_add.execute>[0]) =>
      tools.papercuts_add.execute(args, makeContext(directory));
    await add({ text: "tagged minor", tag: "docs" });
    await add({ text: "untagged blocker", severity: "blocker" });
    await add({ text: "tagged major", tag: "docs", severity: "major" });
    const blocker = JSON.parse(
      await tools.papercuts_list.execute({ severity: "blocker" }, makeContext(directory)) as string,
    );
    await tools.papercuts_resolve.execute({ id: blocker.data.items[0].cut.id }, makeContext(directory));

    assert.equal(JSON.parse(await tools.papercuts_list.execute({}, makeContext(directory)) as string).data.total, 2);
    assert.equal(
      JSON.parse(await tools.papercuts_list.execute({ status: "all" }, makeContext(directory)) as string).data.total,
      3,
    );
    assert.equal(
      JSON.parse(await tools.papercuts_list.execute({ status: "resolved" }, makeContext(directory)) as string).data.count,
      1,
    );
    assert.equal(JSON.parse(await tools.papercuts_list.execute({ tag: "docs" }, makeContext(directory)) as string).data.count, 2);
    assert.equal(
      JSON.parse(await tools.papercuts_list.execute({ tag: "docs", severity: "major" }, makeContext(directory)) as string)
        .data.items[0].cut.text,
      "tagged major",
    );
    // Resolved entries fold out of open views even when a filter matches their tag/severity.
    assert.equal(JSON.parse(await tools.papercuts_list.execute({ severity: "blocker" }, makeContext(directory)) as string).data.total, 0);

    const limited = JSON.parse(await tools.papercuts_list.execute({ limit: 1 }, makeContext(directory)) as string);
    assert.equal(limited.data.count, 1);
    assert.equal(limited.data.truncated, true);
    assert.equal(limited.data.total, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tool argument schemas reject malformed input before execution", () => {
  const shapeOf = (name: string) => (tools as Record<string, { args: z.ZodRawShape }>)[name]!.args;
  const addSchema = z.object(shapeOf("papercuts_add"));
  assert.equal(addSchema.safeParse({ text: "ok", severity: "catastrophic" }).success, false);
  assert.equal(addSchema.safeParse({ text: "ok", exitCode: "one" }).success, false);
  assert.equal(addSchema.safeParse({ text: "ok", severity: "major", cmd: "npm test", exitCode: 1 }).success, true);
  const resolveSchema = z.object(shapeOf("papercuts_resolve"));
  assert.equal(resolveSchema.safeParse({}).success, false);
  assert.equal(resolveSchema.safeParse({ id: "pc_9f2c41" }).success, true);
  const listSchema = z.object(shapeOf("papercuts_list"));
  assert.equal(listSchema.safeParse({ status: "archived" }).success, false);
  assert.equal(listSchema.safeParse({ limit: 5 }).success, true);
});