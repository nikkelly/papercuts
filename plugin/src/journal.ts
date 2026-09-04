import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const AGENT = "opencode";

export type Severity = "minor" | "major" | "blocker";

const SEVERITY_RANK: Record<Severity, number> = {
  minor: 0,
  major: 1,
  blocker: 2,
};

export interface Evidence {
  cmd?: string;
  exitCode?: number;
}

export interface CutRecord {
  kind: "cut";
  id: string;
  ts: string;
  agent: string;
  text: string;
  tags: string[];
  severity: Severity;
  cwd: string;
  repo: string | null;
  evidence?: Evidence;
}

export interface Resolution {
  ts: string;
  agent: string;
  note?: string;
}

export interface ListItem {
  cut: CutRecord;
  status: "open" | "resolved";
  resolution?: Resolution;
}

export interface FoldResult {
  items: ListItem[];
  removedIds: Set<string>;
  /** Last mute/unmute event wins; absent events mean unmuted. */
  muted: boolean;
  warnings: string[];
}

export class PapercutsError extends Error {
  code: "invalid_argument" | "not_found" | "ambiguous_id" | "io_error";
  candidates?: string[];

  constructor(
    code: PapercutsError["code"],
    message: string,
    candidates?: string[],
  ) {
    super(message);
    this.name = "PapercutsError";
    this.code = code;
    this.candidates = candidates;
  }
}

type Clock = () => Date;

export interface OpenOptions {
  startDirectory: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable existence check for repository discovery, used in tests. */
  exists?: (path: string) => boolean;
  /** Injectable clock for timestamps, used in tests. */
  now?: Clock;
}

export interface AddInput {
  text: string;
  tag?: string;
  agent?: string;
  severity?: Severity;
  cmd?: string;
  exitCode?: number;
}

export interface ListInput {
  agent?: string;
  status?: "open" | "resolved" | "all";
  tag?: string;
  severity?: Severity;
  limit?: number;
}

export interface ResolveInput {
  idPrefix: string;
  note?: string;
  agent?: string;
}

export interface RemoveInput {
  idPrefix: string;
  agent?: string;
}

export interface MuteEvent {
  kind: "mute" | "unmute";
  ts: string;
  agent: string;
}

export interface MuteResult {
  changed: boolean;
  muted: boolean;
  event: MuteEvent | null;
  warnings: string[];
}

export interface StatusResult {
  muted: boolean;
  file: string;
  exists: boolean;
  warnings: string[];
}

export interface Preview {
  items: ListItem[];
  muted: boolean;
  warnings: string[];
}

/**
 * The journal module. Discovery of where the journal lives, reading and
 * appending to it, and folding its append-only event stream into a view are
 * all owned here. Callers open a `Journal` at a directory once and operate on
 * it; they never touch the filesystem or learn the fold rules.
 *
 * The journal is append-only and shared across processes (opencode plugin,
 * CLI, TUI, and Codex all write the same file), so every operation reads and
 * re-folds fresh rather than trusting cached state.
 */
export class Journal {
  readonly path: string;
  readonly repo: string | null;
  private readonly cwd: string;
  private readonly exists: (path: string) => boolean;
  private readonly now: Clock;

  private constructor(
    path: string,
    repo: string | null,
    cwd: string,
    exists: (path: string) => boolean,
    now: Clock,
  ) {
    this.path = path;
    this.repo = repo;
    this.cwd = cwd;
    this.exists = exists;
    this.now = now;
  }

  /** Discover and open the journal for the given starting directory. */
  static open(options: OpenOptions): Journal {
    const { path, repo } = discoverLogPath(
      options.startDirectory,
      options.env ?? process.env,
      options.exists ?? existsSync,
    );
    return new Journal(path, repo, resolve(options.startDirectory), options.exists ?? existsSync, options.now ?? (() => new Date()));
  }

  add(input: AddInput): {
    changed: boolean;
    record: CutRecord;
    warnings: string[];
  } {
    const text = input.text;
    if (text.trim().length === 0) {
      throw new PapercutsError(
        "invalid_argument",
        "papercut text cannot be empty or whitespace-only",
      );
    }
    if (Buffer.byteLength(text, "utf8") > 10_000) {
      throw new PapercutsError(
        "invalid_argument",
        "papercut text exceeds the maximum of 10000 bytes",
      );
    }
    const severity = input.severity ?? "minor";
    const tags = input.tag ? [input.tag] : [];
    const ts = nowIso(this.now());
    const agent = effectiveAgent(input.agent);
    const id = computeId(text, severity, tags);

    const trimmed = text.trimStart();
    const warnings: string[] = [];
    if (/^(RESOLUTION|RESOLVED)\b/i.test(trimmed)) {
      warnings.push(
        "this looks like a resolution; use papercuts_resolve on an existing papercut instead",
      );
    }

    const hasEvidence = input.cmd !== undefined || input.exitCode !== undefined;
    const record: CutRecord = {
      kind: "cut",
      id,
      ts,
      agent,
      text,
      tags,
      severity,
      cwd: this.cwd,
      repo: this.repo,
      ...(hasEvidence
        ? {
            evidence: {
              ...(input.cmd !== undefined ? { cmd: input.cmd } : {}),
              ...(input.exitCode !== undefined
                ? { exitCode: input.exitCode }
                : {}),
            },
          }
        : {}),
    };

    const prior = readLogBytes(this.path);
    if (prior) {
      const existing = fold(prior).items.find((item) => item.cut.id === id);
      if (existing) {
        warnings.push("duplicate papercut; existing record returned");
        return { changed: false, record: existing.cut, warnings };
      }
    }
    appendLine(this.path, JSON.stringify(record), prior);
    return { changed: true, record, warnings };
  }

  list(input: ListInput = {}): {
    items: ListItem[];
    count: number;
    total: number;
    truncated: boolean;
    warnings: string[];
    file: string;
  } {
    const status = input.status ?? "open";
    const limit = Math.max(1, input.limit ?? 20);
    const bytes = readLogBytes(this.path);
    if (!bytes) {
      return {
        items: [],
        count: 0,
        total: 0,
        truncated: false,
        warnings: ["no papercuts file yet; papercuts_add creates it"],
        file: this.path,
      };
    }
    const folded = fold(bytes);
    const agentFilter =
      input.agent === undefined ? undefined : effectiveAgent(input.agent);
    const filtered = folded.items.filter(
      (item) =>
        (status === "all" || item.status === status) &&
        (!agentFilter || item.cut.agent === agentFilter) &&
        (!input.tag || item.cut.tags.includes(input.tag)) &&
        (!input.severity || item.cut.severity === input.severity),
    );
    const items = filtered.slice(0, limit);
    return {
      items,
      count: items.length,
      total: filtered.length,
      truncated: filtered.length > items.length,
      warnings: folded.warnings,
      file: this.path,
    };
  }

  resolve(input: ResolveInput): {
    changed: boolean;
    item: ListItem;
    warnings: string[];
  } {
    const prefix = normalizeId(input.idPrefix);
    const prior = readLogBytes(this.path);
    if (!prior) {
      throw new PapercutsError("not_found", "no papercuts file exists yet");
    }
    const folded = fold(prior);
    const id = matchId(prefix, folded.items.map((item) => item.cut.id));
    const item = folded.items.find((entry) => entry.cut.id === id)!;
    if (item.status === "resolved") {
      return {
        changed: false,
        item,
        warnings: ["already resolved; no resolve event appended"],
      };
    }
    const ts = nowIso(this.now());
    const agent = effectiveAgent(input.agent);
    const event = {
      kind: "resolve",
      id,
      ts,
      agent,
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    appendLine(this.path, JSON.stringify(event), prior);
    return {
      changed: true,
      item: {
        ...item,
        status: "resolved",
        resolution: { ts, agent, note: input.note },
      },
      warnings: [],
    };
  }

  remove(input: RemoveInput): {
    changed: boolean;
    id: string;
    warnings: string[];
  } {
    const prefix = normalizeId(input.idPrefix);
    const prior = readLogBytes(this.path);
    if (!prior) {
      throw new PapercutsError("not_found", "no papercuts file exists yet");
    }
    const folded = fold(prior);
    const candidates = [
      ...folded.items.map((item) => item.cut.id),
      ...folded.removedIds,
    ];
    const id = matchId(prefix, candidates);
    if (folded.removedIds.has(id)) {
      return { changed: false, id, warnings: ["already removed"] };
    }
    const event = {
      kind: "remove",
      id,
      ts: nowIso(this.now()),
      agent: effectiveAgent(input.agent),
    };
    appendLine(this.path, JSON.stringify(event), prior);
    return { changed: true, id, warnings: [] };
  }

  setMuted(muted: boolean, input: { agent?: string } = {}): MuteResult {
    const prior = readLogBytes(this.path);
    const current = prior ? fold(prior).muted : false;
    if (current === muted) {
      return {
        changed: false,
        muted: current,
        event: null,
        warnings: [`papercuts are already ${current ? "muted" : "unmuted"}`],
      };
    }
    const event: MuteEvent = {
      kind: muted ? "mute" : "unmute",
      ts: nowIso(this.now()),
      agent: effectiveAgent(input.agent),
    };
    appendLine(this.path, JSON.stringify(event), prior);
    return { changed: true, muted, event, warnings: [] };
  }

  status(): StatusResult {
    const prior = readLogBytes(this.path);
    if (!prior) {
      return {
        muted: false,
        file: this.path,
        exists: false,
        warnings: ["no papercuts file yet; mute or add creates it"],
      };
    }
    const folded = fold(prior);
    return {
      muted: folded.muted,
      file: this.path,
      exists: true,
      warnings: folded.warnings,
    };
  }

  /** Read-only view for the sidebar and other observers that never mutate. */
  preview(): Preview {
    const prior = readLogBytes(this.path);
    if (!prior) {
      return { items: [], muted: false, warnings: [] };
    }
    const folded = fold(prior);
    return { items: folded.items, muted: folded.muted, warnings: folded.warnings };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Fold the raw journal bytes into the current view. Owned here as the read
 * seam: the eval harness and read-only observers fold arbitrary bytes through
 * this module instead of re-implementing the fold rules.
 */
export function fold(bytes: Buffer): FoldResult {
  const cuts = new Map<string, CutRecord>();
  const resolves = new Map<string, Resolution>();
  const removes = new Map<string, string>();
  const counts = { torn: 0, malformed: 0, unknown: 0, duplicateCut: 0, duplicateResolve: 0, orphan: 0 };

  let muted = false;

  let completeLength = bytes.length;
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
    counts.torn += 1;
    const lastNewline = bytes.lastIndexOf("\n");
    completeLength = lastNewline === -1 ? 0 : lastNewline + 1;
  }

  const complete = bytes.subarray(0, completeLength).toString("utf8");
  for (const line of complete.split("\n")) {
    if (line === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      counts.malformed += 1;
      continue;
    }
    if (typeof value !== "object" || value === null) {
      counts.malformed += 1;
      continue;
    }
    const record = value as Record<string, unknown>;
    switch (record.kind) {
      case "cut": {
        const cut = parseCut(record);
        if (!cut || Number.isNaN(Date.parse(cut.ts))) {
          counts.malformed += 1;
          break;
        }
        cut.tags.sort();
        if (cuts.has(cut.id)) {
          counts.duplicateCut += 1;
        }
        // Last-wins so a re-added papercut supersedes its earlier suppressed self.
        cuts.set(cut.id, cut);
        break;
      }
      case "resolve": {
        const id = typeof record.id === "string" ? record.id : "";
        const ts = typeof record.ts === "string" ? record.ts : "";
        if (!id || Number.isNaN(Date.parse(ts))) {
          counts.malformed += 1;
          break;
        }
        if (resolves.has(id)) {
          counts.duplicateResolve += 1;
        } else {
          resolves.set(id, {
            ts,
            agent: typeof record.agent === "string" ? record.agent : AGENT,
            note: typeof record.note === "string" ? record.note : undefined,
          });
        }
        break;
      }
      case "remove": {
        const id = typeof record.id === "string" ? record.id : "";
        const ts = typeof record.ts === "string" ? record.ts : "";
        if (!id || Number.isNaN(Date.parse(ts))) {
          counts.malformed += 1;
          break;
        }
        removes.set(id, ts);
        break;
      }
      case "mute":
      case "unmute": {
        const ts = typeof record.ts === "string" ? record.ts : "";
        if (Number.isNaN(Date.parse(ts))) {
          counts.malformed += 1;
          break;
        }
        muted = record.kind === "mute";
        break;
      }
      default:
        counts.unknown += 1;
    }
  }

  for (const id of resolves.keys()) {
    if (!cuts.has(id)) {
      counts.orphan += 1;
    }
  }

  const items: ListItem[] = [];
  const removedIds = new Set<string>();
  for (const cut of cuts.values()) {
    const removedTs = removes.get(cut.id);
    if (removedTs !== undefined && Date.parse(removedTs) >= Date.parse(cut.ts)) {
      removedIds.add(cut.id);
      continue;
    }
    const resolution = resolves.get(cut.id);
    items.push({
      cut,
      status: resolution ? ("resolved" as const) : ("open" as const),
      ...(resolution ? { resolution } : {}),
    });
  }
  items.sort((left, right) =>
    SEVERITY_RANK[right.cut.severity] - SEVERITY_RANK[left.cut.severity] ||
    Date.parse(right.cut.ts) - Date.parse(left.cut.ts) ||
    left.cut.id.localeCompare(right.cut.id),
  );

  const warnings: string[] = [];
  const warn = (count: number, label: string) => {
    if (count > 0) {
      warnings.push(`skipped ${count} ${label}${count === 1 ? "" : "s"}`);
    }
  };
  warn(counts.torn, "torn final line");
  warn(counts.malformed, "malformed line");
  warn(counts.unknown, "unknown event");
  warn(counts.duplicateCut, "duplicate cut");
  warn(counts.duplicateResolve, "duplicate resolve");
  warn(counts.orphan, "orphan resolve");

  return { items, removedIds, muted, warnings };
}

function parseCut(record: Record<string, unknown>): CutRecord | null {
  const severity = record.severity;
  if (
    typeof record.id !== "string" ||
    typeof record.ts !== "string" ||
    typeof record.text !== "string" ||
    (severity !== "minor" && severity !== "major" && severity !== "blocker") ||
    !Array.isArray(record.tags)
  ) {
    return null;
  }
  const evidence = record.evidence;
  return {
    kind: "cut",
    id: record.id,
    ts: record.ts,
    agent: typeof record.agent === "string" ? record.agent : AGENT,
    text: record.text,
    tags: record.tags.filter((tag): tag is string => typeof tag === "string"),
    severity,
    cwd: typeof record.cwd === "string" ? record.cwd : "",
    repo: typeof record.repo === "string" ? record.repo : null,
    evidence:
      evidence !== undefined && evidence !== null
        ? {
            cmd:
              typeof (evidence as Record<string, unknown>).cmd === "string"
                ? ((evidence as Record<string, unknown>).cmd as string)
                : undefined,
            exitCode:
              typeof (evidence as Record<string, unknown>).exitCode === "number"
                ? ((evidence as Record<string, unknown>).exitCode as number)
                : undefined,
          }
        : undefined,
  };
}

function discoverLogPath(
  startDirectory: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): { path: string; repo: string | null } {
  const explicit = env.PAPERCUTS_FILE;
  if (explicit && explicit.trim() !== "") {
    return { path: resolve(explicit), repo: findRepositoryRoot(startDirectory, exists) };
  }
  const repo = findRepositoryRoot(startDirectory, exists);
  if (repo) {
    return { path: join(repo, ".papercuts.jsonl"), repo };
  }
  // Papercuts are repository-specific friction; without a repository the
  // journal stays anchored to the working directory instead of a global log.
  return { path: join(resolve(startDirectory), ".papercuts.jsonl"), repo: null };
}

function findRepositoryRoot(
  startDirectory: string,
  exists: (path: string) => boolean,
): string | null {
  let directory = resolve(startDirectory);
  while (true) {
    if (exists(join(directory, ".git"))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function lengthPrefix(value: string): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(Buffer.byteLength(value, "utf8"), 0);
  return Buffer.concat([length, Buffer.from(value, "utf8")]);
}

function computeId(text: string, severity: Severity, tags: string[]): string {
  const hash = createHash("sha256");
  for (const field of [text, severity, [...tags].sort().join(",")]) {
    hash.update(lengthPrefix(field));
  }
  return `pc_${hash.digest("hex").slice(0, 12)}`;
}

function normalizeId(input: string): string {
  let hex = input.trim();
  if (hex.slice(0, 3).toLowerCase() === "pc_") {
    hex = hex.slice(3);
  }
  if (hex.length < 4 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new PapercutsError(
      "invalid_argument",
      `invalid papercut ID prefix '${input}': use at least 4 hexadecimal digits, with an optional pc_ prefix`,
    );
  }
  return hex.toLowerCase();
}

function matchId(prefix: string, ids: string[]): string {
  const candidates = ids
    .filter((id) => id.startsWith("pc_"))
    .filter((id) => id.slice(3).toLowerCase().startsWith(prefix))
    .sort();
  if (candidates.length === 0) {
    throw new PapercutsError(
      "not_found",
      `no papercut matches ID prefix '${prefix}'`,
    );
  }
  if (candidates.length > 1) {
    throw new PapercutsError(
      "ambiguous_id",
      `ID prefix '${prefix}' is ambiguous; ${candidates.length} papercuts match`,
      candidates,
    );
  }
  return candidates[0]!;
}

function effectiveAgent(agent?: string): string {
  const normalized = (agent ?? AGENT).trim();
  if (normalized === "") {
    throw new PapercutsError(
      "invalid_argument",
      "agent name cannot be empty or whitespace-only",
    );
  }
  return normalized;
}

// The journal records the working directory the cut was filed from. Because a
// `Journal` is opened once at a start directory that callers may not retain,
// we snapshot the current working directory at open time via the resolved
// start directory. The processor's cwd at add() time is the authoritative
// fingerprint for the session, so capture it from the environment.
function readLogBytes(path: string): Buffer | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path);
}

function appendLine(path: string, line: string, prior: Buffer | null): void {
  mkdirSync(dirname(path), { recursive: true });
  let payload = line + "\n";
  if (prior && prior.length > 0 && prior[prior.length - 1] !== 0x0a) {
    payload = "\n" + payload;
  }
  appendFileSync(path, payload, "utf8");
}
