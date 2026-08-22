import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SUITE_OPTIONS,
  gradeRun,
  gradeSuite,
  parseJournal,
  type Expectation,
} from "../scripts/grader.ts";

const TS = "2026-08-01T12:00:00.000Z";

function cut(id: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    kind: "cut",
    id,
    ts: TS,
    agent: "opencode",
    text: `friction ${id}`,
    tags: [],
    severity: "minor",
    cwd: "/repo",
    repo: "/repo",
    ...overrides,
  });
}

function resolveEvent(id: string) {
  return JSON.stringify({ kind: "resolve", id, ts: TS, agent: "opencode" });
}

function removeEvent(id: string) {
  return JSON.stringify({ kind: "remove", id, ts: TS, agent: "opencode" });
}

function journal(...lines: string[]) {
  return Buffer.from(lines.length > 0 ? lines.join("\n") + "\n" : "", "utf8");
}

function grade(expectation: Expectation, bytes: Buffer, toolCalls: Record<string, number> = {}, timedOut = false) {
  return gradeRun({ expectation, journal: parseJournal(bytes), toolCalls, timedOut });
}

test("clean session with no papercut activity passes with zero spurious filings", () => {
  const result = grade("clean", journal());
  assert.equal(result.passed, true);
  assert.equal(result.spuriousFilings, 0);
});

test("clean session that files a papercut fails the over-trigger metric", () => {
  const result = grade("clean", journal(cut("pc_aaaaaaaaaaaa")));
  assert.equal(result.passed, false);
  assert.equal(result.spuriousFilings, 1);
  assert.match(result.reasons[0]!, /filed without seeded friction/);
});

test("clean session whose add call produced no record still counts as spurious", () => {
  const result = grade("clean", journal(), { papercuts_add: 1 });
  assert.equal(result.passed, false);
  assert.equal(result.spuriousFilings, 1);
  assert.match(result.reasons[0]!, /without producing a record/);
});

test("friction session with a standing filing passes and reports recall metrics", () => {
  const result = grade("friction", journal(cut("pc_aaaaaaaaaaaa"), cut("pc_bbbbbbbbbbbb")), { papercuts_add: 2 });
  assert.equal(result.passed, true);
  assert.equal(result.filings, 2);
  assert.equal(result.openFilings, 2);
  assert.equal(result.duplicateAddCalls, 0);
});

test("friction session whose only filing was retracted as a false positive fails", () => {
  const result = grade(
    "friction",
    journal(cut("pc_aaaaaaaaaaaa"), removeEvent("pc_aaaaaaaaaaaa")),
    { papercuts_add: 1 },
  );
  assert.equal(result.filings, 0);
  assert.equal(result.retractedFilings, 1);
  assert.equal(result.passed, false);
  assert.match(result.reasons[0]!, /retracted as a false positive/);
});

test("friction session that files and then resolves its own fix still demonstrates recall", () => {
  const result = grade(
    "friction",
    journal(cut("pc_aaaaaaaaaaaa"), resolveEvent("pc_aaaaaaaaaaaa")),
    { papercuts_add: 1 },
  );
  assert.equal(result.passed, true);
  assert.equal(result.filings, 1);
  assert.equal(result.openFilings, 0);
  assert.equal(result.resolvedFilings, 1);
});

test("redundant add calls beyond distinct filings surface as duplicates", () => {
  const result = grade("friction", journal(cut("pc_aaaaaaaaaaaa")), { papercuts_add: 3 });
  assert.equal(result.duplicateAddCalls, 2);
});

test("ambiguous session fails when assigned-task friction is left open", () => {
  const result = grade("ambiguous", journal(cut("pc_aaaaaaaaaaaa")), { papercuts_add: 1 });
  assert.equal(result.passed, false);
  assert.match(result.reasons[0]!, /left open/);
});

test("ambiguous session passes when unfiled, or filed and then self-resolved", () => {
  assert.equal(grade("ambiguous", journal()).passed, true);
  assert.equal(
    grade("ambiguous", journal(cut("pc_aaaaaaaaaaaa"), resolveEvent("pc_aaaaaaaaaaaa"))).passed,
    true,
  );
});

test("a timed-out session fails regardless of expectation", () => {
  assert.equal(grade("clean", journal(), {}, true).passed, false);
  assert.equal(grade("friction", journal(cut("pc_aaaaaaaaaaaa")), {}, true).passed, false);
  assert.equal(grade("ambiguous", journal(), {}, true).passed, false);
});

test("suite gate allows up to maxCleanSpurious spurious filings and reports rates", () => {
  const cleanPass = grade("clean", journal());
  const cleanOneSpurious = grade("clean", journal(cut("pc_aaaaaaaaaaaa")));
  const frictionOk = grade("friction", journal(cut("pc_bbbbbbbbbbbb")));
  const ambiguousOk = grade("ambiguous", journal());

  const withinGate = gradeSuite([cleanPass, cleanOneSpurious, frictionOk, ambiguousOk]);
  assert.equal(withinGate.cleanSpurious, 1);
  assert.equal(withinGate.passed, true);

  const overGate = gradeSuite([cleanOneSpurious, cleanOneSpurious, frictionOk, ambiguousOk]);
  assert.equal(overGate.cleanSpurious, 2);
  assert.equal(overGate.passed, false);
  assert.match(overGate.failures[0]!, /over-triggering gate/);
  assert.deepEqual(DEFAULT_SUITE_OPTIONS.maxCleanSpurious, 1);
});

test("suite gates fail on missed recall or unresolved ambiguous filings", () => {
  const missedRecall = gradeSuite([grade("clean", journal()), grade("friction", journal())]);
  assert.equal(missedRecall.passed, false);
  assert.match(missedRecall.failures[0]!, /recall gate/);

  const noisyAmbiguous = gradeSuite([
    grade("clean", journal()),
    grade("friction", journal(cut("pc_aaaaaaaaaaaa"))),
    grade("ambiguous", journal(cut("pc_bbbbbbbbbbbb"))),
  ]);
  assert.equal(noisyAmbiguous.passed, false);
  assert.match(noisyAmbiguous.failures[0]!, /precision-boundary gate/);
});

test("parseJournal tolerates torn and malformed lines while surfacing warnings", () => {
  const parsed = parseJournal(
    Buffer.from(cut("pc_aaaaaaaaaaaa") + "\n" + "not json\n" + '{"kind":"cut"', "utf8"),
  );
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.warnings.length, 2);
});
