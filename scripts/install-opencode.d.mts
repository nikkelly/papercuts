export interface InstallOpenCodeOptions {
  repoRoot?: string;
  shareDir?: string;
  globalTarget?: boolean;
}

export interface InstallResult {
  status: number;
  lines: string[];
  errors: string[];
  skip?: string;
}

export function targets(globalTarget: boolean): {
  opencode: string;
  tui: string;
};

export function installOpenCode(options?: InstallOpenCodeOptions): InstallResult;
