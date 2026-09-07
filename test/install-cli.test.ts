import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_SOURCE = join(REPO_ROOT, "plugin", "bin", "papercuts.mjs");
const INSTALLER = join(REPO_ROOT, "scripts", "install-cli.mjs");

function temporaryBinDir() {
  return mkdtempSync(join(tmpdir(), "papercuts-bin-"));
}

function temporaryRepository() {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-cli-run-"));
  mkdirSync(join(directory, ".git"));
  return directory;
}

function runInstaller(binDir: string) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, PAPERCUTS_BIN_DIR: binDir },
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

test("install:cli links the papercuts command and it runs", () => {
  const binDir = temporaryBinDir();
  const workDir = temporaryRepository();
  try {
    const install = runInstaller(binDir);
    assert.equal(install.status, 0, install.stdout + install.stderr);
    assert.equal(readlinkSync(join(binDir, "papercuts")), CLI_SOURCE);
    assert.ok(lstatSync(join(binDir, "papercuts")).isSymbolicLink());

    const data = envelope(runLinkedCli(binDir, workDir, "status"));
    assert.equal(typeof data.muted, "boolean");
    assert.equal(data.file, join(workDir, ".papercuts.jsonl"));
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("install:cli is idempotent and refuses to clobber a foreign file", () => {
  const binDir = temporaryBinDir();
  const foreignDir = temporaryBinDir();
  try {
    const first = runInstaller(binDir);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const second = runInstaller(binDir);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /already linked/);

    writeFileSync(join(foreignDir, "papercuts"), "#!/bin/sh\necho not papercuts\n");
    const clash = runInstaller(foreignDir);
    assert.notEqual(clash.status, 0);
    assert.match(clash.stderr, /not the papercuts symlink/);
    assert.equal(readFileSync(join(foreignDir, "papercuts"), "utf8"), "#!/bin/sh\necho not papercuts\n");
  } finally {
    rmSync(binDir, { recursive: true, force: true });
    rmSync(foreignDir, { recursive: true, force: true });
  }
});