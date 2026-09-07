#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { copyTree, readJsonOrThrow, runCommand, writeJson } from "../shared/install.mjs";
import { mergeMarketplace, PAPERCUTS_ENTRY } from "./codex-marketplace.mjs";
import { installCli } from "./install-cli.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PLUGIN_SRC = join(REPO_ROOT, "plugin");
const MARKETPLACE_NAME = "personal";
const CODEX_PLUGINS_DIR = join(homedir(), ".codex", "plugins");
const INSTALL_TARGET = join(CODEX_PLUGINS_DIR, "papercuts");
const MARKETPLACE_DIR = join(homedir(), ".agents", "plugins");
const MARKETPLACE_FILE = join(MARKETPLACE_DIR, "marketplace.json");

function ensureMarketplaceFile(marketplaceFile) {
  // Fail loudly on an unparseable manifest: silently resetting it here would
  // clobber the user's other plugin entries (the README promises "merging,
  // never clobbering"). Same contract as the opencode installer's config.
  const existing = readJsonOrThrow(marketplaceFile);
  const merged = mergeMarketplace(existing);
  // The installer owns this home-dir manifest for this marketplace, so always force the
  // name: registration and `papercuts@${MARKETPLACE_NAME}` reinstall below depend on it,
  // and a pre-existing manifest with a different name (e.g. "nikkelly-papercuts") would
  // otherwise make the install fail or install under the wrong marketplace.
  merged.name = MARKETPLACE_NAME;
  if (!merged.interface) merged.interface = { displayName: "Personal plugins" };
  writeJson(marketplaceFile, merged);
}

function isMarketplaceRegistered(env) {
  const { stdout } = runCommand("codex", ["plugin", "marketplace", "list"], { env });
  return stdout
    .split("\n")
    .some(
      (line) =>
        line.trimStart().startsWith(MARKETPLACE_NAME) &&
        (line.trimStart() === MARKETPLACE_NAME || /\s/.test(line.slice(MARKETPLACE_NAME.length))),
    );
}

function findInstalledCli(installTarget) {
  const active = join(installTarget, "bin", "papercuts.mjs");
  if (existsSync(active)) return active;
  try {
    const walk = (dir) => {
      const out = [];
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p, { throwIfNoEntry: false });
        if (st === undefined) continue;
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

/** Run a codex command and fail loudly on a nonzero exit — the installer must
 * never report success after a command it depended on failed. */
function requireOk(cmd, args, env) {
  const { status, stderr } = runCommand(cmd, args, { env });
  if (status !== 0) {
    const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed (exit ${status})${detail}`);
  }
}

export function installCodex(options = {}) {
  const root = options.repoRoot ?? REPO_ROOT;
  const pluginSrc = join(root, "plugin");
  const installTarget = options.installTarget ?? INSTALL_TARGET;
  const marketplaceFile = options.marketplaceFile ?? MARKETPLACE_FILE;
  const env = options.env;
  const lines = [];
  const errors = [];

  if (!existsSync(pluginSrc)) {
    errors.push(`error: no plugin tree at ${pluginSrc}`);
    return { status: 1, lines, errors };
  }

  try {
    runCommand("codex", ["--version"], { env });
  } catch (error) {
    if (/not found on PATH/.test(error.message)) {
      return {
        status: 0,
        skip: '"codex" not found on PATH — install codex, then re-run npm run install:codex',
        lines,
        errors,
      };
    }
    errors.push(error.message);
    return { status: 1, lines, errors };
  }

  try {
    lines.push(`copying plugin tree -> ${installTarget}`);
    removeStaleNodeModules(installTarget);
    copyTree(pluginSrc, installTarget);

    pinMcpServerPath(installTarget);

    lines.push(`ensuring personal marketplace -> ${marketplaceFile}`);
    ensureMarketplaceFile(marketplaceFile);

    if (!isMarketplaceRegistered(env)) {
      lines.push(`registering marketplace "${MARKETPLACE_NAME}"`);
      requireOk("codex", ["plugin", "marketplace", "add", dirname(marketplaceFile)], env);
    } else {
      lines.push(`marketplace "${MARKETPLACE_NAME}" already registered`);
    }

    lines.push("reinstalling papercuts (unconditional refresh)");
    // Best-effort: removing a not-yet-installed plugin is expected to fail on
    // a fresh machine; the add below is the step that must succeed.
    runCommand("codex", ["plugin", "remove", `papercuts@${MARKETPLACE_NAME}`], { env });
    requireOk("codex", ["plugin", "add", `papercuts@${MARKETPLACE_NAME}`, "--json"], env);

    const cli = findInstalledCli(installTarget);
    lines.push("\n== Codex plugin papercuts installed ==");
    if (cli) {
      const cliRoot = resolve(cli, "..", "..");
      lines.push(`plugin root: ${cliRoot}`);
      lines.push(
        `AGENTS.md pen: node ${cliRoot}/bin/papercuts.mjs add "<text>" --tag <area> --agent codex`,
      );
    } else {
      lines.push(
        "note: could not locate the installed CLI; check `codex plugin list`.",
      );
    }

    lines.push("\ninstalling the papercuts command on PATH");
    const link = installCli({ binDir: options.binDir });
    if (link.status !== 0) {
      lines.push("warning: could not link the papercuts command; see errors above");
      errors.push(...link.errors);
    }

    lines.push("\nRestart Codex or start a new session to pick up the plugin changes.");
    return { status: 0, lines, errors };
  } catch (error) {
    errors.push(error.message);
    return { status: 1, lines, errors };
  }
}

export function removeStaleNodeModules(installTarget) {
  // The plugin subtree is dependency-free; a stale `node_modules` from an older
  // install (e.g. the pre-mini-schema zod era) would linger forever because
  // copyTree never cleans its destination. Drop it so reinstalls stay clean.
  const dir = join(installTarget, "node_modules");
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export function pinMcpServerPath(installTarget) {
  const mcpFile = join(installTarget, ".mcp.json");
  if (!existsSync(mcpFile)) return;
  const config = JSON.parse(readFileSync(mcpFile, "utf8"));
  const server = config?.mcpServers?.papercuts;
  if (server && Array.isArray(server.args)) {
    server.args[0] = join(installTarget, "src", "mcp.ts");
  }
  writeFileSync(mcpFile, JSON.stringify(config, null, 2) + "\n");
}

function main() {
  const { status, lines, errors, skip } = installCodex();
  for (const line of lines) process.stdout.write(line + "\n");
  for (const err of errors) process.stderr.write(err + "\n");
  if (skip) process.stdout.write(`SKIPPED: ${skip}\n`);
  if (status !== 0) process.exitCode = status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
