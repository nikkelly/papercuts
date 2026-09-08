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

function temporaryShareDir() {
  return mkdtempSync(join(tmpdir(), "papercuts-share-"));
}

function runInstaller(project: string, shareDir: string, ...args: string[]) {
  return spawnSync(process.execPath, [INSTALLER, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, PAPERCUTS_SHARE_DIR: shareDir },
  });
}

test("install:opencode wires plugin, skills, and TUI at stable share paths", () => {
  const project = temporaryProject();
  const shareDir = temporaryShareDir();
  try {
    const result = runInstaller(project, shareDir);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const opencode = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    const plugin = opencode.plugin as string[];
    assert.equal(plugin.length, 1);
    assert.ok(plugin[0]!.startsWith(shareDir), plugin[0]);
    assert.ok(plugin[0]!.endsWith("/opencode/src/index.ts"));
    const paths = opencode.skills.paths as string[];
    assert.equal(paths.length, 1);
    assert.ok(paths[0]!.endsWith("/opencode/skills"));

    const tui = JSON.parse(readFileSync(join(project, ".opencode", "tui.json"), "utf8"));
    const tuiPlugin = tui.plugin as string[];
    assert.equal(tuiPlugin.length, 1);
    assert.ok(tuiPlugin[0]!.endsWith("/opencode/src/tui.tsx"));

    assert.ok(existsSync(join(shareDir, "opencode", "src", "index.ts")));
    assert.ok(existsSync(join(shareDir, "opencode", "src", "tui.tsx")));
    assert.ok(existsSync(join(shareDir, "opencode", "plugin", "src", "journal.ts")));
    assert.ok(existsSync(join(shareDir, "opencode", "skills", "review-papercuts", "SKILL.md")));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(shareDir, { recursive: true, force: true });
  }
});

test("install:opencode merges into existing config and is idempotent", () => {
  const project = temporaryProject();
  const shareDir = temporaryShareDir();
  try {
    writeFileSync(
      join(project, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["./src/other.ts"] }, null, 2),
    );
    const first = runInstaller(project, shareDir);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const opencode = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    assert.equal(opencode.plugin.length, 2);
    assert.equal(opencode.plugin[0], "./src/other.ts");
    assert.equal(opencode.$schema, "https://opencode.ai/config.json");

    const second = runInstaller(project, shareDir);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /already wired/);
    const after = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    assert.equal(after.plugin.length, 2);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(shareDir, { recursive: true, force: true });
  }
});

test("install:opencode fails loudly on a JSONC config", () => {
  const project = temporaryProject();
  const shareDir = temporaryShareDir();
  try {
    writeFileSync(join(project, "opencode.json"), "{ \"plugin\": [ // comment\n ] }");
    const result = runInstaller(project, shareDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not valid JSON/);
    assert.match(result.stderr, /add the papercuts entries manually/);
    // A clean error report, not an uncaught crash: no stack-trace frames.
    assert.doesNotMatch(result.stderr, /^ +at /m, result.stderr);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(shareDir, { recursive: true, force: true });
  }
});

test("recorded entries are replaced, not accumulated, when the install moves", () => {
  const project = temporaryProject();
  const shareDir = temporaryShareDir();
  try {
    const oldPlugin = "/tmp/oldclone/opencode/src/index.ts";
    const oldSkills = "/tmp/oldclone/opencode/skills";
    const oldTui = "/tmp/oldclone/opencode/src/tui.tsx";

    writeFileSync(
      join(project, "opencode.json"),
      JSON.stringify({ plugin: [oldPlugin], skills: { paths: [oldSkills] } }, null, 2),
    );
    mkdirSync(join(project, ".opencode"), { recursive: true });
    writeFileSync(join(project, ".opencode", "tui.json"), JSON.stringify({ plugin: [oldTui] }, null, 2));
    mkdirSync(shareDir, { recursive: true });
    writeFileSync(
      join(shareDir, "installed-entries.json"),
      JSON.stringify(
        {
          entries: {
            [join(project, "opencode.json")]: { plugin: oldPlugin, skills: oldSkills, tui: null },
            [join(project, ".opencode", "tui.json")]: { plugin: null, skills: null, tui: oldTui },
          },
        },
        null,
        2,
      ),
    );

    const result = runInstaller(project, shareDir);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const opencode = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    const plugins = opencode.plugin as string[];
    assert.ok(!plugins.includes(oldPlugin), "dead entry should be replaced");
    assert.equal(plugins.filter((p: string) => p.endsWith("/src/index.ts")).length, 1);
    const paths = opencode.skills.paths as string[];
    assert.ok(!paths.includes(oldSkills), "dead skills path should be replaced");
    assert.equal(paths.filter((p: string) => p.endsWith("/opencode/skills")).length, 1);

    const tui = JSON.parse(readFileSync(join(project, ".opencode", "tui.json"), "utf8"));
    const tuiPlugin = tui.plugin as string[];
    assert.ok(!tuiPlugin.includes(oldTui), "dead tui entry should be replaced");
    assert.equal(tuiPlugin.filter((p: string) => p.endsWith("/src/tui.tsx")).length, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(shareDir, { recursive: true, force: true });
  }
});

test("without a manifest record a foreign entry is left alone", () => {
  const project = temporaryProject();
  const shareDir = temporaryShareDir();
  try {
    const foreign = "/tmp/someone-elses-plugin/src/index.ts";
    writeFileSync(join(project, "opencode.json"), JSON.stringify({ plugin: [foreign] }, null, 2));

    const result = runInstaller(project, shareDir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const opencode = JSON.parse(readFileSync(join(project, "opencode.json"), "utf8"));
    const plugins = opencode.plugin as string[];
    assert.deepEqual(plugins, [foreign, expectPluginEntry(shareDir)]);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(shareDir, { recursive: true, force: true });
  }
});

function expectPluginEntry(shareDir: string) {
  return join(shareDir, "opencode", "src", "index.ts");
}
