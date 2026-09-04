#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonOrThrow, writeJson } from "../shared/install.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PLUGIN_ENTRY = join(REPO_ROOT, "src", "index.ts");
const SKILL_DIR = join(REPO_ROOT, "skill");
const TUI_ENTRY = join(REPO_ROOT, "src", "tui.tsx");

export function targets(globalTarget) {
  if (globalTarget) {
    const dir = join(homedir(), ".config", "opencode");
    return { opencode: join(dir, "opencode.json"), tui: join(dir, "tui.json") };
  }
  return {
    opencode: join(process.cwd(), "opencode.json"),
    tui: join(process.cwd(), ".opencode", "tui.json"),
  };
}

function references(configDir, entries, wanted) {
  return entries.some(
    (entry) => entry === wanted || resolve(configDir, entry) === wanted,
  );
}

function wireOpenCode(configPath, lines) {
  const config = readJsonOrThrow(configPath) ?? {};
  const plugins = config.plugin ??= [];
  let changed = false;
  if (!references(dirname(configPath), plugins, PLUGIN_ENTRY)) {
    plugins.push(PLUGIN_ENTRY);
    changed = true;
  }
  const paths = (config.skills ??= {}).paths ??= [];
  if (!references(dirname(configPath), paths, SKILL_DIR)) {
    paths.push(SKILL_DIR);
    changed = true;
  }
  if (changed) {
    writeJson(configPath, config);
    lines.push(`wired papercuts into ${configPath}`);
  } else {
    lines.push(`papercuts already wired in ${configPath}`);
  }
}

function wireTui(configPath, lines) {
  const config = readJsonOrThrow(configPath) ?? {};
  const plugins = config.plugin ??= [];
  if (!references(dirname(configPath), plugins, TUI_ENTRY)) {
    plugins.push(TUI_ENTRY);
    writeJson(configPath, config);
    lines.push(`wired TUI widget into ${configPath}`);
  } else {
    lines.push(`TUI widget already wired in ${configPath}`);
  }
}

export function installOpenCode(options = {}) {
  const globalTarget = options.globalTarget ?? false;
  const { opencode, tui } = targets(globalTarget);
  const lines = [];
  wireOpenCode(opencode, lines);
  wireTui(tui, lines);
  const scope = globalTarget ? "global (~/.config/opencode)" : `project (${process.cwd()})`;
  lines.push(
    `opencode papercuts installed for ${scope}; restart opencode to pick it up`,
  );
  return { status: 0, lines, errors: [] };
}

function main() {
  const globalTarget = process.argv.includes("--global");
  const { status, lines, errors } = installOpenCode({ globalTarget });
  for (const line of lines) process.stdout.write(line + "\n");
  for (const err of errors) process.stderr.write(err + "\n");
  if (status !== 0) process.exitCode = status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
