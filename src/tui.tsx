/** @jsxImportSource @opentui/solid */
import { readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { TuiPluginApi, TuiPluginModule, TuiTheme } from "@opencode-ai/plugin/tui";
import { createSignal, For, Show } from "solid-js";
import { discoverLogPath, foldBytes } from "../plugin/src/store.ts";
import {
  collapsible,
  computeStats,
  formatLines,
  isVisible,
  level,
  type Stats,
  type StatsLevel,
} from "./tui-stats.ts";

const REFRESH_INTERVAL_MS = 30_000;
const WATCH_DEBOUNCE_MS = 150;

type SlotContext = { theme: TuiTheme };

function readStats(journalPath: string): Stats | null {
  try {
    return computeStats(foldBytes(readFileSync(journalPath)));
  } catch {
    return null;
  }
}

function themeColor(ctx: SlotContext, value: StatsLevel) {
  const current = ctx.theme.current;
  if (value === "error") return current.error;
  if (value === "warning") return current.warning;
  return current.textMuted;
}

export const tui = async (api: TuiPluginApi) => {
  const root = api.state.path.worktree || api.state.path.directory;
  const journalPath = discoverLogPath(root).path;

  const [stats, setStats] = createSignal<Stats | null>(readStats(journalPath));

  const refresh = () => setStats(readStats(journalPath));

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(refresh, WATCH_DEBOUNCE_MS);
  };

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dirname(journalPath), (_event, filename) => {
      if (!filename || filename === basename(journalPath)) scheduleRefresh();
    });
  } catch {
    watcher = undefined;
  }

  const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
  interval.unref?.();

  const dispose = () => {
    if (debounce !== undefined) clearTimeout(debounce);
    clearInterval(interval);
    watcher?.close();
  };
  api.lifecycle.onDispose(dispose);
  if (api.lifecycle.signal.aborted) {
    dispose();
  } else {
    api.lifecycle.signal.addEventListener("abort", dispose, { once: true });
  }

  const [open, setOpen] = createSignal(true);

  api.slots.register({
    order: 150,
    slots: {
      sidebar_content: (ctx) => {
        const current = stats();
        if (!current || !isVisible(current)) return null;
        const color = themeColor(ctx, level(current));
        const lines = formatLines(current);
        const canCollapse = collapsible(current);
        return (
          <box>
            <box flexDirection="row" gap={1} onMouseDown={() => canCollapse && setOpen((x) => !x)}>
              <Show when={canCollapse}>
                <text style={{ fg: color }}>{open() ? "▼" : "▶"}</text>
              </Show>
              <text style={{ fg: color }}>
                <b>PAPERCUTS</b>
              </text>
            </box>
            <Show when={!canCollapse || open()}>
              <For each={lines}>{(line) => <text style={{ fg: color }}>{line}</text>}</For>
            </Show>
          </box>
        );
      },
    },
  });
};

const plugin = { id: "opencode-papercuts-tui", tui } satisfies TuiPluginModule & { id: string };
export default plugin;
