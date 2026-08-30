#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const SCRIPTS = resolve(import.meta.dirname);
const globalTarget = process.argv.includes("--global");

const steps = [
  ["opencode config", join(SCRIPTS, "install-opencode.mjs"), globalTarget ? ["--global"] : []],
  ["papercuts command", join(SCRIPTS, "install-cli.mjs"), []],
  ["codex plugin", join(SCRIPTS, "install-codex-plugin.mjs"), []],
];

for (const [label, script, args] of steps) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    process.stderr.write(`error: ${label} failed (exit ${result.status ?? "unknown"})\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\n== full papercuts install complete ==\n");
process.stdout.write("Restart opencode and start a new Codex session to pick everything up.\n");