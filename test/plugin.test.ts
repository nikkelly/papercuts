import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import papercutsPlugin from "../src/index.ts";

test("plugin registers all four tools", async () => {
  const hooks = await papercutsPlugin({} as never);
  for (const name of ["papercuts_add", "papercuts_list", "papercuts_resolve", "papercuts_remove"]) {
    assert.ok(hooks.tool?.[name], `missing tool: ${name}`);
  }
});

test("session directory wins over a root worktree sentinel from the host", async () => {
  const hooks = await papercutsPlugin({} as never);
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-plugin-"));
  mkdirSync(join(directory, ".git"), { recursive: true });
  try {
    const context = {
      sessionID: "t",
      messageID: "m",
      agent: "build",
      directory,
      worktree: "/",
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    } as never;
    const added = JSON.parse(
      (await hooks.tool!.papercuts_add.execute({ text: "worktree sentinel" }, context)) as string,
    );
    assert.equal(added.ok, true);
    assert.equal(added.record.cwd, directory);
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tool execution falls back to process.cwd() when context paths are empty", async () => {
  const hooks = await papercutsPlugin({} as never);
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-plugin-"));
  // Pin repo discovery to the fixture: a real .git above tmpdir would otherwise win.
  mkdirSync(join(directory, ".git"), { recursive: true });
  const previousCwd = process.cwd();
  process.chdir(directory);
  try {
    const context = {
      sessionID: "t",
      messageID: "m",
      agent: "build",
      directory: "",
      worktree: "",
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    } as never;
    // Regression: an empty context previously resolved startDirectory to "/".
    const added = JSON.parse(
      (await hooks.tool!.papercuts_add.execute({ text: "cwd fallback" }, context)) as string,
    );
    assert.equal(added.ok, true);
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), true);
    assert.notEqual(added.record.cwd, "/");
    const listed = JSON.parse(
      (await hooks.tool!.papercuts_list.execute({}, context)) as string,
    );
    assert.equal(listed.count, 1);
  } finally {
    process.chdir(previousCwd);
    rmSync(directory, { recursive: true, force: true });
  }
});
