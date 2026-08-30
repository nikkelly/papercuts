#!/usr/bin/env node
import { errorEnvelope, exitCodeFor, ok } from "../src/envelope.ts";
import { PapercutsError, addPapercut, listPapercuts, removePapercut, resolvePapercut } from "../src/store.ts";

function usage() {
  console.error(`Usage:
  papercuts add <text> [--tag TAG] [--severity minor|major|blocker] [--cmd CMD] [--exit N] [--agent NAME]
  papercuts list [--status open|resolved|all] [--tag TAG] [--severity SEVERITY] [--limit N] [--agent NAME]
  papercuts resolve <id-prefix> [--note NOTE] [--agent NAME]
  papercuts remove <id-prefix> [--agent NAME]`);
}

function parseFlags(args, allowed) {
  const flags = {};
  const positionals = [];
  let endOfFlags = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!endOfFlags && arg === "--") {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
      if (key === "") {
        throw new PapercutsError("invalid_argument", `invalid flag '${arg}'`);
      }
      if (!allowed.includes(key)) {
        throw new PapercutsError("invalid_argument", `unknown flag --${key}`);
      }
      if (key in flags) {
        throw new PapercutsError("invalid_argument", `duplicate flag --${key}`);
      }
      let value;
      if (equals !== -1) {
        value = arg.slice(equals + 1);
      } else {
        value = args[index + 1];
        if (value === undefined) {
          throw new PapercutsError("invalid_argument", `flag --${key} requires a value`);
        }
        index += 1;
      }
      flags[key] = value;
      continue;
    }
    positionals.push(arg);
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

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new PapercutsError("invalid_argument", `--${label} must be an integer, got '${value}'`);
  }
  return parsed;
}

function output(data) {
  console.log(JSON.stringify(ok(data)));
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
      return addPapercut({
        text: positionals.join(" "),
        tag: flags.tag,
        severity: flags.severity === undefined ? undefined : severity(flags.severity),
        cmd: flags.cmd,
        exitCode: flags.exit === undefined ? undefined : integer(flags.exit, "exit"),
        agent: flags.agent,
        startDirectory: process.cwd(),
      });
    }
    case "list": {
      const { flags } = parseFlags(rest, ["status", "tag", "severity", "limit", "agent"]);
      if (flags.status !== undefined && !["open", "resolved", "all"].includes(flags.status)) {
        throw new PapercutsError("invalid_argument", `invalid status '${flags.status}'`);
      }
      return listPapercuts({
        status: flags.status,
        tag: flags.tag,
        severity: flags.severity === undefined ? undefined : severity(flags.severity),
        limit: flags.limit === undefined ? undefined : Math.max(1, integer(flags.limit, "limit")),
        agent: flags.agent,
        startDirectory: process.cwd(),
      });
    }
    case "resolve": {
      const { flags, positionals } = parseFlags(rest, ["note", "agent"]);
      if (positionals.length !== 1) {
        throw new PapercutsError("invalid_argument", "resolve takes exactly one ID prefix");
      }
      return resolvePapercut({
        idPrefix: positionals[0],
        note: flags.note,
        agent: flags.agent,
        startDirectory: process.cwd(),
      });
    }
    case "remove": {
      const { flags, positionals } = parseFlags(rest, ["agent"]);
      if (positionals.length !== 1) {
        throw new PapercutsError("invalid_argument", "remove takes exactly one ID prefix");
      }
      return removePapercut({ idPrefix: positionals[0], agent: flags.agent, startDirectory: process.cwd() });
    }
    default:
      usage();
      throw new PapercutsError("usage", `unknown or missing command '${command ?? ""}'; see usage on stderr`);
  }
}

try {
  output(main());
} catch (error) {
  const envelope = errorEnvelope(error);
  console.log(JSON.stringify(envelope));
  process.exitCode = exitCodeFor(envelope.error.code);
}
