#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTree, readJsonOrThrow, readJsonOrDefault, writeJson } from "../shared/install.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");

function defaultShareDir() {
  return process.env.PAPERCUTS_SHARE_DIR ?? join(homedir(), ".local", "share", "papercuts");
}

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

/** Replace an entry this installer previously wrote (per the manifest) with
 * its current value. Ownership tracking, not heuristics: the manifest records
 * exactly which config entries papercuts owns, so a moved or renamed clone is
 * healed by re-running the installer and dead entries never accumulate. */
function replaceRecorded(list, previous, current) {
  if (!previous || previous === current) return false;
  const index = list.indexOf(previous);
  if (index === -1) return false;
  list[index] = current;
  return true;
}

function wireOpenCode(configPath, record, pluginEntry, skillDir, lines) {
  const config = readJsonOrThrow(configPath) ?? {};
  const plugins = config.plugin ??= [];
  let changed = false;
  if (replaceRecorded(plugins, record.plugin, pluginEntry)) changed = true;
  if (!references(dirname(configPath), plugins, pluginEntry)) {
    plugins.push(pluginEntry);
    changed = true;
  }
  const paths = (config.skills ??= {}).paths ??= [];
  if (replaceRecorded(paths, record.skills, skillDir)) changed = true;
  if (!references(dirname(configPath), paths, skillDir)) {
    paths.push(skillDir);
    changed = true;
  }
  if (changed) {
    writeJson(configPath, config);
    lines.push(`wired papercuts into ${configPath}`);
  } else {
    lines.push(`papercuts already wired in ${configPath}`);
  }
  record.plugin = pluginEntry;
  record.skills = skillDir;
}

function wireTui(configPath, record, tuiEntry, lines) {
  const config = readJsonOrThrow(configPath) ?? {};
  const plugins = config.plugin ??= [];
  let changed = false;
  if (replaceRecorded(plugins, record.tui, tuiEntry)) changed = true;
  if (!references(dirname(configPath), plugins, tuiEntry)) {
    plugins.push(tuiEntry);
    changed = true;
  }
  if (changed) {
    writeJson(configPath, config);
    lines.push(`wired TUI widget into ${configPath}`);
  } else {
    lines.push(`TUI widget already wired in ${configPath}`);
  }
  record.tui = tuiEntry;
}

export function installOpenCode(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const shareDir = options.shareDir ?? defaultShareDir();
  const globalTarget = options.globalTarget ?? false;
  const { opencode, tui } = targets(globalTarget);
  const lines = [];

  // 1. Populate the stable share dir. Config points here — once written, it
  // never changes again; later installs only refresh these copies.
  const shareOpencode = join(shareDir, "opencode");
  copyTree(join(repoRoot, "src"), join(shareOpencode, "src"));
  copyTree(join(repoRoot, "plugin", "src"), join(shareOpencode, "plugin", "src"));
  copyTree(join(repoRoot, "skills"), join(shareOpencode, "skills"));
  const pluginEntry = join(shareOpencode, "src", "index.ts");
  const tuiEntry = join(shareOpencode, "src", "tui.tsx");
  const skillDir = join(shareOpencode, "skills");
  lines.push(`plugin copies -> ${shareOpencode}`);

  const manifest = readJsonOrDefault(join(shareDir, "installed-entries.json"), {
    entries: {},
  });
  if (typeof manifest.entries !== "object" || manifest.entries === null) {
    manifest.entries = {};
  }

  try {
    const record = (manifest.entries[opencode] ??= {});
    wireOpenCode(opencode, record, pluginEntry, skillDir, lines);
    const tuiRecord = (manifest.entries[tui] ??= {});
    wireTui(tui, tuiRecord, tuiEntry, lines);
  } catch (error) {
    // A config the installer refuses to rewrite (e.g. JSONC) is a clean,
    // reported failure — not an uncaught crash with a stack trace.
    return { status: 1, lines, errors: [error.message] };
  }
  writeJson(join(shareDir, "installed-entries.json"), manifest);
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
