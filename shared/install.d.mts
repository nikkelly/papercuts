export function readJsonOrThrow(path: string): unknown | null;
export function readJsonOrDefault(path: string, fallback: unknown): unknown;
export function writeJson(path: string, value: unknown): void;
export function copyTree(src: string, dest: string): void;

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCommand(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): CommandResult;
