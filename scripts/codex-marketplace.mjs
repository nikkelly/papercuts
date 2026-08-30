export function marketplaceEntry(mode) {
  if (mode === "git-subdir") {
    return {
      name: "papercuts",
      source: {
        source: "git-subdir",
        url: "https://github.com/nikkelly/opencode-papercuts.git",
        path: "./plugin",
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Developer tools",
    };
  }
  return {
    name: "papercuts",
    source: {
      source: "local",
      path: "./.codex/plugins/papercuts",
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Developer tools",
  };
}

export const PAPERCUTS_ENTRY = marketplaceEntry("local");

export function mergeMarketplace(existing, entry = PAPERCUTS_ENTRY) {
  const base = existing && typeof existing === "object" ? existing : {};
  const plugins = Array.isArray(base.plugins) ? [...base.plugins] : [];

  const index = plugins.findIndex((p) => p && typeof p === "object" && p.name === entry.name);
  if (index === -1) {
    plugins.push(entry);
  } else {
    plugins[index] = entry;
  }

  return {
    ...base,
    plugins,
  };
}
