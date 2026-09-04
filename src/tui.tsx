/** @jsxImportSource @opentui/solid */
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { TuiPluginApi, TuiPluginModule, TuiTheme } from "@opencode-ai/plugin/tui";
import { createSignal, For, Show } from "solid-js";
import { Journal } from "../plugin/src/journal.ts";
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

interface JournalView {
  stats: Stats;
  muted: boolean;
}

function readView(journal: Journal): JournalView | null {
  const preview = journal.preview();
  return { stats: computeStats(preview), muted: preview.muted };
}

function themeColor(ctx: SlotContext, value: StatsLevel) {
  const current = ctx.theme.current;
  if (value === "error") return current.error;
  if (value === "warning") return current.warning;
  return current.textMuted;
}

export const tui = async (api: TuiPluginApi) => {
  const root = api.state.path.worktree || api.state.path.directory;
  const journal = Journal.open({ startDirectory: root });
  const journalPath = journal.path;

  const [view, setView] = createSignal<JournalView | null>(readView(journal));

  const refresh = () => setView(readView(journal));

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

  const toggle = () => {
    try {
      const muted = !(view()?.muted ?? false);
      journal.setMuted(muted, { agent: "tui" });
      refresh();
      api.ui.toast({
        variant: muted ? "warning" : "success",
        title: "Papercuts",
        message: muted
          ? "Sidebar section hidden until unmuted"
          : "Sidebar section visible",
      });
    } catch (error) {
      api.ui.toast({
        variant: "error",
        title: "Papercuts",
        message: String(error),
      });
    }
  };

  const disposeLayer = api.keymap.registerLayer({
    commands: [
      {
        name: "papercuts.toggle",
        title: "Papercuts: Toggle sidebar",
        desc: "Show or hide the PAPERCUTS section in the sidebar",
        category: "Papercuts",
        run: () => toggle(),
      },
    ],
    bindings: [{ key: "<leader>p", cmd: "papercuts.toggle" }],
  });

  const dispose = () => {
    disposeLayer();
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
        const current = view();
        if (!current || !isVisible(current.stats, current.muted)) return null;
        const color = themeColor(ctx, level(current.stats));
        const lines = formatLines(current.stats);
        const canCollapse = collapsible(current.stats);
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

const plugin = { id: "papercuts-tui", tui } satisfies TuiPluginModule & { id: string };
export default plugin;