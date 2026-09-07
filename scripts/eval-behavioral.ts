import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseJournal, gradeRun, gradeSuite, type Expectation } from "./grader.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PLUGIN_ENTRY = join(REPO_ROOT, "src", "index.ts");
const TIMEOUT_MS = Number(process.env.PAPERCUTS_EVAL_TIMEOUT_MS ?? 300_000);
const MODEL = process.env.PAPERCUTS_EVAL_MODEL?.trim() || "";

interface ScenarioDef {
  name: string;
  kind: Expectation;
  runs: number;
  prompt: string;
  files: Record<string, string>;
}

const AGENT_INSTRUCTIONS = `## Papercuts

MANDATORY: whenever a command you ran fails unexpectedly — a nonzero exit you could not
have predicted from the task — you MUST file it before doing anything else, then push on:

      papercuts_add(text="what you hit and what would have prevented it", tag="<area>", cmd="<failed command>", exitCode=<code>)

Do not file failures that ARE the assigned task itself (e.g. a test you were told to fix).
Severity: minor (default) for annoyances, major for time sinks, blocker for hard walls.
Never include secrets.`;

function pkg(scripts: Record<string, string>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ name: "fixture", private: true, scripts, ...extra }, null, 2) + "\n";
}

const SCENARIOS: ScenarioDef[] = [
  {
    name: "friction-cwd-script",
    kind: "friction",
    runs: 2,
    prompt:
      "Run this project's test suite and report whether it passes. Do not modify package.json or anything in scripts/.",
    files: {
      "package.json": pkg({ test: "node scripts/run-tests.js" }),
      "README.md": "# fixture\n\nRun `npm test` to execute the suite.\n",
      "scripts/run-tests.js": `const { basename } = require("node:path");
if (basename(process.cwd()) !== "apps/web") {
  console.error("Error: Cannot find module '../fixtures/suite.json'");
  process.exit(1);
}
console.log("all 12 tests passed");
`,
      "apps/web/package.json": pkg({ name: "web" }),
    },
  },
  {
    name: "friction-dead-doc-command",
    kind: "friction",
    runs: 2,
    prompt:
      "Verify this project is healthy by following the verification steps in its README, then report status.",
    files: {
      "package.json": pkg({ test: "node test/smoke.test.js" }),
      "test/smoke.test.js": `console.log("pass");
`,
      "README.md": "# fixture\n\n## Verify\n\nRun the linter and the tests:\n\n    npm run lint\n    npm test\n",
    },
  },
  {
    name: "friction-broken-build-unrelated-task",
    kind: "friction",
    runs: 2,
    prompt:
      "Bump the version in package.json to 2.0.0, then confirm the build still works before you finish.",
    files: {
      "package.json": pkg({ build: "node scripts/build.js", version: "1.0.0" }),
      "scripts/build.js": `const { readFileSync } = require("node:fs");
const config = JSON.parse(readFileSync(require.resolve("./config.json"), "utf8"));
console.log("built", config.target);
`,
    },
  },
  {
    name: "clean-rename",
    kind: "clean",
    runs: 1,
    prompt: "Rename formatDate to formatIsoDate across the codebase. Keep the test passing.",
    files: {
      "package.json": pkg({ test: "node test/format.test.js" }),
      "lib/format.js": `function formatDate(iso) {
  return iso.slice(0, 10);
}
module.exports = { formatDate };
`,
      "test/format.test.js": `const assert = require("node:assert");
const { formatDate } = require("../lib/format.js");
assert.equal(formatDate("2026-08-01T12:00:00Z"), "2026-08-01");
console.log("pass");
`,
    },
  },
  {
    name: "clean-fix-typo",
    kind: "clean",
    runs: 1,
    prompt: 'Fix the typo in the greeting message ("Helo" should be "Hello").',
    files: {
      "src/greeting.js": `function greet(name) {
  return "Helo, " + name + "!";
}
module.exports = { greet };
`,
    },
  },
  {
    name: "clean-add-test",
    kind: "clean",
    runs: 1,
    prompt: "Add a unit test for slugify() in lib/slugify.js and make it pass with npm test.",
    files: {
      "package.json": pkg({ test: "node test/slugify.test.js" }),
      "lib/slugify.js": `function slugify(text) {
  return text.toLowerCase().trim().replace(/\\s+/g, "-");
}
module.exports = { slugify };
`,
    },
  },
  {
    name: "clean-extract-constant",
    kind: "clean",
    runs: 1,
    prompt: "Extract the tax rate 0.2 in src/total.js into a named constant TAX_RATE and keep the test green.",
    files: {
      "package.json": pkg({ test: "node test/total.test.js" }),
      "src/total.js": `function withTax(amount) {
  return amount * 1.2;
}
module.exports = { withTax };
`,
      "test/total.test.js": `const assert = require("node:assert");
const { withTax } = require("../src/total.js");
assert.equal(withTax(100), 120);
console.log("pass");
`,
    },
  },
  {
    name: "clean-doc-typo",
    kind: "clean",
    runs: 1,
    prompt: 'Fix the typo "repositoy" in README.md.',
    files: {
      "README.md": "# fixture\n\nA repositoy of utilities.\n",
    },
  },
  {
    name: "ambiguous-failing-test-is-the-task",
    kind: "ambiguous",
    runs: 1,
    prompt: "The test suite is failing. Fix src/math.js so npm test passes.",
    files: {
      "package.json": pkg({ test: "node test/math.test.js" }),
      "src/math.js": `function sum(a, b) {
  return a - b;
}
module.exports = { sum };
`,
      "test/math.test.js": `const assert = require("node:assert");
const { sum } = require("../src/math.js");
assert.equal(sum(2, 2), 4);
console.log("pass");
`,
    },
  },
  {
    name: "ambiguous-doc-mismatch-is-the-task",
    kind: "ambiguous",
    runs: 1,
    prompt:
      "docs/api.md claims parseValue returns null on bad input, but the implementation throws. Make the implementation match the documented behavior.",
    files: {
      "docs/api.md": "# API\n\n## parseValue(input)\n\nReturns the parsed number, or null when input is invalid.\n",
      "src/parse.js": `function parseValue(input) {
  const value = Number(input);
  if (Number.isNaN(value)) throw new Error("invalid input");
  return value;
}
module.exports = { parseValue };
`,
    },
  },
];

function buildFixture(scenario: ScenarioDef): string {
  const directory = mkdtempSync(join(tmpdir(), `papercuts-behavioral-${scenario.name}-`));
  mkdirSync(join(directory, ".git"));
  writeFileSync(
    join(directory, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [PLUGIN_ENTRY] }, null, 2) + "\n",
  );
  writeFileSync(join(directory, "AGENTS.md"), AGENT_INSTRUCTIONS + "\n");
  for (const [relative, content] of Object.entries(scenario.files)) {
    const target = join(directory, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return directory;
}

interface SessionResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runSession(fixture: string, prompt: string): Promise<SessionResult> {
  return new Promise((resolvePromise) => {
    const args = ["run", "--format", "json", "--auto"];
    if (MODEL) args.push("--model", MODEL);
    args.push(prompt);
    // stdin must not be an open pipe: `opencode run` drains non-TTY stdin until
    // EOF before starting, so a never-ended pipe blocks the child indefinitely.
    // PWD must point at the fixture: opencode resolves the project from $PWD,
    // not getcwd(), and would otherwise run sessions against this repository.
    const child = spawn("opencode", args, {
      cwd: fixture,
      env: { ...process.env, PWD: fixture },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", () => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr += String(error);
      resolvePromise({ stdout, stderr, timedOut: true });
    });
  });
}

function countToolCalls(stdout: string): Record<string, number> {
  const callIds = new Map<string, Set<string>>();
  const anonymous = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: { type?: string; part?: { type?: string; tool?: string; callID?: string } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "tool_use" || event.part?.type !== "tool" || !event.part.tool) continue;
    const name = event.part.tool;
    if (event.part.callID) {
      const seen = callIds.get(name) ?? new Set<string>();
      seen.add(event.part.callID);
      callIds.set(name, seen);
    } else {
      anonymous.set(name, (anonymous.get(name) ?? 0) + 1);
    }
  }
  const calls: Record<string, number> = {};
  for (const [name, ids] of [...callIds, ...anonymous]) {
    calls[name] = (callIds.get(name)?.size ?? 0) + (anonymous.get(name) ?? 0);
  }
  return calls;
}

function parseArgs(argv: string[]) {
  let only = "";
  let repeat = 1;
  let keep = false;
  for (const arg of argv) {
    if (arg.startsWith("--only=")) only = arg.slice(7);
    else if (arg.startsWith("--repeat=")) repeat = Math.max(1, Number(arg.slice(9)) || 1);
    else if (arg === "--keep") keep = true;
    else if (arg !== "--keep") {
      console.error(`unknown argument: ${arg}`);
      console.error("usage: node scripts/eval-behavioral.ts [--only=<substring>] [--repeat=<n>] [--keep]");
      process.exit(2);
    }
  }
  return { only, repeat, keep };
}

const { only, repeat, keep } = parseArgs(process.argv.slice(2));
const scenarios = SCENARIOS.filter((scenario) => scenario.name.includes(only));

console.log(
  `Behavioral eval: ${scenarios.length} scenario(s), model=${MODEL || "opencode default"}, timeout=${TIMEOUT_MS / 1000}s/run`,
);

const grades = [];

for (const scenario of scenarios) {
  for (let index = 0; index < scenario.runs * repeat; index += 1) {
    const label = `${scenario.name}#${index + 1}`;
    const fixture = buildFixture(scenario);
    let grade;
    let timedOut = false;
    try {
      const session = await runSession(fixture, scenario.prompt);
      timedOut = session.timedOut;
      const journalPath = join(fixture, ".papercuts.jsonl");
      const journal = parseJournal(existsSync(journalPath) ? readFileSync(journalPath) : Buffer.alloc(0));
      grade = gradeRun({
        expectation: scenario.kind,
        journal,
        toolCalls: countToolCalls(session.stdout),
        timedOut: session.timedOut,
      });
      if (!grade.passed && session.stderr.trim()) {
        console.log(`        stderr: ${session.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`);
      }
      if (grade.filings > 0 && scenario.kind === "clean") {
        for (const item of journal.items) {
          console.log(`        spurious filing: ${item.cut.text}`);
        }
      }
    } finally {
      if (!keep) rmSync(fixture, { recursive: true, force: true });
      else console.log(`        fixture kept: ${fixture}`);
    }
    grades.push(grade);
    const verdict = grade.passed ? "PASS" : "FAIL";
    console.log(
      `  ${verdict}  ${label.padEnd(45)} filings=${grade.filings} open=${grade.openFilings} addCalls=${grade.addCalls}` +
        `${timedOut ? " TIMED_OUT" : ""}${grade.reasons.length > 0 ? " :: " + grade.reasons.join("; ") : ""}`,
    );
  }
}

const suite = gradeSuite(grades);
console.log(
  `\nSuite: cleanRuns=${suite.cleanRuns} cleanSpurious=${suite.cleanSpurious}` +
    ` recall=${suite.frictionPassed}/${suite.frictionTotal}` +
    ` ambiguous=${suite.ambiguousPassed}/${suite.ambiguousTotal}` +
    ` duplicateAddCalls=${suite.duplicateAddCalls}`,
);
for (const failure of suite.failures) {
  console.log(`  GATE FAIL: ${failure}`);
}
console.log(suite.passed ? "\nGATE: PASSED" : "\nGATE: FAILED");

process.exit(suite.passed && grades.length > 0 ? 0 : 1);
