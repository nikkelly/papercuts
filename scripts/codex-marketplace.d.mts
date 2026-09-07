export interface PapercutsMarketplaceEntry {
  name: string;
  source: {
    source: string;
    path: string;
    url?: string;
  };
  policy: {
    installation: string;
    authentication: string;
  };
  category: string;
}

export const PAPERCUTS_ENTRY: PapercutsMarketplaceEntry;

export function marketplaceEntry(
  mode: "local" | "git-subdir",
): PapercutsMarketplaceEntry;

export function mergeMarketplace(
  existing: unknown,
  entry?: PapercutsMarketplaceEntry,
): Record<string, unknown> & { plugins: PapercutsMarketplaceEntry[] };