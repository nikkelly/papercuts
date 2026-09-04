import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALLER = join(REPO_ROOT, "scripts", "install-opencode.mjs");

function temporaryProject() {
  return mkdtempSync(join(tmpdir(), "papercuts-project-"));
}

function runInstaller(project: string, ...args: string[]) {
  return spawnSync(process.execPath, [INSTALLER, ...args], {
    cwd: project,
    encoding: "utf8",
  });
}

test("install:opencode wires plugin, skills, and TUI into a fresh project", () => {
  const project = temporaryProject();
  try {
    const result = runInstaller(project);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const opencode = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    assert.ok(opencode.plugin.some((p: string) => p.endsWith("/src/index.ts")));
    assert.ok(opencode.skills.paths.some((p: string) => p.endsWith("/skills")));

    const tui = JSON.parse(readFileSync(join(project, ".opencode", "tui.json"), "utf8"));
    assert.ok(tui.plugin.some((p: string) => p.endsWith("/src/tui.tsx")));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("install:opencode merges into existing config and is idempotent", () => {
  const project = temporaryProject();
  try {
    writeFileSync(
      join(project, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["./src/other.ts"] }, null, 2),
    );
    const first = runInstaller(project);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const opencode = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    assert.equal(opencode.plugin.length, 2);
    assert.equal(opencode.plugin[0], "./src/other.ts");
    assert.equal(opencode.$schema, "https://opencode.ai/config.json");

    const second = runInstaller(project);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /already wired/);
    const after = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    assert.equal(after.plugin.length, 2);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("install:opencode fails loudly on a JSONC config", () => {
  const project = temporaryProject();
  try {
    writeFileSync(join(project, "opencode.json"), "{ \"plugin\": [ // comment\n ] }");
    const result = runInstaller(project);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not valid JSON/);
    assert.match(result.stderr, /add the papercuts entries manually/);
    // A clean error report, not an uncaught crash: no stack-trace frames.
    assert.doesNotMatch(result.stderr, /^ +at /m, result.stderr);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});