import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = new URL("../plugin/bin/papercuts.mjs", import.meta.url).pathname;

function createTemporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-cli-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

function runCli(directory, ...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: directory,
    encoding: "utf8",
  });
}

function envelope(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  return parsed.data;
}

test("cli add files a record at the repository root with agent attribution", () => {
  const directory = createTemporaryRepository();
  try {
    const data = envelope(runCli(
      directory,
      "add",
      "the command needed an unexpected working directory",
      "--tag",
      "tooling",
      "--agent",
      "codex",
    ));
    assert.equal(data.changed, true);
    assert.match(data.record.id, /^pc_[0-9a-f]{12}$/);
    assert.equal(data.record.agent, "codex");

    const record = JSON.parse(readFileSync(join(directory, ".papercuts.jsonl"), "utf8").trim());
    assert.equal(record.kind, "cut");
    assert.equal(record.text, "the command needed an unexpected working directory");
    assert.deepEqual(record.tags, ["tooling"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli add defaults to the opencode agent name for cross-host compatibility", () => {
  const directory = createTemporaryRepository();
  try {
    const data = envelope(runCli(directory, "add", "shared journal entry"));
    assert.equal(data.record.agent, "opencode");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli add is duplicate-safe across invocations", () => {
  const directory = createTemporaryRepository();
  try {
    envelope(runCli(directory, "add", "flaky lint rule"));
    const second = envelope(runCli(directory, "add", "flaky lint rule"));
    assert.equal(second.changed, false);
    assert.ok(second.warnings.some((warning) => warning.includes("duplicate")));
    assert.equal(readFileSync(join(directory, ".papercuts.jsonl"), "utf8").trim().split("\n").length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli list reports open entries severity-first and supports status filters", () => {
  const directory = createTemporaryRepository();
  try {
    runCli(directory, "add", "small annoyance");
    runCli(directory, "add", "hard wall", "--severity", "blocker");
    const listed = envelope(runCli(directory, "list"));
    assert.equal(listed.count, 2);
    assert.equal(listed.items[0].cut.severity, "blocker");

    const resolvedId = listed.items[1].cut.id;
    envelope(runCli(directory, "resolve", resolvedId));
    const open = envelope(runCli(directory, "list"));
    assert.equal(open.total, 1);
    const all = envelope(runCli(directory, "list", "--status", "all"));
    assert.equal(all.total, 2);
    assert.equal(all.items.find((item) => item.cut.id === resolvedId).status, "resolved");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli resolve accepts short prefixes and records the note", () => {
  const directory = createTemporaryRepository();
  try {
    const added = envelope(runCli(directory, "add", "broken docs link"));
    const prefix = added.record.id.slice(3, 7);
    const resolved = envelope(runCli(directory, "resolve", prefix, "--note", "fixed in docs PR"));
    assert.equal(resolved.changed, true);
    assert.equal(resolved.item.resolution.note, "fixed in docs PR");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli remove hides the entry from open lists", () => {
  const directory = createTemporaryRepository();
  try {
    const added = envelope(runCli(directory, "add", "not real friction"));
    envelope(runCli(directory, "remove", added.record.id));
    const listed = envelope(runCli(directory, "list", "--status", "all"));
    assert.equal(listed.total, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli rejects invalid usage without creating a file", () => {
  const directory = createTemporaryDirectory();
  try {
    const missingCommand = runCli(directory);
    assert.notEqual(missingCommand.status, 0);
    assert.match(missingCommand.stderr, /Usage:/);

    const unknownFlag = runCli(directory, "add", "text", "--bogus", "x");
    assert.equal(unknownFlag.status, 1);
    assert.equal(JSON.parse(unknownFlag.stdout).error.code, "invalid_argument");

    const emptyText = runCli(directory, "add");
    assert.equal(emptyText.status, 1);

    const badSeverity = runCli(directory, "add", "text", "--severity", "huge");
    assert.equal(JSON.parse(badSeverity.stdout).error.code, "invalid_argument");

    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "opencode-papercuts-cli-nogit-"));
}

test("cli resolve reports not_found with exit code 2 for unknown prefixes", () => {
  const directory = createTemporaryDirectory();
  try {
    runCli(directory, "add", "known papercut");
    const result = runCli(directory, "resolve", "999999");
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "not_found");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
