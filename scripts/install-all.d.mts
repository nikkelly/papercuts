export interface StepResult {
  status: number;
  lines: string[];
  errors: string[];
  skip?: string;
}

export interface Step {
  label: string;
  run: () => StepResult;
}

export interface StepIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export function buildSteps(
  installers: {
    cli: () => StepResult;
    codex: () => StepResult;
    opencode: (options: { globalTarget: boolean }) => StepResult;
  },
  options?: { globalTarget?: boolean },
): Step[];

export function runSteps(
  steps: Step[],
  io?: StepIo,
): { status: number; installed: string[]; skipped: string[] };
