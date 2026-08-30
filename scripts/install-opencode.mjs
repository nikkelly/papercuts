#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PLUGIN_ENTRY = join(REPO_ROOT, "src", "index.ts");
const SKILL_DIR = join(REPO_ROOT, "skill");
const TUI_ENTRY = join(REPO_ROOT, "src", "tui.tsx");

function targets(globalTarget) {
  if (globalTarget) {
    const dir = join(homedir(), ".config", "opencode");
    return { opencode: join(dir, "opencode.json"), tui: join(dir, "tui.json") };
  }
  return {
    opencode: join(process.cwd(), "opencode.json"),
    tui: join(process.cwd(), ".opencode", "tui.json"),
  };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `${path} is not valid JSON (JSONC is not supported); add the papercuts entries manually`,
    );
  }
}

function references(configDir, entries, wanted) {
  return entries.some(
    (entry) => entry === wanted || resolve(configDir, entry) === wanted,
  );
}

function wireOpenCode(configPath, globalTarget) {
  const config = readJson(configPath) ?? {};
  let changed = false;
  const plugins = (config.plugin ??= []);
  if (!references(dirname(configPath), plugins, PLUGIN_ENTRY)) {
    plugins.push(PLUGIN_ENTRY);
    changed = true;
  }
  const paths = ((config.skills ??= {}).paths ??= []);
  if (!references(dirname(configPath), paths, SKILL_DIR)) {
    paths.push(SKILL_DIR);
    changed = true;
  }
  if (changed) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    process.stdout.write(`wired papercuts into ${configPath}\n`);
  } else {
    process.stdout.write(`papercuts already wired in ${configPath}\n`);
  }
  return changed;
}

function wireTui(configPath) {
  const config = readJson(configPath) ?? {};
  let changed = false;
  const plugins = (config.plugin ??= []);
  if (!references(dirname(configPath), plugins, TUI_ENTRY)) {
    plugins.push(TUI_ENTRY);
    changed = true;
  }
  if (changed) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    process.stdout.write(`wired TUI widget into ${configPath}\n`);
  } else {
    process.stdout.write(`TUI widget already wired in ${configPath}\n`);
  }
}

function main() {
  const globalTarget = process.argv.includes("--global");
  const { opencode, tui } = targets(globalTarget);
  wireOpenCode(opencode, globalTarget);
  wireTui(tui);
  const scope = globalTarget ? "global (~/.config/opencode)" : `project (${process.cwd()})`;
  process.stdout.write(
    `opencode papercuts installed for ${scope}; restart opencode to pick it up\n`,
  );
}

main();