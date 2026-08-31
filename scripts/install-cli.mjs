#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const CLI_SOURCE = join(REPO_ROOT, "plugin", "bin", "papercuts.mjs");

function linkIsOurs(linkPath, source) {
  try {
    return resolve(readlinkSync(linkPath)) === source;
  } catch {
    return false;
  }
}

export function installCli(options = {}) {
  const binDir =
    options.binDir ?? process.env.PAPERCUTS_BIN_DIR ?? join(homedir(), ".local", "bin");
  const linkPath = join(binDir, "papercuts");
  const lines = [];
  const errors = [];

  if (!existsSync(CLI_SOURCE)) {
    errors.push(`error: no CLI at ${CLI_SOURCE}`);
    return { status: 1, lines, errors };
  }

  const existing = lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing !== undefined) {
    if (linkIsOurs(linkPath, CLI_SOURCE)) {
      lines.push(`papercuts already linked: ${linkPath} -> ${CLI_SOURCE}`);
    } else {
      errors.push(
        `error: ${linkPath} exists and is not the papercuts symlink; remove it or set PAPERCUTS_BIN_DIR`,
      );
      return { status: 1, lines, errors };
    }
  } else {
    mkdirSync(binDir, { recursive: true });
    symlinkSync(CLI_SOURCE, linkPath);
    lines.push(`linked: ${linkPath} -> ${CLI_SOURCE}`);
  }

  const onPath = process.env.PATH?.split(":").some((entry) => resolve(entry) === resolve(binDir));
  if (!onPath) {
    errors.push(`warning: ${binDir} is not on PATH; add it to use \`papercuts\` directly`);
  }

  lines.push("verify with: papercuts status");
  lines.push('pen: papercuts add "what you hit and what would have prevented it" --tag <area> --agent codex');
  return { status: 0, lines, errors };
}

function main() {
  const { status, lines, errors } = installCli();
  for (const line of lines) process.stdout.write(line + "\n");
  for (const err of errors) process.stderr.write(err + "\n");
  if (status !== 0) process.exitCode = status;
}

main();
