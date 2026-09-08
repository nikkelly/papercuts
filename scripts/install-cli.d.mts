export interface InstallCliOptions {
  repoRoot?: string;
  shareDir?: string;
  binDir?: string;
}

export interface InstallResult {
  status: number;
  lines: string[];
  errors: string[];
  skip?: string;
}

export function installCli(options?: InstallCliOptions): InstallResult;
