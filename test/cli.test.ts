import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI_PATH = fileURLToPath(new URL("../plugin/bin/papercuts.mjs", import.meta.url));

function createTemporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-cli-"));
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

function runCliEnv(directory: string, extraEnv: Record<string, string>, ...args: string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PAPERCUTS_FILE: "", ...extraEnv },
  });
}

function envelope(result: SpawnSyncReturns<string>) {
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
    assert.ok(second.warnings.some((warning: string) => warning.includes("duplicate")));
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
    assert.equal(all.items.find((item: { cut: { id: string } }) => item.cut.id === resolvedId).status, "resolved");
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
  return mkdtempSync(join(tmpdir(), "papercuts-cli-nogit-"));
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

test("cli resolve reports ambiguous_id with exit code 2 and candidates", () => {
  const directory = createTemporaryDirectory();
  // Pin repo discovery to the fixture so the raw journal is actually read.
  mkdirSync(join(directory, ".git"));
  writeRawJournal(directory, [
    { kind: "cut", id: "pc_111100000000", ts: "2026-08-01T00:00:00.000Z", agent: "opencode", text: "first", tags: [], severity: "minor", cwd: directory, repo: directory },
    { kind: "cut", id: "pc_1111ffffffff", ts: "2026-08-02T00:00:00.000Z", agent: "opencode", text: "second", tags: [], severity: "minor", cwd: directory, repo: directory },
  ]);
  try {
    const result = runCli(directory, "resolve", "1111");
    assert.equal(result.status, 2);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.error.code, "ambiguous_id");
    assert.deepEqual(parsed.error.candidates, ["pc_111100000000", "pc_1111ffffffff"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli resolve of an already-resolved entry is idempotent with exit 0", () => {
  const directory = createTemporaryRepository();
  try {
    const added = envelope(runCli(directory, "add", "already done"));
    envelope(runCli(directory, "resolve", added.record.id));
    const again = envelope(runCli(directory, "resolve", added.record.id));
    assert.equal(again.changed, false);
    assert.ok(again.warnings.some((warning: string) => warning.includes("already resolved")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli rejects non-integer --exit and --limit values instead of writing garbage", () => {
  const directory = createTemporaryRepository();
  try {
    const badExit = runCli(directory, "add", "command failed", "--exit", "abc");
    assert.equal(badExit.status, 1);
    assert.equal(JSON.parse(badExit.stdout).error.code, "invalid_argument");
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);

    envelope(runCli(directory, "add", "something failed", "--exit", "-1"));

    const badLimit = runCli(directory, "list", "--limit", "abc");
    assert.equal(badLimit.status, 1);

    const listed = envelope(runCli(directory, "list"));
    assert.equal(listed.items[0].cut.evidence.exitCode, -1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli resolve and remove attribute their events to --agent when passed", () => {
  const directory = createTemporaryRepository();
  try {
    const added = envelope(runCli(directory, "add", "codex friction", "--agent", "codex"));
    envelope(runCli(directory, "resolve", added.record.id, "--agent", "codex"));

    const removedAdd = envelope(runCli(directory, "add", "false positive", "--agent", "codex"));
    envelope(runCli(directory, "remove", removedAdd.record.id, "--agent", "codex"));

    const events = readFileSync(join(directory, ".papercuts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const resolveEvent = events.find((event) => event.kind === "resolve");
    const removeEvent = events.find((event) => event.kind === "remove");
    assert.equal(resolveEvent.agent, "codex");
    assert.equal(removeEvent.agent, "codex");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli mute and unmute flip the status and record the agent", () => {
  const directory = createTemporaryRepository();
  try {
    const muted = envelope(runCli(directory, "mute", "--agent", "codex"));
    assert.equal(muted.changed, true);
    assert.equal(muted.muted, true);
    assert.equal(muted.event.kind, "mute");

    const statusAfterMute = envelope(runCli(directory, "status"));
    assert.equal(statusAfterMute.muted, true);
    assert.equal(statusAfterMute.exists, true);

    const unmuted = envelope(runCli(directory, "unmute"));
    assert.equal(unmuted.changed, true);
    assert.equal(unmuted.muted, false);
    assert.equal(envelope(runCli(directory, "status")).muted, false);

    const events = readFileSync(join(directory, ".papercuts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events[0].agent, "codex");
    assert.equal(events[1].agent, "opencode");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli toggle flips between muted and unmuted", () => {
  const directory = createTemporaryRepository();
  try {
    const first = envelope(runCli(directory, "toggle"));
    assert.equal(first.changed, true);
    assert.equal(first.muted, true);
    const second = envelope(runCli(directory, "toggle"));
    assert.equal(second.changed, true);
    assert.equal(second.muted, false);
    const third = envelope(runCli(directory, "toggle"));
    assert.equal(third.muted, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli mute is idempotent and status on a fresh repository is unmuted", () => {
  const directory = createTemporaryRepository();
  try {
    const status = envelope(runCli(directory, "status"));
    assert.equal(status.muted, false);
    assert.equal(status.exists, false);

    envelope(runCli(directory, "mute"));
    const again = envelope(runCli(directory, "mute"));
    assert.equal(again.changed, false);
    assert.ok(again.warnings.some((warning: string) => warning.includes("already muted")));
    assert.equal(readFileSync(join(directory, ".papercuts.jsonl"), "utf8").trim().split("\n").length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli rejects flags on status and unknown commands without side effects", () => {
  const directory = createTemporaryDirectory();
  try {
    const withFlag = runCli(directory, "status", "--agent", "codex");
    assert.equal(withFlag.status, 1);
    assert.equal(JSON.parse(withFlag.stdout).error.code, "invalid_argument");
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeRawJournal(directory: string, records: Array<Record<string, unknown>>) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, ".papercuts.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

test("cli add accepts --key=value flag forms", () => {
  const directory = createTemporaryRepository();
  try {
    const data = envelope(runCli(directory, "add", "equals form", "--tag=build", "--severity=major"));
    assert.deepEqual(data.record.tags, ["build"]);
    assert.equal(data.record.severity, "major");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli add treats everything after -- as text", () => {
  const directory = createTemporaryRepository();
  try {
    const data = envelope(runCli(directory, "add", "--", "--not-a-flag", "just text"));
    assert.equal(data.record.text, "--not-a-flag just text");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli add rejects duplicate flags", () => {
  const directory = createTemporaryRepository();
  try {
    const result = runCli(directory, "add", "text", "--tag", "a", "--tag", "b");
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "invalid_argument");
    assert.match(JSON.parse(result.stdout).error.message, /duplicate/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli list filters by tag and severity", () => {
  const directory = createTemporaryRepository();
  try {
    envelope(runCli(directory, "add", "docs gripe", "--tag", "docs"));
    envelope(runCli(directory, "add", "build gripe", "--tag", "build", "--severity", "major"));

    const docs = envelope(runCli(directory, "list", "--tag", "docs"));
    assert.equal(docs.count, 1);
    assert.equal(docs.items[0].cut.text, "docs gripe");

    const majors = envelope(runCli(directory, "list", "--severity", "major"));
    assert.equal(majors.count, 1);
    assert.equal(majors.items[0].cut.severity, "major");

    const none = envelope(runCli(directory, "list", "--tag", "nope"));
    assert.equal(none.count, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli list --limit truncates and reports truncation", () => {
  const directory = createTemporaryRepository();
  try {
    envelope(runCli(directory, "add", "first"));
    envelope(runCli(directory, "add", "second", "--severity", "major"));
    const listed = envelope(runCli(directory, "list", "--limit", "1"));
    assert.equal(listed.count, 1);
    assert.equal(listed.items[0].cut.severity, "major");
    assert.equal(listed.truncated, true);
    assert.equal(listed.total, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli add from a subdirectory anchors the journal at the repository root", () => {
  const directory = createTemporaryRepository();
  mkdirSync(join(directory, "apps", "web"), { recursive: true });
  try {
    const data = envelope(runCli(join(directory, "apps", "web"), "add", "nested cwd friction"));
    assert.equal(data.record.repo, directory);
    assert.ok(existsSync(join(directory, ".papercuts.jsonl")));
    assert.equal(existsSync(join(directory, "apps", "web", ".papercuts.jsonl")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli PAPERCUTS_FILE routes the journal outside repository discovery", () => {
  const directory = createTemporaryRepository();
  const alt = join(directory, "elsewhere", "journal.jsonl");
  try {
    const data = envelope(runCliEnv(directory, { PAPERCUTS_FILE: alt }, "add", "routed elsewhere"));
    assert.equal(data.changed, true);
    assert.ok(existsSync(alt));
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli unknown command prints usage and exits 1", () => {
  const directory = createTemporaryDirectory();
  try {
    const result = runCli(directory, "frobnicate");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.equal(JSON.parse(result.stdout).error.code, "usage");
    assert.equal(existsSync(join(directory, ".papercuts.jsonl")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli re-adding a removed papercut supersedes the remove", () => {
  const directory = createTemporaryRepository();
  try {
    const added = envelope(runCli(directory, "add", "back again"));
    envelope(runCli(directory, "remove", added.record.id));
    assert.equal(envelope(runCli(directory, "list")).total, 0);

    const reAdded = envelope(runCli(directory, "add", "back again"));
    assert.equal(reAdded.changed, true);
    const open = envelope(runCli(directory, "list"));
    assert.equal(open.total, 1);
    assert.equal(open.items[0].cut.id, reAdded.record.id);
    // Same content-addressed id by design; the newer cut supersedes the remove.
    const kinds = readFileSync(join(directory, ".papercuts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).kind);
    assert.deepEqual(kinds, ["cut", "remove", "cut"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
