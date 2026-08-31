import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { marketplaceEntry, mergeMarketplace, PAPERCUTS_ENTRY } from "../scripts/codex-marketplace.mjs";
import { pinMcpServerPath } from "../scripts/install-codex-plugin.mjs";

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
      url: "https://github.com/nikkelly/opencode-papercuts.git",
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
  const directory = mkdtempSync(join(tmpdir(), "opencode-papercuts-mcp-"));
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
