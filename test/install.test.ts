import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { copyTree, readJsonOrDefault, readJsonOrThrow, runCommand, writeJson } from "../shared/install.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "papercuts-shared-"));
}

test("readJsonOrThrow returns null for a missing file", () => {
  const dir = tempDir();
  try {
    assert.equal(readJsonOrThrow(join(dir, "nope.json")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readJsonOrThrow parses strict JSON and throws with a friendly message on JSONC", () => {
  const dir = tempDir();
  try {
    const file = join(dir, "config.json");
    writeFileSync(file, '{"plugin":["a"]}', "utf8");
    assert.deepEqual(readJsonOrThrow(file), { plugin: ["a"] });

    writeFileSync(file, '{ "plugin": [ // comment\n ] }', "utf8");
    assert.throws(() => readJsonOrThrow(file), /not valid JSON \(JSONC is not supported\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readJsonOrDefault returns the fallback for missing or corrupt files", () => {
  const dir = tempDir();
  try {
    const missing = join(dir, "missing.json");
    assert.deepEqual(readJsonOrDefault(missing, { fallback: true }), { fallback: true });

    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "not-json{", "utf8");
    assert.deepEqual(readJsonOrDefault(corrupt, [1, 2]), [1, 2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeJson creates parent directories, formats, and newline-terminates", () => {
  const base = tempDir();
  try {
    const file = join(base, "nested", "deep", "config.json");
    writeJson(file, { a: [1, 2] });
    assert.equal(readFileSync(file, "utf8"), '{\n  "a": [\n    1,\n    2\n  ]\n}\n');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("copyTree deep-copies a directory tree", () => {
  const base = tempDir();
  try {
    const src = join(base, "src");
    const dest = join(base, "dest");
    mkdirSync(join(src, "nested"), { recursive: true });
    writeFileSync(join(src, "top.txt"), "top", "utf8");
    writeFileSync(join(src, "nested", "deep.txt"), "deep", "utf8");

    copyTree(src, dest);
    assert.equal(readFileSync(join(dest, "top.txt"), "utf8"), "top");
    assert.equal(readFileSync(join(dest, "nested", "deep.txt"), "utf8"), "deep");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("runCommand captures stdout and stderr and reports a nonzero exit", () => {
  const ok = runCommand(process.execPath, ["-e", "console.log('hi'); console.error('err')"]);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), "hi");
  assert.equal(ok.stderr.trim(), "err");

  const fail = runCommand(process.execPath, ["-e", "process.exit(3)"]);
  assert.equal(fail.status, 3);
});

test("runCommand throws when the command is not on PATH", () => {
  assert.throws(() => runCommand("definitely-not-a-real-binary-papercuts", []), /not found on PATH/);
});
