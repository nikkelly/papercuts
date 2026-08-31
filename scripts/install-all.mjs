#!/usr/bin/env node
import { installCli } from "./install-cli.mjs";
import { installCodex } from "./install-codex-plugin.mjs";
import { installOpenCode } from "./install-opencode.mjs";

const globalTarget = process.argv.includes("--global");

const steps = [
  { label: "opencode config", run: () => installOpenCode({ globalTarget }) },
  { label: "papercuts command", run: () => installCli() },
  { label: "codex plugin", run: () => installCodex() },
];

let failed = false;
for (const step of steps) {
  process.stdout.write(`\n== ${step.label} ==\n`);
  const result = step.run();
  for (const line of result.lines) process.stdout.write(line + "\n");
  for (const err of result.errors) process.stderr.write(err + "\n");
  if (result.status !== 0) {
    process.stderr.write(`error: ${step.label} failed (exit ${result.status})\n`);
    failed = true;
    break;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  process.stdout.write("\n== full papercuts install complete ==\n");
  process.stdout.write("Restart opencode and start a new Codex session to pick everything up.\n");
}
