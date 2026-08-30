#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { mergeMarketplace, PAPERCUTS_ENTRY } from "./codex-marketplace.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PLUGIN_SRC = join(REPO_ROOT, "plugin");
const MARKETPLACE_NAME = "personal";
const CODEX_PLUGINS_DIR = join(homedir(), ".codex", "plugins");
const INSTALL_TARGET = join(CODEX_PLUGINS_DIR, "papercuts");
const MARKETPLACE_DIR = join(homedir(), ".agents", "plugins");
const MARKETPLACE_FILE = join(MARKETPLACE_DIR, "marketplace.json");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      process.stderr.write(`error: "${cmd}" not found on PATH\n`);
      process.exit(1);
    }
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function pluginRootOrExit() {
  if (!existsSync(PLUGIN_SRC)) {
    process.stderr.write(`error: no plugin tree at ${PLUGIN_SRC}\n`);
    process.exit(1);
  }
}

function copyTree(src, dest) {
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

function ensureMarketplaceFile() {
  mkdirSync(MARKETPLACE_DIR, { recursive: true });
  let existing = {};
  if (existsSync(MARKETPLACE_FILE)) {
    try {
      existing = JSON.parse(readFileSync(MARKETPLACE_FILE, "utf8"));
    } catch {
      existing = {};
    }
  }
  const merged = mergeMarketplace(existing);
  // The installer owns this home-dir manifest for this marketplace, so always force the
  // name: registration and `papercuts@${MARKETPLACE_NAME}` reinstall below depend on it,
  // and a pre-existing manifest with a different name (e.g. "nikkelly-papercuts") would
  // otherwise make the install fail or install under the wrong marketplace.
  merged.name = MARKETPLACE_NAME;
  if (!merged.interface) merged.interface = { displayName: "Personal plugins" };
  writeFileSync(MARKETPLACE_FILE, JSON.stringify(merged, null, 2) + "\n");
}

function isMarketplaceRegistered() {
  const { stdout } = run("codex", ["plugin", "marketplace", "list"]);
  const line = stdout
    .split("\n")
    .find(
      (l) =>
        l.trimStart().startsWith(MARKETPLACE_NAME) &&
        (l.trimStart() === MARKETPLACE_NAME || /\s/.test(l.slice(MARKETPLACE_NAME.length))),
    );
  return line !== undefined;
}

function findInstalledCli() {
  const active = join(INSTALL_TARGET, "bin", "papercuts.mjs");
  if (existsSync(active)) return active;
  try {
    const walk = (dir) => {
      const out = [];
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) out.push(...walk(p));
        else if (entry === "papercuts.mjs") out.push(p);
      }
      return out;
    };
    const cacheDir = join(CODEX_PLUGINS_DIR, "cache");
    if (existsSync(cacheDir)) {
      const hit = walk(cacheDir).find((p) => p.includes("papercuts"));
      if (hit) return hit;
    }
  } catch {
    /* keep active */
  }
  return null;
}

function main() {
  pluginRootOrExit();
  run("codex", ["--version"]);

  process.stdout.write("copying plugin tree -> " + INSTALL_TARGET + "\n");
  copyTree(PLUGIN_SRC, INSTALL_TARGET);

  process.stdout.write("ensuring personal marketplace -> " + MARKETPLACE_FILE + "\n");
  ensureMarketplaceFile();

  if (!isMarketplaceRegistered()) {
    process.stdout.write(`registering marketplace "${MARKETPLACE_NAME}"\n`);
    run("codex", ["plugin", "marketplace", "add", MARKETPLACE_DIR]);
  } else {
    process.stdout.write(`marketplace "${MARKETPLACE_NAME}" already registered\n`);
  }

  process.stdout.write("reinstalling papercuts (unconditional refresh)\n");
  run("codex", ["plugin", "remove", `papercuts@${MARKETPLACE_NAME}`]);
  run("codex", ["plugin", "add", `papercuts@${MARKETPLACE_NAME}`, "--json"]);

  const cli = findInstalledCli();
  process.stdout.write("\n== Codex plugin papercuts installed ==\n");
  if (cli) {
    const root = resolve(cli, "..", "..");
    process.stdout.write(`plugin root: ${root}\n`);
    process.stdout.write(
      `AGENTS.md pen: node ${root}/bin/papercuts.mjs add "<text>" --tag <area> --agent codex\n`,
    );
  } else {
    process.stdout.write(
      "note: could not locate the installed CLI; check `codex plugin list`.\n",
    );
  }

  process.stdout.write("\ninstalling the papercuts command on PATH\n");
  const link = run(process.execPath, [join(REPO_ROOT, "scripts", "install-cli.mjs")], {
    stdio: "inherit",
  });
  if (link.status !== 0) {
    process.stdout.write("warning: could not link the papercuts command; see errors above\n");
  }

  process.stdout.write("\nRestart Codex or start a new session to pick up the plugin changes.\n");
}

main();
