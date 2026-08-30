import assert from "node:assert/strict";
import test from "node:test";

import type { CutRecord, ListItem, Severity } from "../plugin/src/store.ts";
import {
  breakdownLine,
  collapsible,
  computeStats,
  formatLines,
  isVisible,
  level,
  summarySegments,
} from "../src/tui-stats.ts";

const NOW = new Date(2026, 7, 22, 15, 30, 0);

function cut(overrides: Partial<CutRecord> = {}): CutRecord {
  return {
    kind: "cut",
    id: "pc_000000000001",
    ts: new Date(2026, 7, 22, 9, 0, 0).toISOString(),
    agent: "opencode",
    text: "a papercut",
    tags: [],
    severity: "minor",
    cwd: "/tmp",
    repo: null,
    ...overrides,
  };
}

function item(overrides: {
  cut?: Partial<CutRecord>;
  status?: "open" | "resolved";
  resolvedAt?: string;
}): ListItem {
  const record = cut(overrides.cut);
  if (overrides.status === "resolved") {
    return {
      cut: record,
      status: "resolved",
      resolution: {
        ts: overrides.resolvedAt ?? new Date(2026, 7, 22, 12, 0, 0).toISOString(),
        agent: "opencode",
      },
    };
  }
  return { cut: record, status: "open" };
}

test("computeStats on empty input returns all zeros", () => {
  const stats = computeStats({ items: [] }, NOW);
  assert.deepEqual(stats, {
    open: 0,
    openedToday: 0,
    resolvedToday: 0,
    bySeverity: { minor: 0, major: 0, blocker: 0 },
  });
});

test("computeStats folds open versus resolved entries", () => {
  const stats = computeStats(
    {
      items: [
        item({}),
        item({ cut: { id: "pc_000000000002" } }),
        item({ cut: { id: "pc_000000000003" }, status: "resolved" }),
        item({
          cut: { id: "pc_000000000004" },
          status: "resolved",
          resolvedAt: new Date(2026, 7, 21, 8, 0, 0).toISOString(),
        }),
      ],
    },
    NOW,
  );
  assert.equal(stats.open, 2);
  assert.equal(stats.openedToday, 4);
  assert.equal(stats.resolvedToday, 1);
});

test("computeStats counts open entries per severity", () => {
  const severities: Severity[] = ["minor", "minor", "minor", "major", "blocker"];
  const stats = computeStats(
    {
      items: severities.map((severity, index) =>
        item({ cut: { id: `pc_${String(index).padStart(12, "0")}`, severity } }),
      ),
    },
    NOW,
  );
  assert.equal(stats.open, 5);
  assert.deepEqual(stats.bySeverity, { minor: 3, major: 1, blocker: 1 });
});

test("computeStats ignores severity of resolved entries", () => {
  const stats = computeStats(
    { items: [item({ cut: { severity: "blocker" }, status: "resolved" })] },
    NOW,
  );
  assert.equal(stats.open, 0);
  assert.deepEqual(stats.bySeverity, { minor: 0, major: 0, blocker: 0 });
});

test("openedToday and resolvedToday follow local day boundaries", () => {
  const justBeforeMidnight = new Date(2026, 7, 21, 23, 59, 59).toISOString();
  const justAfterMidnight = new Date(2026, 7, 22, 0, 0, 0).toISOString();
  const stats = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a", ts: justBeforeMidnight } }),
        item({ cut: { id: "pc_00000000000b", ts: justAfterMidnight } }),
        item({
          cut: { id: "pc_00000000000c" },
          status: "resolved",
          resolvedAt: justBeforeMidnight,
        }),
        item({
          cut: { id: "pc_00000000000d" },
          status: "resolved",
          resolvedAt: justAfterMidnight,
        }),
      ],
    },
    NOW,
  );
  assert.equal(stats.openedToday, 3);
  assert.equal(stats.resolvedToday, 1);
});

test("level returns error for any open blocker", () => {
  const stats = computeStats(
    { items: [item({ cut: { severity: "blocker" } })] },
    NOW,
  );
  assert.equal(level(stats), "error");
});

test("level returns warning for two or more open majors", () => {
  const oneMajor = computeStats(
    { items: [item({ cut: { severity: "major" } })] },
    NOW,
  );
  assert.equal(level(oneMajor), "muted");
  const twoMajors = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a", severity: "major" } }),
        item({ cut: { id: "pc_00000000000b", severity: "major" } }),
      ],
    },
    NOW,
  );
  assert.equal(level(twoMajors), "warning");
});

test("level returns warning for three or more papercuts opened today", () => {
  const twoToday = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a" } }),
        item({ cut: { id: "pc_00000000000b", ts: new Date(2026, 7, 22, 10).toISOString() } }),
      ],
    },
    NOW,
  );
  assert.equal(level(twoToday), "muted");
  const threeToday = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a" } }),
        item({ cut: { id: "pc_00000000000b", ts: new Date(2026, 7, 22, 10).toISOString() } }),
        item({ cut: { id: "pc_00000000000c", ts: new Date(2026, 7, 22, 11).toISOString() } }),
      ],
    },
    NOW,
  );
  assert.equal(level(threeToday), "warning");
});

test("level returns muted otherwise", () => {
  const calm = computeStats(
    { items: [item({ cut: { ts: new Date(2026, 7, 20, 9).toISOString() } })] },
    NOW,
  );
  assert.equal(calm.open, 1);
  assert.equal(calm.openedToday, 0);
  assert.equal(level(calm), "muted");
});

test("computeStats tolerates unparseable timestamps", () => {
  const stats = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a", ts: "not-a-date" } }),
        item({
          cut: { id: "pc_00000000000b", ts: "" },
          status: "resolved",
          resolvedAt: "",
        }),
      ],
    },
    NOW,
  );
  assert.equal(stats.open, 1);
  assert.equal(stats.openedToday, 0);
  assert.equal(stats.resolvedToday, 0);
});

test("computeStats ignores future-dated cuts for openedToday", () => {
  const stats = computeStats(
    { items: [item({ cut: { ts: new Date(2027, 0, 1).toISOString() } })] },
    NOW,
  );
  assert.equal(stats.openedToday, 0);
});

test("isVisible is false only when nothing is open and nothing happened today", () => {
  const empty = computeStats({ items: [] }, NOW);
  assert.equal(isVisible(empty), false);
  const allResolvedYesterday = computeStats(
    {
      items: [
        item({
          cut: { ts: new Date(2026, 7, 20).toISOString() },
          status: "resolved",
          resolvedAt: new Date(2026, 7, 21).toISOString(),
        }),
      ],
    },
    NOW,
  );
  assert.equal(isVisible(allResolvedYesterday), false);
  const resolvedToday = computeStats(
    {
      items: [
        item({
          cut: { ts: new Date(2026, 7, 20).toISOString() },
          status: "resolved",
        }),
      ],
    },
    NOW,
  );
  assert.equal(isVisible(resolvedToday), true);
});

test("isVisible returns false when the widget is muted even with open friction", () => {
  const busy = computeStats(
    {
      items: [
        item({ cut: { severity: "blocker" } }),
        item({ cut: { id: "pc_00000000000b" } }),
      ],
    },
    NOW,
  );
  assert.equal(isVisible(busy), true);
  assert.equal(isVisible(busy, false), true);
  assert.equal(isVisible(busy, true), false);
  const empty = computeStats({ items: [] }, NOW);
  assert.equal(isVisible(empty, true), false);
});

test("summarySegments pluralizes and omits zero segments", () => {
  const single = computeStats(
    { items: [item({ cut: { severity: "blocker" } })] },
    NOW,
  );
  assert.deepEqual(summarySegments(single), ["1 open papercut", "+1 today", "1 blocker"]);
  const many = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a", severity: "blocker" } }),
        item({ cut: { id: "pc_00000000000b", severity: "blocker" } }),
        item({ cut: { id: "pc_00000000000c" } }),
      ],
    },
    NOW,
  );
  assert.deepEqual(summarySegments(many), ["3 open papercuts", "+3 today", "2 blockers"]);
  const quietOldOpen = computeStats(
    { items: [item({ cut: { ts: new Date(2026, 7, 20).toISOString() } })] },
    NOW,
  );
  assert.deepEqual(summarySegments(quietOldOpen), ["1 open papercut"]);
});

test("breakdownLine returns null when only minors are open", () => {
  const minorsOnly = computeStats(
    {
      items: [item({}), item({ cut: { id: "pc_00000000000b" } })],
    },
    NOW,
  );
  assert.equal(breakdownLine(minorsOnly), null);
});

test("breakdownLine omits zero severities and folds blockers into summary", () => {
  const mixed = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a", severity: "major" } }),
        item({ cut: { id: "pc_00000000000b", severity: "blocker" } }),
      ],
    },
    NOW,
  );
  assert.equal(breakdownLine(mixed), "1 major");
  const manyBlockers = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a", severity: "blocker" } }),
        item({ cut: { id: "pc_00000000000b", severity: "blocker" } }),
        item({ cut: { id: "pc_00000000000c", severity: "minor" } }),
      ],
    },
    NOW,
  );
  assert.equal(breakdownLine(manyBlockers), "1 minor · 2 blockers");
});

test("formatLines joins segments and appends breakdown when present", () => {
  const mixed = computeStats(
    {
      items: [
        item({ cut: { id: "pc_00000000000a", severity: "major" } }),
        item({ cut: { id: "pc_00000000000b" } }),
      ],
    },
    NOW,
  );
  assert.deepEqual(formatLines(mixed), [
    "2 open papercuts · +2 today",
    "1 minor · 1 major",
  ]);
  const minorsOnly = computeStats({ items: [item({})] }, NOW);
  assert.deepEqual(formatLines(minorsOnly), ["1 open papercut · +1 today"]);
});

test("collapsible mirrors the todo threshold of more than two open entries", () => {
  const twoOpen = computeStats(
    {
      items: [item({}), item({ cut: { id: "pc_00000000000b" } })],
    },
    NOW,
  );
  assert.equal(collapsible(twoOpen), false);
  const threeOpen = computeStats(
    {
      items: [
        item({}),
        item({ cut: { id: "pc_00000000000b" } }),
        item({ cut: { id: "pc_00000000000c" } }),
      ],
    },
    NOW,
  );
  assert.equal(collapsible(threeOpen), true);
  const resolvedDoNotCount = computeStats(
    {
      items: [
        item({}),
        item({
          cut: { id: "pc_00000000000b" },
          status: "resolved",
        }),
        item({
          cut: { id: "pc_00000000000c" },
          status: "resolved",
        }),
        item({
          cut: { id: "pc_00000000000d" },
          status: "resolved",
        }),
      ],
    },
    NOW,
  );
  assert.equal(collapsible(resolvedDoNotCount), false);
});
