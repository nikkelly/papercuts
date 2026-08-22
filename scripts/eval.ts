import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import papercutsPlugin from "../src/index.ts";
import type { ToolContext } from "@opencode-ai/plugin";

const FIXTURE_TS = new Date("2026-08-01T12:00:00.000Z");

function createTemporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-eval-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

function makeContext(directory: string): ToolContext {
  return {
    sessionID: "eval-session",
    messageID: "eval-message",
    agent: "build",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  };
}

const plugin = await papercutsPlugin({ project: undefined, client: undefined, directory: process.cwd(), $: undefined } as never);
const tools = plugin.tool;
assert.ok(tools, "plugin must register tools");

let passed = 0;
let failed = 0;

async function scenario(name: string, run: () => Promise<void>) {
  try {
    await run();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error instanceof Error ? error.message : error}`);
  }
}

console.log("Evaluating opencode-papercuts plugin against simulated agent sessions\n");

await scenario("tools are registered under expected names", async () => {
  for (const name of ["papercuts_add", "papercuts_list", "papercuts_resolve", "papercuts_remove"]) {
    assert.ok((tools as Record<string, unknown>)[name], `missing tool: ${name}`);
    assert.equal(typeof (tools as Record<string, { description: string }>)[name]!.description, "string");
  }
});

await scenario("agent files a papercut mid-session; journal is created at repo root", async () => {
  const directory = createTemporaryRepository();
  try {
    const result = JSON.parse(
      await tools.papercuts_add.execute(
        { text: "yarn test needs cwd apps/web", tag: "tooling" },
        makeContext(directory),
      ) as string,
    );
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    const record = JSON.parse(readFileSync(join(directory, ".papercuts.jsonl"), "utf8").trim());
    assert.equal(record.kind, "cut");
    assert.deepEqual(record.tags, ["tooling"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await scenario("duplicate complaint in a later session does not duplicate the record", async () => {
  const directory = createTemporaryRepository();
  try {
    const first = JSON.parse(await tools.papercuts_add.execute({ text: "flaky lint" }, makeContext(directory)) as string);
    const second = JSON.parse(await tools.papercuts_add.execute({ text: "flaky lint" }, makeContext(directory)) as string);
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(readFileSync(join(directory, ".papercuts.jsonl"), "utf8").trim().split("\n").length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await scenario("reviewer session lists open papercuts and sees severities first", async () => {
  const directory = createTemporaryRepository();
  try {
    await tools.papercuts_add.execute({ text: "minor thing", severity: "minor" }, makeContext(directory));
    await tools.papercuts_add.execute({ text: "hard wall", severity: "blocker" }, makeContext(directory));
    const listed = JSON.parse(await tools.papercuts_list.execute({}, makeContext(directory)) as string);
    assert.equal(listed.count, 2);
    assert.equal(listed.items[0].cut.severity, "blocker");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await scenario("fix-then-verify flow: resolve by short prefix, then confirm folded out", async () => {
  const directory = createTemporaryRepository();
  try {
    const added = JSON.parse(await tools.papercuts_add.execute({ text: "stale docs link" }, makeContext(directory)) as string);
    const prefix = added.record.id.slice(3, 7);
    const resolved = JSON.parse(
      await tools.papercuts_resolve.execute({ id: prefix, note: "docs updated in PR #12" }, makeContext(directory)) as string,
    );
    assert.equal(resolved.changed, true);
    assert.equal(resolved.item.status, "resolved");
    const open = JSON.parse(await tools.papercuts_list.execute({}, makeContext(directory)) as string);
    assert.equal(open.total, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await scenario("ambiguous prefix surfaces candidates instead of guessing", async () => {
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

await scenario("invalid input is rejected without creating a journal", async () => {
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

await scenario("corrupted journal degrades gracefully for the reviewer", async () => {
  const directory = createTemporaryRepository();
  try {
    const added = JSON.parse(await tools.papercuts_add.execute({ text: "survives" }, makeContext(directory)) as string);
    appendFileSync(join(directory, ".papercuts.jsonl"), "\ngarbage line\n{\"kind\":\"future\"}\n");
    const listed = JSON.parse(await tools.papercuts_list.execute({ status: "all" }, makeContext(directory)) as string);
    assert.equal(listed.items[0].cut.id, added.record.id);
    assert.ok(listed.warnings.length >= 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await scenario("PAPERCUTS_FILE override routes tool writes to a private log", async () => {
  const directory = createTemporaryRepository();
  const override = mkdtempSync(join(tmpdir(), "opencode-papercuts-eval-file-"));
  const previous = process.env.PAPERCUTS_FILE;
  process.env.PAPERCUTS_FILE = join(override, "private.jsonl");
  try {
    const added = JSON.parse(await tools.papercuts_add.execute({ text: "private note" }, makeContext(directory)) as string);
    assert.equal(added.ok, true);
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
    const listed = JSON.parse(await tools.papercuts_list.execute({}, makeContext(directory)) as string);
    assert.equal(listed.file, join(override, "private.jsonl"));
    assert.equal(listed.count, 1);
    const resolved = JSON.parse(await tools.papercuts_resolve.execute({ id: added.record.id }, makeContext(directory)) as string);
    assert.equal(resolved.changed, true);
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

await scenario("concurrent sessions appending interleaved records keep the fold consistent", async () => {
  const directory = createTemporaryRepository();
  try {
    const writes = Array.from({ length: 20 }, (_, index) =>
      tools.papercuts_add.execute({ text: `parallel friction ${index}` }, makeContext(directory)),
    );
    await Promise.all(writes);
    const listed = JSON.parse(await tools.papercuts_list.execute({ status: "all", limit: 50 }, makeContext(directory)) as string);
    assert.equal(listed.total, 20);
    assert.deepEqual(listed.warnings, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await scenario("remove drops false positives from the reviewer's queue", async () => {
  const directory = createTemporaryRepository();
  try {
    const added = JSON.parse(await tools.papercuts_add.execute({ text: "not actually friction" }, makeContext(directory)) as string);
    const removed = JSON.parse(await tools.papercuts_remove.execute({ id: added.record.id }, makeContext(directory)) as string);
    assert.equal(removed.changed, true);
    const listed = JSON.parse(await tools.papercuts_list.execute({ status: "all" }, makeContext(directory)) as string);
    assert.equal(listed.total, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

console.log(`\nEvaluation complete: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
