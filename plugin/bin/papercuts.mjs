#!/usr/bin/env node
import { PapercutsError, addPapercut, listPapercuts, removePapercut, resolvePapercut } from "../src/store.ts";

function usage() {
  console.error(`Usage:
  papercuts add <text> [--tag TAG] [--severity minor|major|blocker] [--cmd CMD] [--exit N] [--agent NAME]
  papercuts list [--status open|resolved|all] [--tag TAG] [--severity SEVERITY] [--limit N]
  papercuts resolve <id-prefix> [--note NOTE]
  papercuts remove <id-prefix>`);
}

function fail(code, message) {
  console.log(JSON.stringify({ ok: false, error: { code, message } }));
  process.exitCode = code === "not_found" || code === "ambiguous_id" ? 2 : 1;
}

function parseFlags(args, allowed) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!allowed.includes(key)) {
      throw new PapercutsError("invalid_argument", `unknown flag --${key}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new PapercutsError("invalid_argument", `flag --${key} requires a value`);
    }
    flags[key] = value;
    index += 1;
  }
  return { flags, positionals };
}

const SEVERITIES = new Set(["minor", "major", "blocker"]);

function severity(value) {
  if (!SEVERITIES.has(value)) {
    throw new PapercutsError(
      "invalid_argument",
      `invalid severity '${value}': use minor, major, or blocker`,
    );
  }
  return value;
}

function output(data) {
  console.log(JSON.stringify({ ok: true, data }));
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  switch (command) {
    case "add": {
      const { flags, positionals } = parseFlags(rest, [
        "tag",
        "severity",
        "cmd",
        "exit",
        "agent",
      ]);
      const text = positionals.join(" ");
      return addPapercut({
        text,
        tag: flags.tag,
        severity: flags.severity === undefined ? undefined : severity(flags.severity),
        cmd: flags.cmd,
        exitCode: flags.exit === undefined ? undefined : Number(flags.exit),
        agent: flags.agent,
        startDirectory: process.cwd(),
      });
    }
    case "list": {
      const { flags } = parseFlags(rest, ["status", "tag", "severity", "limit"]);
      if (flags.status !== undefined && !["open", "resolved", "all"].includes(flags.status)) {
        throw new PapercutsError("invalid_argument", `invalid status '${flags.status}'`);
      }
      return listPapercuts({
        status: flags.status,
        tag: flags.tag,
        severity: flags.severity === undefined ? undefined : severity(flags.severity),
        limit: flags.limit === undefined ? undefined : Number(flags.limit),
        startDirectory: process.cwd(),
      });
    }
    case "resolve": {
      const { flags, positionals } = parseFlags(rest, ["note"]);
      if (positionals.length !== 1) {
        throw new PapercutsError("invalid_argument", "resolve takes exactly one ID prefix");
      }
      return resolvePapercut({
        idPrefix: positionals[0],
        note: flags.note,
        startDirectory: process.cwd(),
      });
    }
    case "remove": {
      const { positionals } = parseFlags(rest, []);
      if (positionals.length !== 1) {
        throw new PapercutsError("invalid_argument", "remove takes exactly one ID prefix");
      }
      return removePapercut({ idPrefix: positionals[0], startDirectory: process.cwd() });
    }
    default:
      usage();
      process.exitCode = 1;
      return null;
  }
}

try {
  const result = main();
  if (result !== null) {
    output(result);
  }
} catch (error) {
  if (error instanceof PapercutsError) {
    fail(error.code, error.message);
  } else {
    fail("io_error", String(error));
  }
}
