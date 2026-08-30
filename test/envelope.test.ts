import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { errorEnvelope, exitCodeFor, ok } from "../plugin/src/envelope.ts";
import { PapercutsError } from "../plugin/src/store.ts";
import papercutsPlugin from "../src/index.ts";

const CLI_PATH = fileURLToPath(new URL("../plugin/bin/papercuts.mjs", import.meta.url));

function createTemporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-envelope-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

function runCli(directory: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PAPERCUTS_FILE: "" },
  });
}

function makeContext(directory: string) {
  return {
    sessionID: "t",
    messageID: "m",
    agent: "build",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  } as never;
}

test("ok() wraps data in the shared success envelope", () => {
  assert.deepEqual(ok({ changed: true }), { ok: true, data: { changed: true } });
  assert.deepEqual(ok(undefined), { ok: true, data: undefined });
});

test("errorEnvelope maps PapercutsError code, message, and candidates", () => {
  const withCandidates = new PapercutsError(
    "ambiguous_id",
    "ID prefix is ambiguous",
    ["pc_111100000000", "pc_1111ffffffff"],
  );
  assert.deepEqual(errorEnvelope(withCandidates), {
    ok: false,
    error: {
      code: "ambiguous_id",
      message: "ID prefix is ambiguous",
      candidates: ["pc_111100000000", "pc_1111ffffffff"],
    },
  });
  const withoutCandidates = new PapercutsError("not_found", "no papercut matches");
  assert.deepEqual(errorEnvelope(withoutCandidates), {
    ok: false,
    error: { code: "not_found", message: "no papercut matches" },
  });
});

test("errorEnvelope maps non-PapercutsError values to io_error", () => {
  assert.deepEqual(errorEnvelope(new Error("boom")), {
    ok: false,
    error: { code: "io_error", message: "Error: boom" },
  });
  assert.deepEqual(errorEnvelope("boom"), {
    ok: false,
    error: { code: "io_error", message: "boom" },
  });
});

test("exitCodeFor maps error codes to CLI exit codes", () => {
  assert.equal(exitCodeFor("not_found"), 2);
  assert.equal(exitCodeFor("ambiguous_id"), 2);
  assert.equal(exitCodeFor("io_error"), 3);
  assert.equal(exitCodeFor("invalid_argument"), 1);
  assert.equal(exitCodeFor("usage"), 1);
});

test("opencode tool and CLI emit the same success envelope shape", async () => {
  const hooks = await papercutsPlugin();
  const directory = createTemporaryRepository();
  try {
    const toolOutput = JSON.parse(
      (await hooks.tool!.papercuts_add.execute({ text: "shared envelope tool" }, makeContext(directory))) as string,
    );
    assert.equal(toolOutput.ok, true);
    assert.equal(toolOutput.data.changed, true);
    assert.ok(toolOutput.data.record);
    assert.equal(toolOutput.data.record.text, "shared envelope tool");

    const cliResult = runCli(directory, "add", "shared envelope cli");
    assert.equal(cliResult.status, 0);
    const cliOutput = JSON.parse(cliResult.stdout);
    assert.equal(cliOutput.ok, true);
    assert.equal(cliOutput.data.changed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("opencode tools throw errors instead of emitting ok:false envelopes", async () => {
  const hooks = await papercutsPlugin();
  const directory = createTemporaryRepository();
  try {
    await assert.rejects(
      () => hooks.tool!.papercuts_add.execute({ text: "" }, makeContext(directory)),
      PapercutsError,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI failures emit ok:false with exit codes from the shared mapping", () => {
  const directory = createTemporaryRepository();
  try {
    const result = runCli(directory, "resolve", "999999");
    assert.equal(result.status, 2);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed, {
      ok: false,
      error: { code: "not_found", message: "no papercuts file exists yet" },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});