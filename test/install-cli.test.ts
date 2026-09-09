import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { installCli } from "../scripts/install-cli.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALLER = join(REPO_ROOT, "scripts", "install-cli.mjs");

function temporaryBinDir() {
  return mkdtempSync(join(tmpdir(), "papercuts-bin-"));
}

function temporaryShareDir() {
  return mkdtempSync(join(tmpdir(), "papercuts-share-"));
}

function temporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-cli-run-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

function runInstaller(shareDir: string, binDir: string) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, PAPERCUTS_BIN_DIR: binDir, PAPERCUTS_SHARE_DIR: shareDir },
  });
}

function runLinkedCli(binDir: string, directory: string, ...args: string[]) {
  return spawnSync(join(binDir, "papercuts"), args, {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PAPERCUTS_FILE: "" },
  });
}

function envelope(result: SpawnSyncReturns<string>) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  return parsed.data;
}

const SYSTEM_NODE = "/usr/bin/node";

function systemNodeMajor(): number {
  try {
    const out = spawnSync(SYSTEM_NODE, ["--version"], { encoding: "utf8" });
    if (out.status !== 0) return 0;
    return Number(out.stdout.trim().replace(/^v/, "").split(".")[0]);
  } catch {
    return 0;
  }
}

test("install:cli skips cleanly on Node < 22 instead of crashing", { skip: systemNodeMajor() >= 22 || systemNodeMajor() === 0 }, () => {
  const binDir = temporaryBinDir();
  const shareDir = temporaryShareDir();
  const result = spawnSync(SYSTEM_NODE, [INSTALLER], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, PAPERCUTS_BIN_DIR: binDir, PAPERCUTS_SHARE_DIR: shareDir },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SKIPPED: papercuts requires Node 22\+/);
  assert.match(result.stdout, /found v?18/);
  // No cryptic crash, no stack trace: a clean, actionable skip.
  assert.doesNotMatch(result.stderr, /ERR_INVALID_ARG_TYPE/);
  assert.doesNotMatch(result.stderr, /^ +at /m, result.stderr);
  // Nothing was installed.
  assert.equal(existsSync(join(binDir, "papercuts")), false);
  assert.equal(existsSync(join(shareDir, "plugin", "bin", "papercuts.mjs")), false);
});

/** A minimal fake clone carrying the three files the CLI bundle needs. */
function fakeClone() {
  const clone = mkdtempSync(join(tmpdir(), "papercuts-clone-"));
  mkdirSync(join(clone, "plugin", "bin"), { recursive: true });
  mkdirSync(join(clone, "plugin", "src"), { recursive: true });
  copyFileSync(join(REPO_ROOT, "plugin", "bin", "papercuts.mjs"), join(clone, "plugin", "bin", "papercuts.mjs"));
  copyFileSync(join(REPO_ROOT, "plugin", "src", "envelope.ts"), join(clone, "plugin", "src", "envelope.ts"));
  copyFileSync(join(REPO_ROOT, "plugin", "src", "journal.ts"), join(clone, "plugin", "src", "journal.ts"));
  return clone;
}

test("install:cli copies a self-contained bundle and links the command", () => {
  const shareDir = temporaryShareDir();
  const binDir = temporaryBinDir();
  const workDir = temporaryRepository();
  try {
    const install = runInstaller(shareDir, binDir);
    assert.equal(install.status, 0, install.stdout + install.stderr);
    const bundleBin = join(shareDir, "plugin", "bin", "papercuts.mjs");
    assert.equal(readlinkSync(join(binDir, "papercuts")), bundleBin);
    assert.ok(lstatSync(join(binDir, "papercuts")).isSymbolicLink());
    assert.ok(existsSync(bundleBin));
    assert.ok(existsSync(join(shareDir, "plugin", "src", "envelope.ts")));
    assert.ok(existsSync(join(shareDir, "plugin", "src", "journal.ts")));

    const data = envelope(runLinkedCli(binDir, workDir, "status"));
    assert.equal(typeof data.muted, "boolean");
    assert.equal(data.file, join(workDir, ".papercuts.jsonl"));
  } finally {
    rmSync(shareDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("install:cli is idempotent and refuses to clobber a foreign file", () => {
  const shareDir = temporaryShareDir();
  const binDir = temporaryBinDir();
  const foreignDir = temporaryBinDir();
  try {
    const first = runInstaller(shareDir, binDir);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const second = runInstaller(shareDir, binDir);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /already linked/);

    writeFileSync(join(foreignDir, "papercuts"), "#!/bin/sh\necho not papercuts\n");
    const clash = runInstaller(shareDir, foreignDir);
    assert.notEqual(clash.status, 0);
    assert.match(clash.stderr, /not the papercuts symlink/);
    assert.equal(readFileSync(join(foreignDir, "papercuts"), "utf8"), "#!/bin/sh\necho not papercuts\n");
  } finally {
    rmSync(shareDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
    rmSync(foreignDir, { recursive: true, force: true });
  }
});

test("the installed CLI keeps working after the clone is deleted", () => {
  const shareDir = temporaryShareDir();
  const binDir = temporaryBinDir();
  const clone = fakeClone();
  try {
    const result = installCli({ repoRoot: clone, shareDir, binDir });
    assert.equal(result.status, 0, result.lines.join("\n") + result.errors.join("\n"));
    rmSync(clone, { recursive: true, force: true });

    const workDir = temporaryRepository();
    try {
      const run = spawnSync(join(binDir, "papercuts"), ["status"], {
        cwd: workDir,
        encoding: "utf8",
        env: { ...process.env, PAPERCUTS_FILE: "" },
      });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(JSON.parse(run.stdout).ok, true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(shareDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("a stale papercuts link from another clone is repointed without error", () => {
  const shareDir = temporaryShareDir();
  const binDir = temporaryBinDir();
  const clone = fakeClone();
  try {
    mkdirSync(binDir, { recursive: true });
    symlinkSync(join(clone, "plugin", "bin", "papercuts.mjs"), join(binDir, "papercuts"));

    const result = installCli({ repoRoot: REPO_ROOT, shareDir, binDir });
    assert.equal(result.status, 0, result.lines.join("\n") + result.errors.join("\n"));
    assert.match(result.lines.join("\n"), /repointed stale papercuts link/);
    assert.equal(
      resolve(readlinkSync(join(binDir, "papercuts"))),
      resolve(join(shareDir, "plugin", "bin", "papercuts.mjs")),
    );
  } finally {
    rmSync(shareDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});
