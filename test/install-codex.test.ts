import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { marketplaceEntry, mergeMarketplace, PAPERCUTS_ENTRY } from "../scripts/codex-marketplace.mjs";
import { installCodex, pinMcpServerPath, removeStaleNodeModules } from "../scripts/install-codex-plugin.mjs";

test("mergeMarketplace seeds a brand-new marketplace file shape", () => {
  const merged = mergeMarketplace(undefined);
  assert.equal(merged.name, undefined);
  assert.deepEqual(merged.plugins, [PAPERCUTS_ENTRY]);
});

test("mergeMarketplace is idempotent when the entry already exists", () => {
  const first = mergeMarketplace(undefined);
  const second = mergeMarketplace(first);
  assert.equal(second.plugins.length, 1);
  assert.deepEqual(second, first);
});

test("mergeMarketplace preserves unrelated plugin entries", () => {
  const existing = {
    name: "existing",
    interface: { displayName: "Existing" },
    plugins: [
      {
        name: "other-plugin",
        source: { source: "local", path: "./.codex/plugins/other" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Tooling",
      },
    ],
  };
  const merged = mergeMarketplace(existing);
  assert.equal(merged.plugins.length, 2);
  assert.equal(merged.plugins[0]!.name, "other-plugin");
  assert.equal(merged.plugins[1]!.name, "papercuts");
});

test("mergeMarketplace preserves unknown top-level keys", () => {
  const existing = { extraKey: "keep-me", plugins: [] };
  const merged = mergeMarketplace(existing);
  assert.equal(merged.extraKey, "keep-me");
});

test("marketplaceEntry('local') is the current PAPERCUTS_ENTRY", () => {
  assert.deepEqual(marketplaceEntry("local"), PAPERCUTS_ENTRY);
});

test("marketplaceEntry('git-subdir') mirrors the tracked repo manifest entry", () => {
  assert.deepEqual(marketplaceEntry("git-subdir"), {
    name: "papercuts",
    source: {
      source: "git-subdir",
      url: "https://github.com/nikkelly/papercuts.git",
      path: "./plugin",
    },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Developer tools",
  });
});

test("mergeMarketplace replaces an existing papercuts entry regardless of manifest name", () => {
  const existing = {
    name: "nikkelly-papercuts",
    plugins: [
      {
        name: "papercuts",
        source: { source: "git-subdir", url: "https://example.com/repo.git", path: "./plugin" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer tools",
      },
    ],
  };
  const merged = mergeMarketplace(existing);
  assert.equal(merged.plugins.length, 1);
  assert.deepEqual(merged.plugins[0], PAPERCUTS_ENTRY);
});

test("pinMcpServerPath rewrites the copied .mcp.json args[0] to an absolute path", () => {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-mcp-"));
  try {
    const target = resolve(join(directory, "installed"));
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(join(target, ".mcp.json"), JSON.stringify({
      mcpServers: { papercuts: { command: "node", args: ["./src/mcp.ts"] } },
    }));

    pinMcpServerPath(target);

    const config = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf8"));
    assert.equal(config.mcpServers.papercuts.args[0], join(target, "src", "mcp.ts"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("removeStaleNodeModules drops a leftover node_modules from the install target", () => {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-mcp-"));
  try {
    const target = resolve(join(directory, "installed"));
    const stale = join(target, "node_modules", "zod");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "package.json"), "{}");
    mkdirSync(join(target, "src"), { recursive: true });

    removeStaleNodeModules(target);

    assert.equal(existsSync(join(target, "node_modules")), false);
    assert.equal(existsSync(join(target, "src")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("removeStaleNodeModules is a no-op when there is no node_modules", () => {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-mcp-"));
  try {
    const target = resolve(join(directory, "installed"));
    mkdirSync(join(target, "src"), { recursive: true });

    removeStaleNodeModules(target);

    assert.equal(existsSync(join(target, "src")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("importing the codex installer does not run main() or set a failing exit code", () => {
  const installer = fileURLToPath(new URL("../scripts/install-codex-plugin.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import("${installer}")`],
    { encoding: "utf8", env: { ...process.env, PATH: "" } },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("install:codex skips cleanly when the codex CLI is absent", () => {
  const installer = fileURLToPath(new URL("../scripts/install-codex-plugin.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [installer], {
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SKIPPED/);
  assert.match(result.stdout, /not found on PATH/);
});

function writeFakeCodex(directory: string, script: string) {
  const shimDir = join(directory, "shim");
  mkdirSync(shimDir, { recursive: true });
  const shim = join(shimDir, "codex");
  writeFileSync(shim, script);
  chmodSync(shim, 0o755);
  return shimDir;
}

function fakeCodexEnv(shimDir: string) {
  return { ...process.env, PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}` };
}

function fixturePluginTree(directory: string) {
  const repo = join(directory, "repo");
  const plugin = join(repo, "plugin");
  mkdirSync(join(plugin, "bin"), { recursive: true });
  mkdirSync(join(plugin, "src"), { recursive: true });
  writeFileSync(
    join(plugin, ".mcp.json"),
    JSON.stringify({ mcpServers: { papercuts: { command: "node", args: ["./src/mcp.ts"] } } }),
  );
  writeFileSync(join(plugin, "bin", "papercuts.mjs"), "// fake cli\n");
  writeFileSync(join(plugin, "src", "mcp.ts"), "// fake server\n");
  return repo;
}

test("installCodex reports success through injected seams on a healthy fake codex", () => {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-codex-flow-"));
  try {
    const repo = fixturePluginTree(directory);
    const shimDir = writeFakeCodex(
      directory,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "codex-fake 1.0"; exit 0; fi',
        'case "$*" in',
        '  *"marketplace list"*) exit 0 ;;',
        '  *"marketplace add"*) exit 0 ;;',
        '  *"plugin remove"*) exit 0 ;;',
        '  *"plugin add"*) exit 0 ;;',
        '  *) echo "unexpected codex call: $*" >&2; exit 1 ;;',
        "esac",
        "",
      ].join("\n"),
    );

    const result = installCodex({
      repoRoot: repo,
      installTarget: join(directory, "target"),
      marketplaceFile: join(directory, "manifest", "marketplace.json"),
      binDir: join(directory, "bin"),
      env: fakeCodexEnv(shimDir),
    });

    assert.equal(result.status, 0, result.lines.join("\n") + result.errors.join("\n"));
    const manifest = JSON.parse(readFileSync(join(directory, "manifest", "marketplace.json"), "utf8"));
    assert.equal(manifest.name, "personal");
    assert.equal(manifest.plugins[0].name, "papercuts");
    const lines = result.lines.join("\n");
    assert.match(lines, /AGENTS\.md pen: node .*bin\/papercuts\.mjs/);
    assert.ok(existsSync(join(directory, "target", "src", "mcp.ts")));
    // The copied .mcp.json pins the server to the install target.
    const copied = JSON.parse(readFileSync(join(directory, "target", ".mcp.json"), "utf8"));
    assert.equal(copied.mcpServers.papercuts.args[0], join(directory, "target", "src", "mcp.ts"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("installCodex surfaces a failed codex command instead of reporting success", () => {
  const directory = mkdtempSync(join(tmpdir(), "papercuts-codex-flow-"));
  try {
    const repo = fixturePluginTree(directory);
    const shimDir = writeFakeCodex(
      directory,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "codex-fake 1.0"; exit 0; fi',
        'case "$*" in',
        '  *"marketplace list"*) exit 0 ;;',
        '  *"marketplace add"*) echo "boom: registry unreachable" >&2; exit 1 ;;',
        '  *"plugin remove"*) exit 0 ;;',
        '  *"plugin add"*) exit 0 ;;',
        '  *) echo "unexpected codex call: $*" >&2; exit 1 ;;',
        "esac",
        "",
      ].join("\n"),
    );

    const result = installCodex({
      repoRoot: repo,
      installTarget: join(directory, "target"),
      marketplaceFile: join(directory, "manifest", "marketplace.json"),
      binDir: join(directory, "bin"),
      env: fakeCodexEnv(shimDir),
    });

    assert.equal(result.status, 1, result.lines.join("\n"));
    const errors = result.errors.join("\n");
    assert.match(errors, /marketplace add/);
    assert.match(errors, /boom: registry unreachable/);
    assert.match(errors, /exit 1/);
    // It must NOT have claimed success or printed the completion banner.
    assert.ok(!result.lines.join("\n").includes("== Codex plugin papercuts installed =="));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
