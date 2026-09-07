import type { ListItem, Severity } from "../plugin/src/journal.ts";

export interface FoldedPapercuts {
  items: readonly ListItem[];
}

export interface Stats {
  open: number;
  openedToday: number;
  resolvedToday: number;
  bySeverity: Record<Severity, number>;
}

export type StatsLevel = "muted" | "warning" | "error";

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isToday(value: string, now: Date): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && isSameLocalDay(parsed, now);
}

export function computeStats(
  entries: FoldedPapercuts,
  now: Date = new Date(),
): Stats {
  let open = 0;
  let openedToday = 0;
  let resolvedToday = 0;
  const bySeverity: Record<Severity, number> = { minor: 0, major: 0, blocker: 0 };
  for (const item of entries.items) {
    if (isToday(item.cut.ts, now)) {
      openedToday += 1;
    }
    if (item.resolution && isToday(item.resolution.ts, now)) {
      resolvedToday += 1;
    }
    if (item.status === "open") {
      open += 1;
      bySeverity[item.cut.severity] += 1;
    }
  }
  return { open, openedToday, resolvedToday, bySeverity };
}

export function level(stats: Stats): StatsLevel {
  if (stats.bySeverity.blocker > 0) return "error";
  if (stats.openedToday >= 3 || stats.bySeverity.major >= 2) return "warning";
  return "muted";
}

export function isVisible(stats: Stats, muted = false): boolean {
  if (muted) return false;
  return stats.open > 0 || stats.openedToday > 0 || stats.resolvedToday > 0;
}

export function collapsible(stats: Stats): boolean {
  return stats.open > 2;
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function summarySegments(stats: Stats): string[] {
  const segments = [`${stats.open} ${pluralize(stats.open, "open papercut")}`];
  if (stats.openedToday > 0) segments.push(`+${stats.openedToday} today`);
  if (stats.bySeverity.blocker > 0) {
    segments.push(
      `${stats.bySeverity.blocker} ${pluralize(stats.bySeverity.blocker, "blocker")}`,
    );
  }
  return segments;
}

export function breakdownLine(stats: Stats): string | null {
  if (stats.bySeverity.major === 0 && stats.bySeverity.blocker === 0) {
    return null;
  }
  const parts: string[] = [];
  if (stats.bySeverity.minor > 0) {
    parts.push(`${stats.bySeverity.minor} minor`);
  }
  if (stats.bySeverity.major > 0) {
    parts.push(`${stats.bySeverity.major} major`);
  }
  if (stats.bySeverity.blocker > 1) {
    parts.push(`${stats.bySeverity.blocker} blockers`);
  }
  return parts.join(" · ");
}

export function formatLines(stats: Stats): string[] {
  const lines = [summarySegments(stats).join(" · ")];
  const breakdown = breakdownLine(stats);
  if (breakdown) lines.push(breakdown);
  return lines;
}
