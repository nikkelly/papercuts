import assert from "node:assert/strict";
import test from "node:test";

import { startDirectory } from "../src/host-context.ts";

test("prefers the session directory over the worktree", () => {
  assert.equal(
    startDirectory({ directory: "/repo/apps/web", worktree: "/repo" }),
    "/repo/apps/web",
  );
});

test("falls back to the worktree when the directory is missing", () => {
  assert.equal(startDirectory({ worktree: "/repo" }), "/repo");
});

test("rejects the / root sentinel wherever it appears", () => {
  assert.equal(startDirectory({ directory: "/", worktree: "/repo" }), "/repo");
  assert.equal(startDirectory({ worktree: "/" }), process.cwd());
  assert.equal(startDirectory({ directory: "/repo", worktree: "/" }), "/repo");
});

test("rejects empty and whitespace-only candidates", () => {
  assert.equal(startDirectory({ directory: "", worktree: "/repo" }), "/repo");
  assert.equal(startDirectory({ directory: "   ", worktree: "/repo" }), "/repo");
  assert.equal(startDirectory({ directory: "", worktree: "" }), process.cwd());
});

test("falls back to the process working directory when nothing valid remains", () => {
  assert.equal(startDirectory({}), process.cwd());
  assert.equal(startDirectory({ directory: "/", worktree: "/" }), process.cwd());
});
