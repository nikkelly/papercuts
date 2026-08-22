import { foldBytes, type ListItem } from "../plugin/src/store.ts";

export type Expectation = "friction" | "clean" | "ambiguous";

export interface ParsedJournal {
  items: ListItem[];
  removedCount: number;
  warnings: string[];
}

export function parseJournal(bytes: Buffer): ParsedJournal {
  const folded = foldBytes(bytes);
  return {
    items: folded.items,
    removedCount: folded.removedIds.size,
    warnings: folded.warnings,
  };
}

export interface RunInput {
  expectation: Expectation;
  journal: ParsedJournal;
  toolCalls: Record<string, number>;
  timedOut?: boolean;
}

export interface RunGrade {
  expectation: Expectation;
  filings: number;
  openFilings: number;
  resolvedFilings: number;
  retractedFilings: number;
  addCalls: number;
  duplicateAddCalls: number;
  spuriousFilings: number;
  passed: boolean;
  reasons: string[];
}

export function gradeRun(input: RunInput): RunGrade {
  const { expectation, journal, timedOut = false } = input;
  const addCalls = input.toolCalls["papercuts_add"] ?? 0;
  const filings = journal.items.length;
  const openFilings = journal.items.filter((item) => item.status === "open").length;
  const resolvedFilings = filings - openFilings;
  const duplicateAddCalls = Math.max(0, addCalls - filings);

  const reasons: string[] = [];
  let passed: boolean;

  if (expectation === "clean") {
    const spuriousFilings =
      filings > 0 ? filings : addCalls > 0 ? 1 : 0;
    passed = spuriousFilings === 0 && !timedOut;
    if (spuriousFilings > 0) {
      reasons.push(
        filings > 0
          ? `${filings} papercut${filings === 1 ? "" : "s"} filed without seeded friction`
          : "papercuts_add called without producing a record",
      );
    }
    if (timedOut) {
      reasons.push("session timed out; result may be incomplete");
    }
    return {
      expectation,
      filings,
      openFilings,
      resolvedFilings,
      retractedFilings: journal.removedCount,
      addCalls,
      duplicateAddCalls,
      spuriousFilings,
      passed,
      reasons,
    };
  }

  if (expectation === "friction") {
    if (filings === 0 && journal.removedCount === 0) {
      passed = false;
      reasons.push("no papercut filed despite seeded friction");
    } else if (filings === 0 && journal.removedCount > 0) {
      passed = false;
      reasons.push("every filing was retracted as a false positive");
    } else {
      passed = true;
      if (duplicateAddCalls > 0) {
        reasons.push(
          `${duplicateAddCalls} redundant papercuts_add call${duplicateAddCalls === 1 ? "" : "s"} (deduped by content address)`,
        );
      }
    }
  } else {
    // Ambiguous: the friction is the assigned task itself. Filing it is noise
    // unless the agent recognized that and resolved its own filing.
    passed = openFilings === 0 && !timedOut;
    if (openFilings > 0) {
      reasons.push(
        `${openFilings} assigned task${openFilings === 1 ? "" : "s"} filed as friction and left open`,
      );
    }
    if (timedOut) {
      reasons.push("session timed out; result may be incomplete");
    }
  }

  if (timedOut && expectation !== "ambiguous") {
    reasons.push("session timed out; result may be incomplete");
    passed = false;
  }

  return {
    expectation,
    filings,
    openFilings,
    resolvedFilings,
    retractedFilings: journal.removedCount,
    addCalls,
    duplicateAddCalls,
    spuriousFilings: 0,
    passed,
    reasons,
  };
}

export interface SuiteOptions {
  maxCleanSpurious: number;
  requireFrictionPass: boolean;
  requireAmbiguousPass: boolean;
}

export const DEFAULT_SUITE_OPTIONS: SuiteOptions = {
  maxCleanSpurious: 1,
  requireFrictionPass: true,
  requireAmbiguousPass: true,
};

export interface SuiteGrade {
  cleanRuns: number;
  cleanSpurious: number;
  frictionPassed: number;
  frictionTotal: number;
  ambiguousPassed: number;
  ambiguousTotal: number;
  duplicateAddCalls: number;
  passed: boolean;
  failures: string[];
}

export function gradeSuite(
  grades: RunGrade[],
  options: SuiteOptions = DEFAULT_SUITE_OPTIONS,
): SuiteGrade {
  const clean = grades.filter((grade) => grade.expectation === "clean");
  const friction = grades.filter((grade) => grade.expectation === "friction");
  const ambiguous = grades.filter((grade) => grade.expectation === "ambiguous");

  const cleanSpurious = clean.reduce((sum, grade) => sum + grade.spuriousFilings, 0);
  const failures: string[] = [];
  if (cleanSpurious > options.maxCleanSpurious) {
    failures.push(
      `over-triggering gate: ${cleanSpurious} spurious filing(s) across ${clean.length} clean session(s), allowed ${options.maxCleanSpurious}`,
    );
  }
  const frictionPassed = friction.filter((grade) => grade.passed).length;
  if (options.requireFrictionPass && friction.length > 0 && frictionPassed < friction.length) {
    failures.push(
      `recall gate: ${frictionPassed}/${friction.length} friction scenario run(s) produced a standing filing`,
    );
  }
  const ambiguousPassed = ambiguous.filter((grade) => grade.passed).length;
  if (options.requireAmbiguousPass && ambiguous.length > 0 && ambiguousPassed < ambiguous.length) {
    failures.push(
      `precision-boundary gate: ${ambiguousPassed}/${ambiguous.length} ambiguous run(s) left assigned tasks filed as open friction`,
    );
  }

  return {
    cleanRuns: clean.length,
    cleanSpurious,
    frictionPassed,
    frictionTotal: friction.length,
    ambiguousPassed,
    ambiguousTotal: ambiguous.length,
    duplicateAddCalls: grades.reduce((sum, grade) => sum + grade.duplicateAddCalls, 0),
    passed: failures.length === 0,
    failures,
  };
}
