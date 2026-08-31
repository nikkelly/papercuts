import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  Journal,
  PapercutsError,
} from "../plugin/src/journal.ts";

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

function open(dir: string, now: Date = FIXTURE_TS): Journal {
  return Journal.open({ startDirectory: dir, now: () => now });
}

test("add creates a JSONL cut record at the repository root", () => {
  const directory = createTemporaryRepository();
  try {
    const result = open(directory).add({ text: "the command needed an unexpected working directory" });
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
    Journal.open({ startDirectory: nested }).add({ text: "only worked from a specific directory" });
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
    const withNoRepo = Journal.open({ startDirectory: workdir, exists: () => false });
    assert.equal(withNoRepo.repo, null);
    assert.equal(withNoRepo.explicit, false);
    assert.equal(withNoRepo.path, join(workdir, ".papercuts.jsonl"));

    const result = Journal.open({ startDirectory: workdir, exists: () => false }).add({
      text: "no repo anywhere",
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
    Journal.open({
      startDirectory: directory,
      env: { PAPERCUTS_FILE: join(override, "log.jsonl") },
    }).add({ text: "private log" });
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
      () => open(directory).add({ text: "" }),
      /empty or whitespace/,
    );
    assert.throws(
      () => open(directory).add({ text: "   " }),
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
      () => open(directory).add({ text: "x".repeat(10_001) }),
      /maximum of 10000/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add is duplicate-safe and returns the existing record", () => {
  const directory = createTemporaryRepository();
  try {
    const first = open(directory).add({ text: "flaky command" });
    const second = open(directory, new Date("2026-08-02T12:00:00.000Z")).add({ text: "flaky command" });
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
    const result = open(directory).add({ text: "RESOLVED by pinning the dependency" });
    assert.ok(result.warnings.some((warning) => warning.includes("resolution")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add dedupes across agents and keeps the first filer's attribution", () => {
  const directory = createTemporaryRepository();
  try {
    const first = open(directory).add({ text: "shared friction" });
    assert.equal(first.record.agent, "opencode");
    const second = open(directory, new Date("2026-08-02T12:00:00.000Z")).add({
      text: "shared friction",
      agent: "codex",
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
    open(directory).add({ text: "from opencode" });
    open(directory, new Date("2026-08-02T00:00:00.000Z")).add({ text: "from codex", agent: "codex" });

    assert.equal(open(directory).list({}).total, 2);
    assert.equal(open(directory).list({ agent: "codex" }).count, 1);
    assert.equal(open(directory).list({ agent: "claude" }).count, 0);
    assert.throws(
      () => open(directory).list({ agent: "  " }),
      /empty or whitespace/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve appends an event, marks the item resolved, and folds it out of open lists", () => {
  const directory = createTemporaryRepository();
  try {
    const added = open(directory).add({ text: "broken link in docs" });

    const resolved = open(directory, new Date("2026-08-03T00:00:00.000Z")).resolve({
      idPrefix: added.record.id.slice(3, 7),
      note: "fixed the link",
    });
    assert.equal(resolved.changed, true);
    assert.equal(resolved.item.status, "resolved");
    assert.equal(resolved.item.resolution?.note, "fixed the link");

    const openList = open(directory).list({ status: "open" });
    assert.equal(openList.total, 0);
    const all = open(directory).list({ status: "all" });
    assert.equal(all.items[0]?.status, "resolved");

    const again = open(directory).resolve({ idPrefix: added.record.id });
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
    const added = open(directory).add({ text: "case sensitivity" });
    const uppercased = "PC_" + added.record.id.slice(3).toUpperCase();
    const resolved = open(directory).resolve({ idPrefix: uppercased });
    assert.equal(resolved.changed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve rejects short prefixes", () => {
  const directory = createTemporaryRepository();
  try {
    assert.throws(
      () => open(directory).resolve({ idPrefix: "abc" }),
      /at least 4 hexadecimal/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolve reports not_found for unknown prefixes", () => {
  const directory = createTemporaryRepository();
  try {
    open(directory).add({ text: "known papercut" });
    assert.throws(
      () => open(directory).resolve({ idPrefix: "999999" }),
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
      open(directory).resolve({ idPrefix: "1111" });
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
    const added = open(directory).add({ text: "not real friction" });
    const removed = open(directory, new Date("2026-08-04T00:00:00.000Z")).remove({ idPrefix: added.record.id });
    assert.equal(removed.changed, true);
    assert.equal(open(directory).list({ status: "all" }).total, 0);

    const reAdded = open(directory, new Date("2026-08-05T00:00:00.000Z")).add({ text: "not real friction" });
    assert.equal(reAdded.changed, true);
    assert.equal(open(directory).list({ status: "all" }).total, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("list sorts severity-first then newest and respects limit with truncation metadata", () => {
  const directory = createTemporaryRepository();
  try {
    open(directory, new Date("2026-08-01T00:00:00.000Z")).add({ text: "old minor" });
    open(directory, new Date("2026-08-02T00:00:00.000Z")).add({ text: "newer minor" });
    open(directory, new Date("2026-08-01T00:00:00.000Z")).add({ text: "blocker", severity: "blocker" });
    open(directory, new Date("2026-08-01T00:00:00.000Z")).add({ text: "major", severity: "major" });

    const listed = open(directory, new Date("2026-08-03T00:00:00.000Z")).list({ limit: 2 });
    assert.equal(listed.count, 2);
    assert.equal(listed.truncated, true);
    assert.equal(listed.total, 4);
    assert.equal(listed.items[0]?.cut.severity, "blocker");
    assert.equal(listed.items[1]?.cut.severity, "major");

    const untruncated = open(directory, new Date("2026-08-03T00:00:00.000Z")).list({});
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
    const missing = open(directory).list({});
    assert.equal(missing.count, 0);
    assert.ok(missing.warnings.some((warning) => warning.includes("no papercuts file")));

    open(directory).add({ text: "tagged", tag: "tooling", severity: "major" });
    open(directory).add({ text: "untagged" });

    assert.equal(open(directory).list({ tag: "tooling" }).count, 1);
    assert.equal(open(directory).list({ severity: "major" }).count, 1);
    assert.equal(open(directory).list({ tag: "docs" }).count, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fold tolerates torn tails, malformed lines, unknown kinds, and orphan resolves", () => {
  const directory = createTemporaryRepository();
  try {
    const added = open(directory).add({ text: "survives corruption" });
    appendRaw(directory, [
      '{"kind":"future"}',
      "not json at all",
      JSON.stringify({ kind: "resolve", id: "pc_000000000000", ts: "2026-08-02T00:00:00.000Z" }),
      '{"kind":"cut","id":"pc_bad","ts":"nope","text":"x","tags":[],"severity":"minor"}',
    ].join("\n") + "\n");
    // Torn final line: written without a trailing newline.
    appendFileSync(logPath(directory), '{"kind":"cut"', "utf8");

    const listed = open(directory).list({ status: "all" });
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
    const result = open(directory).add({ text: "after dirty tail" });
    assert.equal(result.changed, true);
    const raw = readFile(directory);
    assert.equal(raw, dirtyTail + "\n" + JSON.stringify(result.record) + "\n");
    const listed = open(directory).list({ status: "all" });
    assert.equal(listed.count, 1);
    assert.equal(listed.items[0]?.cut.text, "after dirty tail");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("add stores lightweight evidence on tool failures and omits it otherwise", () => {
  const directory = createTemporaryRepository();
  try {
    const withEvidence = open(directory).add({
      text: "command failed",
      cmd: "npm test -- --grep flaky",
      exitCode: 1,
    });
    assert.equal(withEvidence.record.evidence?.cmd, "npm test -- --grep flaky");
    assert.equal(withEvidence.record.evidence?.exitCode, 1);

    const withoutEvidence = open(directory, new Date("2026-08-06T00:00:00.000Z")).add({ text: "no evidence" });
    assert.equal(withoutEvidence.record.evidence, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fold reports duplicate cut and duplicate resolve warnings with a single item", () => {
  const directory = createTemporaryRepository();
  try {
    const added = open(directory).add({ text: "logged twice" });
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

    const listed = open(directory).list({ status: "all" });
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
    const added = open(directory).add({ text: "transient complaint" });
    const first = open(directory, new Date("2026-08-04T00:00:00.000Z")).remove({ idPrefix: added.record.id });
    assert.equal(first.changed, true);
    const lineCountAfterFirst = readFile(directory).trim().split("\n").length;

    const second = open(directory).remove({ idPrefix: added.record.id });
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
    const added = open(directory).add({ text: "gone" });
    open(directory, new Date("2026-08-04T00:00:00.000Z")).remove({ idPrefix: added.record.id });
    assert.throws(
      () => open(directory).resolve({ idPrefix: added.record.id }),
      /no papercut matches/,
    );
    const secondRemove = open(directory).remove({ idPrefix: added.record.id });
    assert.equal(secondRemove.changed, false);
    assert.ok(secondRemove.warnings.some((warning) => warning.includes("already removed")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setMuted appends a mute event and status reports it", () => {
  const directory = createTemporaryRepository();
  try {
    const result = open(directory).setMuted(true);
    assert.equal(result.changed, true);
    assert.equal(result.muted, true);
    assert.equal(result.event?.kind, "mute");
    assert.equal(result.event?.ts, "2026-08-01T12:00:00.000Z");
    const record = JSON.parse(readFile(directory).trim());
    assert.equal(record.kind, "mute");
    assert.equal(record.agent, "opencode");

    const status = open(directory).status();
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
    assert.equal(open(directory).status().muted, true);
    appendRaw(directory, JSON.stringify({ kind: "unmute", ts: "2026-08-03T00:00:00.000Z", agent: "opencode" }));
    assert.equal(open(directory).status().muted, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setMuted is idempotent and does not append a second event in the same state", () => {
  const directory = createTemporaryRepository();
  try {
    open(directory).setMuted(true);
    const again = open(directory).setMuted(true);
    assert.equal(again.changed, false);
    assert.equal(again.muted, true);
    assert.ok(again.warnings.some((warning) => warning.includes("already muted")));
    assert.equal(readFile(directory).trim().split("\n").length, 1);

    const unmuted = open(directory).setMuted(false);
    assert.equal(unmuted.changed, true);
    assert.equal(unmuted.event?.kind, "unmute");
    const againUnmuted = open(directory).setMuted(false);
    assert.equal(againUnmuted.changed, false);
    assert.ok(againUnmuted.warnings.some((warning) => warning.includes("already unmuted")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setMuted creates the journal on first write and attributes the agent", () => {
  const directory = createTemporaryRepository();
  try {
    const result = open(directory).setMuted(true, { agent: "tui" });
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
    const status = open(directory).status();
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
    const status = open(directory).status();
    assert.equal(status.muted, true);
    assert.ok(status.warnings.some((warning) => /malformed lines?$/.test(warning)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fold defaults to unmuted when the journal has no mute events", () => {
  const directory = createTemporaryRepository();
  try {
    open(directory).add({ text: "plain cut" });
    assert.equal(open(directory).status().muted, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preview exposes a read-only view without mutating the journal", () => {
  const directory = createTemporaryRepository();
  try {
    const missing = open(directory).preview();
    assert.equal(missing.items.length, 0);
    assert.equal(missing.muted, false);
    assert.equal(existsSync(logPath(directory)), false);

    open(directory).add({ text: "observable" });
    const preview = open(directory).preview();
    assert.equal(preview.items.length, 1);
    assert.equal(preview.items[0]?.cut.text, "observable");
    assert.equal(preview.muted, false);
    assert.equal(readFile(directory).trim().split("\n").length, 1);
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
