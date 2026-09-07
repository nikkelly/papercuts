import { PapercutsError } from "./journal.ts";

export function ok(data: unknown): { ok: true; data: unknown } {
  return { ok: true, data };
}

export function errorEnvelope(error: unknown): {
  ok: false;
  error: { code: string; message: string; candidates?: string[] };
} {
  if (error instanceof PapercutsError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.candidates !== undefined ? { candidates: error.candidates } : {}),
      },
    };
  }
  return { ok: false, error: { code: "io_error", message: String(error) } };
}

export function exitCodeFor(code: string): number {
  if (code === "not_found" || code === "ambiguous_id") {
    return 2;
  }
  if (code === "io_error") {
    return 3;
  }
  return 1;
}