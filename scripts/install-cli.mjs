#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const CLI_SOURCE = join(REPO_ROOT, "plugin", "bin", "papercuts.mjs");
const BIN_DIR = process.env.PAPERCUTS_BIN_DIR ?? join(homedir(), ".local", "bin");
const LINK_PATH = join(BIN_DIR, "papercuts");

function linkIsOurs() {
  try {
    const target = readlinkSync(LINK_PATH);
    return resolve(target) === CLI_SOURCE;
  } catch {
    return false;
  }
}

function main() {
  if (!existsSync(CLI_SOURCE)) {
    process.stderr.write(`error: no CLI at ${CLI_SOURCE}\n`);
    process.exit(1);
  }

  const existing = lstatSync(LINK_PATH, { throwIfNoEntry: false });
  if (existing !== undefined) {
    if (linkIsOurs()) {
      process.stdout.write(`papercuts already linked: ${LINK_PATH} -> ${CLI_SOURCE}\n`);
    } else {
      process.stderr.write(
        `error: ${LINK_PATH} exists and is not the papercuts symlink; remove it or set PAPERCUTS_BIN_DIR\n`,
      );
      process.exit(1);
    }
  } else {
    mkdirSync(BIN_DIR, { recursive: true });
    symlinkSync(CLI_SOURCE, LINK_PATH);
    process.stdout.write(`linked: ${LINK_PATH} -> ${CLI_SOURCE}\n`);
  }

  const onPath = process.env.PATH?.split(":").some((entry) => resolve(entry) === resolve(BIN_DIR));
  if (!onPath) {
    process.stderr.write(`warning: ${BIN_DIR} is not on PATH; add it to use \`papercuts\` directly\n`);
  }

  process.stdout.write("verify with: papercuts status\n");
  process.stdout.write('pen: papercuts add "what you hit and what would have prevented it" --tag <area> --agent codex\n');
}

main();