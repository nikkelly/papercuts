#!/usr/bin/env node
import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..");

function defaultShareDir() {
  return process.env.PAPERCUTS_SHARE_DIR ?? join(homedir(), ".local", "share", "papercuts");
}

/** Every papercuts CLI link, past and present, points at a path ending in
 * this suffix. A link with this suffix is ours to repoint — that is what makes
 * the install survive the clone being moved, renamed, or deleted. */
const CLI_LINK_SUFFIX = join("plugin", "bin", "papercuts.mjs");

export function installCli(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const shareDir = options.shareDir ?? defaultShareDir();
  const binDir =
    options.binDir ?? process.env.PAPERCUTS_BIN_DIR ?? join(homedir(), ".local", "bin");
  const bundleBin = join(shareDir, "plugin", "bin", "papercuts.mjs");
  const linkPath = join(binDir, "papercuts");
  const lines = [];
  const errors = [];

  // 1. Refresh the self-contained bundle: the CLI plus its only two local
  // imports, laid out so the bin's relative imports keep resolving (the bin's
  // `../src/` is `plugin/src/`). Nothing installed here references the clone.
  const sources = [
    [join(repoRoot, "plugin", "bin", "papercuts.mjs"), bundleBin],
    [join(repoRoot, "plugin", "src", "envelope.ts"), join(shareDir, "plugin", "src", "envelope.ts")],
    [join(repoRoot, "plugin", "src", "journal.ts"), join(shareDir, "plugin", "src", "journal.ts")],
  ];
  for (const [from] of sources) {
    if (!existsSync(from)) {
      errors.push(`error: no CLI source at ${from}`);
      return { status: 1, lines, errors };
    }
  }
  for (const [from, to] of sources) {
    mkdirSync(join(to, ".."), { recursive: true });
    copyFileSync(from, to);
  }
  lines.push(`cli bundle -> ${shareDir}`);

  // 2. Link the command onto PATH, repointing stale papercuts links.
  const existing = lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
      errors.push(
        `error: ${linkPath} exists and is not the papercuts symlink; remove it or set PAPERCUTS_BIN_DIR`,
      );
      return { status: 1, lines, errors };
    }
    const target = resolve(readlinkSync(linkPath));
    if (target === bundleBin) {
      lines.push(`papercuts already linked: ${linkPath} -> ${bundleBin}`);
    } else if (target.endsWith(CLI_LINK_SUFFIX)) {
      rmSync(linkPath);
      symlinkSync(bundleBin, linkPath);
      lines.push(`repointed stale papercuts link: ${linkPath} -> ${bundleBin}`);
    } else {
      errors.push(
        `error: ${linkPath} exists and is not the papercuts symlink; remove it or set PAPERCUTS_BIN_DIR`,
      );
      return { status: 1, lines, errors };
    }
  } else {
    mkdirSync(binDir, { recursive: true });
    symlinkSync(bundleBin, linkPath);
    lines.push(`linked: ${linkPath} -> ${bundleBin}`);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
