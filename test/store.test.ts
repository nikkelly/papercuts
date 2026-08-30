import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PapercutsError,
  addPapercut,
  computeId,
  discoverLogPath,
  listPapercuts,
  papercutStatus,
  removePapercut,
  resolvePapercut,
  setMuted,
} from "../plugin/src/store.ts";

const FIXTURE_TS = new Date("2026-08-01T12:00:00.000Z");

function createTemporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

function createTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "opencode-papercuts-nogit-"));
}

function readFile(directory: string, name = ".papercuts.jsonl") {
  return readFileSync(join(directory, name), "utf8");
}

function logPath(directory: string) {
  return join(directory, ".papercuts.jsonl");
}

test("add creates a JSONL cut record at the repository root", () => {
  const directory = createTemporaryRepository();
  try {
    const result = addPapercut({
      text: "the command needed an unexpected working directory",
      startDirectory: directory,
      now: FIXTURE_TS,
    });
    const lines = readFile(directory).trim().split("\n");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]!);
    assert.equal(record.kind, "cut");
    assert.equal(record.text, "the command needed an unexpected working directory");
    assert.equal(record.severity, "minor");
    assert.equal(record.ts, "2026-08-01T12:00:00.000Z");
    assert.equal(record.repo, directory);
    assert.match(record.id, /^pc_[0-9a-f]{12}$/);
    assert.equal(result.changed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add records at the repository root when invoked from a subdirectory", () => {
  const directory = createTemporaryRepository();
  try {
    const nested = join(directory, "nested", "working-directory");
    mkdirSync(nested, { recursive: true });
    addPapercut({ text: "only worked from a specific directory", startDirectory: nested });
    assert.ok(readFile(directory).includes("only worked from a specific directory"));
    assert.equal(existsSync(logPath(nested)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add anchors the journal to the working directory outside a git repository", () => {
  const workdir = createTemporaryDirectory();
  try {
    // Injected exists() guarantees no repository is found, regardless of
    // whether a real ancestor of tmpdir (e.g. /tmp) happens to contain .git.
    const discovered = discoverLogPath(workdir, {}, () => false);
    assert.equal(discovered.repo, null);
    assert.equal(discovered.explicit, false);
    assert.equal(discovered.path, join(workdir, ".papercuts.jsonl"));

    const result = addPapercut({
      text: "no repo anywhere",
      startDirectory: workdir,
      now: FIXTURE_TS,
      exists: () => false,
    });
    assert.equal(result.record.repo, null);
    assert.ok(readFile(workdir).includes("no repo anywhere"));
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("PAPERCUTS_FILE overrides repository discovery", () => {
  const directory = createTemporaryRepository();
  const override = createTemporaryDirectory();
  try {
    addPapercut({
      text: "private log",
      startDirectory: directory,
      env: { PAPERCUTS_FILE: join(override, "log.jsonl") },
    });
    assert.ok(readFile(override, "log.jsonl").includes("private log"));
    assert.equal(existsSync(logPath(directory)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(override, { recursive: true, force: true });
  }
});

test("add rejects empty text without creating a file", () => {
  const directory = createTemporaryDirectory();
  try {
    assert.throws(
      () => addPapercut({ text: "", startDirectory: directory }),
      /empty or whitespace/,
    );
    assert.throws(
      () => addPapercut({ text: "   ", startDirectory: directory }),
      /empty or whitespace/,
    );
    assert.equal(existsSync(logPath(directory)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add rejects text over 10000 bytes", () => {
  const directory = createTemporaryDirectory();
  try {
    assert.throws(
      () => addPapercut({ text: "x".repeat(10_001), startDirectory: directory }),
      /maximum of 10000/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add is duplicate-safe and returns the existing record", () => {
  const directory = createTemporaryRepository();
  try {
    const first = addPapercut({
      text: "flaky command",
      startDirectory: directory,
      now: FIXTURE_TS,
    });
    const second = addPapercut({
      text: "flaky command",
      startDirectory: directory,
      now: new Date("2026-08-02T12:00:00.000Z"),
    });
    assert.equal(second.changed, false);
    assert.deepEqual(JSON.parse(JSON.stringify(second.record)), JSON.parse(JSON.stringify(first.record)));
    assert.ok(second.warnings.some((warning) => warning.includes("duplicate")));
    assert.equal(readFile(directory).trim().split("\n").length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add warns when text looks like a resolution", () => {
  const directory = createTemporaryRepository();
  try {
    const result = addPapercut({
      text: "RESOLVED by pinning the dependency",
      startDirectory: directory,
    });
    assert.ok(result.warnings.some((warning) => warning.includes("resolution")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ids are content-addressed across severity and sorted tags, not agent", () => {
  const minor = computeId("same text", "minor", []);
  const major = computeId("same text", "major", []);
  assert.notEqual(minor, major);

  const tagOrderA = computeId("same text", "minor", ["b", "a"]);
  const tagOrderB = computeId("same text", "minor", ["a", "b"]);
  assert.equal(tagOrderA, tagOrderB);

  const otherText = computeId("different text", "minor", []);
  assert.notEqual(minor, otherText);

  // Cross-host dedupe: identical friction filed by different agents shares one ID.
  assert.equal(computeId("same text", "minor", []), minor);
});

test("add dedupes across agents and keeps the first filer's attribution", () => {
  const directory = createTemporaryRepository();
  try {
    const first = addPapercut({
      text: "shared friction",
      startDirectory: directory,
      now: FIXTURE_TS,
    });
    assert.equal(first.record.agent, "opencode");
    const second = addPapercut({
      text: "shared friction",
      agent: "codex",
      startDirectory: directory,
      now: new Date("2026-08-02T12:00:00.000Z"),
    });
    assert.equal(second.changed, false);
    assert.equal(second.record.agent, "opencode");
    assert.equal(readFile(directory).trim().split("\n").length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("list filters by agent when provided and ignores unknown agents gracefully", () => {
  const directory = createTemporaryRepository();
  try {
    addPapercut({ text: "from opencode", startDirectory: directory, now: FIXTURE_TS });
    addPapercut({ text: "from codex", agent: "codex", startDirectory: directory, now: new Date("2026-08-02T00:00:00.000Z") });

    assert.equal(listPapercuts({ startDirectory: directory }).total, 2);
    assert.equal(listPapercuts({ agent: "codex", startDirectory: directory }).count, 1);
    assert.equal(listPapercuts({ agent: "claude", startDirectory: directory }).count, 0);
    assert.throws(
      () => listPapercuts({ agent: "  ", startDirectory: directory }),
      /empty or whitespace/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve appends an event, marks the item resolved, and folds it out of open lists", () => {
  const directory = createTemporaryRepository();
  try {
    const added = addPapercut({
      text: "broken link in docs",
      startDirectory: directory,
      now: FIXTURE_TS,
    });

    const resolved = resolvePapercut({
      idPrefix: added.record.id.slice(3, 7),
      note: "fixed the link",
      startDirectory: directory,
      now: new Date("2026-08-03T00:00:00.000Z"),
    });
    assert.equal(resolved.changed, true);
    assert.equal(resolved.item.status, "resolved");
    assert.equal(resolved.item.resolution?.note, "fixed the link");

    const open = listPapercuts({ status: "open", startDirectory: directory });
    assert.equal(open.total, 0);
    const all = listPapercuts({ status: "all", startDirectory: directory });
    assert.equal(all.items[0]?.status, "resolved");

    const again = resolvePapercut({ idPrefix: added.record.id, startDirectory: directory });
    assert.equal(again.changed, false);
    assert.ok(again.warnings.some((warning) => warning.includes("already resolved")));
    assert.equal(readFile(directory).trim().split("\n").length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve accepts IDs with an uppercase pc_ prefix and uppercase hex", () => {
  const directory = createTemporaryRepository();
  try {
    const added = addPapercut({ text: "case sensitivity", startDirectory: directory, now: FIXTURE_TS });
    const uppercased = "PC_" + added.record.id.slice(3).toUpperCase();
    const resolved = resolvePapercut({ idPrefix: uppercased, startDirectory: directory });
    assert.equal(resolved.changed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve rejects short prefixes", () => {
  const directory = createTemporaryRepository();
  try {
    assert.throws(
      () => resolvePapercut({ idPrefix: "abc", startDirectory: directory }),
      /at least 4 hexadecimal/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve reports not_found for unknown prefixes", () => {
  const directory = createTemporaryRepository();
  try {
    addPapercut({ text: "known papercut", startDirectory: directory, now: FIXTURE_TS });
    assert.throws(
      () => resolvePapercut({ idPrefix: "999999", startDirectory: directory }),
      /no papercut matches/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve lists candidates when a prefix is ambiguous", () => {
  const directory = createTemporaryRepository();
  writeRaw(directory, [
    JSON.stringify({ kind: "cut", id: "pc_111100000000", ts: "2026-08-01T00:00:00.000Z", agent: "opencode", text: "first", tags: [], severity: "minor", cwd: directory, repo: directory }),
    JSON.stringify({ kind: "cut", id: "pc_1111ffffffff", ts: "2026-08-02T00:00:00.000Z", agent: "opencode", text: "second", tags: [], severity: "minor", cwd: directory, repo: directory }),
  ].join("\n") + "\n");
  try {
    try {
      resolvePapercut({ idPrefix: "1111", startDirectory: directory });
      assert.fail("expected ambiguous_id error");
    } catch (error) {
      assert.ok(error instanceof PapercutsError);
      assert.equal(error.code, "ambiguous_id");
      assert.deepEqual(error.candidates, ["pc_111100000000", "pc_1111ffffffff"]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remove hides the papercut from lists and allows re-adding", () => {
  const directory = createTemporaryRepository();
  try {
    const added = addPapercut({ text: "not real friction", startDirectory: directory, now: FIXTURE_TS });
    const removed = removePapercut({
      idPrefix: added.record.id,
      startDirectory: directory,
      now: new Date("2026-08-04T00:00:00.000Z"),
    });
    assert.equal(removed.changed, true);
    assert.equal(listPapercuts({ status: "all", startDirectory: directory }).total, 0);

    const reAdded = addPapercut({ text: "not real friction", startDirectory: directory, now: new Date("2026-08-05T00:00:00.000Z") });
    assert.equal(reAdded.changed, true);
    assert.equal(listPapercuts({ status: "all", startDirectory: directory }).total, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("list sorts severity-first then newest and respects limit with truncation metadata", () => {
  const directory = createTemporaryRepository();
  try {
    addPapercut({ text: "old minor", startDirectory: directory, now: new Date("2026-08-01T00:00:00.000Z") });
    addPapercut({ text: "newer minor", startDirectory: directory, now: new Date("2026-08-02T00:00:00.000Z") });
    addPapercut({ text: "blocker", severity: "blocker", startDirectory: directory, now: new Date("2026-08-01T00:00:00.000Z") });
    addPapercut({ text: "major", severity: "major", startDirectory: directory, now: new Date("2026-08-01T00:00:00.000Z") });

    const listed = listPapercuts({ limit: 2, startDirectory: directory });
    assert.equal(listed.count, 2);
    assert.equal(listed.truncated, true);
    assert.equal(listed.total, 4);
    assert.equal(listed.items[0]?.cut.severity, "blocker");
    assert.equal(listed.items[1]?.cut.severity, "major");

    const untruncated = listPapercuts({ startDirectory: directory });
    assert.equal(untruncated.truncated, false);
    assert.equal(untruncated.count, 4);
    // Newest-first within the same severity.
    assert.equal(untruncated.items[2]?.cut.text, "newer minor");
    assert.equal(untruncated.items[3]?.cut.text, "old minor");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("list filters by tag and severity and succeeds when empty or missing file", () => {
  const directory = createTemporaryRepository();
  try {
    const missing = listPapercuts({ startDirectory: directory });
    assert.equal(missing.count, 0);
    assert.ok(missing.warnings.some((warning) => warning.includes("no papercuts file")));

    addPapercut({ text: "tagged", tag: "tooling", severity: "major", startDirectory: directory, now: FIXTURE_TS });
    addPapercut({ text: "untagged", startDirectory: directory, now: FIXTURE_TS });

    assert.equal(listPapercuts({ tag: "tooling", startDirectory: directory }).count, 1);
    assert.equal(listPapercuts({ severity: "major", startDirectory: directory }).count, 1);
    assert.equal(listPapercuts({ tag: "docs", startDirectory: directory }).count, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fold tolerates torn tails, malformed lines, unknown kinds, and orphan resolves", () => {
  const directory = createTemporaryRepository();
  try {
    const added = addPapercut({ text: "survives corruption", startDirectory: directory, now: FIXTURE_TS });
    appendRaw(directory, [
      '{"kind":"future"}',
      "not json at all",
      JSON.stringify({ kind: "resolve", id: "pc_000000000000", ts: "2026-08-02T00:00:00.000Z" }),
      '{"kind":"cut","id":"pc_bad","ts":"nope","text":"x","tags":[],"severity":"minor"}',
    ].join("\n") + "\n");
    // Torn final line: written without a trailing newline.
    appendFileSync(logPath(directory), '{"kind":"cut"', "utf8");

    const listed = listPapercuts({ status: "all", startDirectory: directory });
    assert.equal(listed.count, 1);
    assert.equal(listed.items[0]?.cut.id, added.record.id);
    assert.ok(listed.warnings.some((warning) => warning.includes("torn final line")));
    assert.ok(listed.warnings.some((warning) => /malformed lines?$/.test(warning)));
    assert.ok(listed.warnings.some((warning) => warning.includes("unknown event")));
    assert.ok(listed.warnings.some((warning) => warning.includes("orphan resolve")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("appends insert a separating newline when the log lacks a trailing newline", () => {
  const directory = createTemporaryRepository();
  const dirtyTail = '{"kind":"cut","id":"pc_aaaaaaaaaaaa"}';
  try {
    writeRaw(directory, dirtyTail);
    const result = addPapercut({ text: "after dirty tail", startDirectory: directory });
    assert.equal(result.changed, true);
    const raw = readFile(directory);
    assert.equal(raw, dirtyTail + "\n" + JSON.stringify(result.record) + "\n");
    const listed = listPapercuts({ status: "all", startDirectory: directory });
    assert.equal(listed.count, 1);
    assert.equal(listed.items[0]?.cut.text, "after dirty tail");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add stores lightweight evidence on tool failures and omits it otherwise", () => {
  const directory = createTemporaryRepository();
  try {
    const withEvidence = addPapercut({
      text: "command failed",
      cmd: "npm test -- --grep flaky",
      exitCode: 1,
      startDirectory: directory,
      now: FIXTURE_TS,
    });
    assert.equal(withEvidence.record.evidence?.cmd, "npm test -- --grep flaky");
    assert.equal(withEvidence.record.evidence?.exitCode, 1);

    const withoutEvidence = addPapercut({
      text: "no evidence",
      startDirectory: directory,
      now: new Date("2026-08-06T00:00:00.000Z"),
    });
    assert.equal(withoutEvidence.record.evidence, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fold reports duplicate cut and duplicate resolve warnings with a single item", () => {
  const directory = createTemporaryRepository();
  try {
    const added = addPapercut({ text: "logged twice", startDirectory: directory, now: FIXTURE_TS });
    const firstLine = readFile(directory).trim();
    // Same id (content-addressed), conflicting payload.
    appendRaw(directory, JSON.stringify({ ...JSON.parse(firstLine), ts: "2026-08-07T00:00:00.000Z" }));
    const resolveLine = JSON.stringify({
      kind: "resolve",
      id: added.record.id,
      ts: "2026-08-08T00:00:00.000Z",
      agent: "opencode",
    });
    appendRaw(directory, resolveLine);
    appendRaw(directory, resolveLine);

    const listed = listPapercuts({ status: "all", startDirectory: directory });
    assert.equal(listed.count, 1);
    assert.ok(listed.warnings.some((warning) => warning === "skipped 1 duplicate cut"));
    assert.ok(listed.warnings.some((warning) => warning === "skipped 1 duplicate resolve"));
    assert.equal(listed.items[0]?.status, "resolved");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remove is idempotent and does not append a second remove event", () => {
  const directory = createTemporaryRepository();
  try {
    const added = addPapercut({ text: "transient complaint", startDirectory: directory, now: FIXTURE_TS });
    const first = removePapercut({ idPrefix: added.record.id, startDirectory: directory, now: new Date("2026-08-04T00:00:00.000Z") });
    assert.equal(first.changed, true);
    const lineCountAfterFirst = readFile(directory).trim().split("\n").length;

    const second = removePapercut({ idPrefix: added.record.id, startDirectory: directory });
    assert.equal(second.changed, false);
    assert.ok(second.warnings.some((warning) => warning.includes("already removed")));
    assert.equal(readFile(directory).trim().split("\n").length, lineCountAfterFirst);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve cannot target an already-removed papercut and remove stays idempotent", () => {
  const directory = createTemporaryRepository();
  try {
    const added = addPapercut({ text: "gone", startDirectory: directory, now: FIXTURE_TS });
    removePapercut({ idPrefix: added.record.id, startDirectory: directory, now: new Date("2026-08-04T00:00:00.000Z") });
    assert.throws(
      () => resolvePapercut({ idPrefix: added.record.id, startDirectory: directory }),
      /no papercut matches/,
    );
    const secondRemove = removePapercut({ idPrefix: added.record.id, startDirectory: directory });
    assert.equal(secondRemove.changed, false);
    assert.ok(secondRemove.warnings.some((warning) => warning.includes("already removed")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setMuted appends a mute event and status reports it", () => {
  const directory = createTemporaryRepository();
  try {
    const result = setMuted({ muted: true, startDirectory: directory, now: FIXTURE_TS });
    assert.equal(result.changed, true);
    assert.equal(result.muted, true);
    assert.equal(result.event?.kind, "mute");
    assert.equal(result.event?.ts, "2026-08-01T12:00:00.000Z");
    const record = JSON.parse(readFile(directory).trim());
    assert.equal(record.kind, "mute");
    assert.equal(record.agent, "opencode");

    const status = papercutStatus({ startDirectory: directory });
    assert.equal(status.muted, true);
    assert.equal(status.exists, true);
    assert.equal(status.file, logPath(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mute state folds last-wins across mute and unmute events", () => {
  const directory = createTemporaryRepository();
  try {
    appendRaw(directory, [
      JSON.stringify({ kind: "unmute", ts: "2026-08-01T00:00:00.000Z", agent: "opencode" }),
      JSON.stringify({ kind: "mute", ts: "2026-08-02T00:00:00.000Z", agent: "opencode" }),
    ].join("\n"));
    assert.equal(papercutStatus({ startDirectory: directory }).muted, true);
    appendRaw(directory, JSON.stringify({ kind: "unmute", ts: "2026-08-03T00:00:00.000Z", agent: "opencode" }));
    assert.equal(papercutStatus({ startDirectory: directory }).muted, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setMuted is idempotent and does not append a second event in the same state", () => {
  const directory = createTemporaryRepository();
  try {
    setMuted({ muted: true, startDirectory: directory });
    const again = setMuted({ muted: true, startDirectory: directory });
    assert.equal(again.changed, false);
    assert.equal(again.muted, true);
    assert.ok(again.warnings.some((warning) => warning.includes("already muted")));
    assert.equal(readFile(directory).trim().split("\n").length, 1);

    const unmuted = setMuted({ muted: false, startDirectory: directory });
    assert.equal(unmuted.changed, true);
    assert.equal(unmuted.event?.kind, "unmute");
    const againUnmuted = setMuted({ muted: false, startDirectory: directory });
    assert.equal(againUnmuted.changed, false);
    assert.ok(againUnmuted.warnings.some((warning) => warning.includes("already unmuted")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setMuted creates the journal on first write and attributes the agent", () => {
  const directory = createTemporaryRepository();
  try {
    const result = setMuted({ muted: true, startDirectory: directory, agent: "tui" });
    assert.equal(result.changed, true);
    assert.equal(existsSync(logPath(directory)), true);
    const record = JSON.parse(readFile(directory).trim());
    assert.equal(record.agent, "tui");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("papercutStatus on a missing journal reports unmuted without creating a file", () => {
  const directory = createTemporaryRepository();
  try {
    const status = papercutStatus({ startDirectory: directory });
    assert.equal(status.muted, false);
    assert.equal(status.exists, false);
    assert.equal(existsSync(logPath(directory)), false);
    assert.ok(status.warnings.some((warning) => warning.includes("no papercuts file")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fold treats malformed mute events as malformed lines and keeps the prior state", () => {
  const directory = createTemporaryRepository();
  try {
    appendRaw(directory, JSON.stringify({ kind: "mute", ts: "2026-08-01T00:00:00.000Z", agent: "opencode" }));
    appendRaw(directory, '{"kind":"mute"}');
    const status = papercutStatus({ startDirectory: directory });
    assert.equal(status.muted, true);
    assert.ok(status.warnings.some((warning) => /malformed lines?$/.test(warning)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fold defaults to unmuted when the journal has no mute events", () => {
  const directory = createTemporaryRepository();
  try {
    addPapercut({ text: "plain cut", startDirectory: directory, now: FIXTURE_TS });
    assert.equal(papercutStatus({ startDirectory: directory }).muted, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function appendRaw(directory: string, content: string) {
  appendFileSync(logPath(directory), content.endsWith("\n") ? content : content + "\n", "utf8");
}

function writeRaw(directory: string, content: string) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(logPath(directory), content, "utf8");
}
