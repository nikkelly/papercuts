import assert from "node:assert/strict";
import test from "node:test";

import { mergeMarketplace, PAPERCUTS_ENTRY } from "../scripts/codex-marketplace.mjs";

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
  assert.equal(merged.plugins[0].name, "other-plugin");
  assert.equal(merged.plugins[1].name, "papercuts");
});

test("mergeMarketplace preserves unknown top-level keys", () => {
  const existing = { extraKey: "keep-me", plugins: [] };
  const merged = mergeMarketplace(existing);
  assert.equal(merged.extraKey, "keep-me");
});

test("mergeMarketplace replaces an existing papercuts entry", () => {
  const existing = {
    name: "personal",
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
