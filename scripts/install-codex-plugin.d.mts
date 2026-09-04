export interface InstallCodexOptions {
  repoRoot?: string;
  installTarget?: string;
  marketplaceFile?: string;
  binDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface InstallResult {
  status: number;
  lines: string[];
  errors: string[];
  skip?: string;
}

export function installCodex(options?: InstallCodexOptions): InstallResult;
export function pinMcpServerPath(installTarget: string): void;
export function removeStaleNodeModules(installTarget: string): void;
