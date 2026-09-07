#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { installCli } from "./install-cli.mjs";
import { installCodex } from "./install-codex-plugin.mjs";
import { installOpenCode } from "./install-opencode.mjs";

function defaultIo() {
  return {
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  };
}

/**
 * Ordered install steps: the portable ones (CLI, Codex) run first, so a
 * codex-only machine — or one whose opencode config the installer refuses to
 * touch — gets everything it can use before any opencode-specific failure
 * stops the run.
 */
export function buildSteps(installers, { globalTarget = false } = {}) {
  return [
    { label: "papercuts command", run: () => installers.cli() },
    { label: "codex plugin", run: () => installers.codex() },
    { label: "opencode config", run: () => installers.opencode({ globalTarget }) },
  ];
}

/**
 * Run steps in order. A step returns {status, lines, errors, skip?}; `skip`
 * means "this host is not installed on this machine" — announced and skipped,
 * never a failure. Any other nonzero status stops the run (fail-fast).
 */
export function runSteps(steps, io = defaultIo()) {
  const installed = [];
  const skipped = [];
  for (const step of steps) {
    io.out(`\n== ${step.label} ==`);
    const result = step.run();
    for (const line of result.lines) io.out(line);
    for (const err of result.errors) io.err(err);
    if (result.skip) {
      io.out(`SKIPPED: ${result.skip}`);
      skipped.push(step.label);
      continue;
    }
    if (result.status !== 0) {
      io.err(`error: ${step.label} failed (exit ${result.status})`);
      return { status: 1, installed, skipped };
    }
    installed.push(step.label);
  }

  io.out("\n== full papercuts install complete ==");
  if (skipped.length > 0) {
    io.out(`skipped (host not installed): ${skipped.join(", ")}`);
  }
  io.out("Restart opencode and start a new Codex session to pick everything up.");
  io.out(
    'AGENTS.md pen: papercuts add "what you hit and what would have prevented it" --tag <area> --agent codex',
  );
  io.out("Verify with: papercuts list");
  return { status: 0, installed, skipped };
}

function main() {
  const globalTarget = process.argv.includes("--global");
  const steps = buildSteps(
    { cli: installCli, codex: installCodex, opencode: installOpenCode },
    { globalTarget },
  );
  const { status } = runSteps(steps);
  process.exitCode = status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
