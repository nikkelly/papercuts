import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Shared mutating primitives for the papercuts installers. The installers wire
 * the plugin into several hosts (opencode config, TUI config, Codex
 * marketplace, PATH symlink); this module owns the filesystem and subprocess
 * mutation so each installer stops re-implementing "read JSON, edit, write"
 * and "copy a tree" on its own. Typings live in install.d.mts.
 */

export function readJsonOrThrow(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `${path} is not valid JSON (JSONC is not supported); add the papercuts entries manually`,
    );
  }
}

export function readJsonOrDefault(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) {
      copyTree(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

export function runCommand(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...opts,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(`"${cmd}" not found on PATH`);
    }
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
