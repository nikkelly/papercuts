import assert from "node:assert/strict";
import test from "node:test";

import { buildSteps, runSteps } from "../scripts/install-all.mjs";

function ok(lines: string[] = []) {
  return { status: 0, lines, errors: [] };
}

function fail(message: string) {
  return { status: 1, lines: [], errors: [message] };
}

function skip(message: string) {
  return { status: 0, skip: message, lines: [], errors: [] };
}

function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    text: () => ({ out: out.join("\n"), err: err.join("\n") }),
  };
}

test("buildSteps runs portable steps first: cli, codex, opencode", () => {
  const calls: string[] = [];
  const steps = buildSteps({
    cli: () => {
      calls.push("cli");
      return ok();
    },
    codex: () => {
      calls.push("codex");
      return ok();
    },
    opencode: () => {
      calls.push("opencode");
      return ok();
    },
  });
  const io = captureIo();
  const { status } = runSteps(steps, io);
  assert.equal(status, 0);
  assert.deepEqual(calls, ["cli", "codex", "opencode"]);
});

test("buildSteps threads globalTarget into the opencode installer", () => {
  let received: { globalTarget: boolean } | undefined;
  const steps = buildSteps({
    cli: () => ok(),
    codex: () => ok(),
    opencode: (options) => {
      received = options;
      return ok();
    },
  }, { globalTarget: true });
  runSteps(steps, captureIo());
  assert.deepEqual(received, { globalTarget: true });
});

test("runSteps fail-fast stops the run at the first hard error", () => {
  const calls: string[] = [];
  const steps = [
    { label: "first", run: () => { calls.push("first"); return ok(); } },
    { label: "second", run: () => { calls.push("second"); return fail("boom"); } },
    { label: "third", run: () => { calls.push("third"); return ok(); } },
  ];
  const io = captureIo();
  const { status } = runSteps(steps, io);
  assert.equal(status, 1);
  assert.deepEqual(calls, ["first", "second"]);
  const { err, out } = io.text();
  assert.match(err, /error: second failed/);
  assert.ok(!out.includes("== third =="), out);
});

test("runSteps treats an absent host as a skip, not a failure, and keeps going", () => {
  const calls: string[] = [];
  const steps = [
    { label: "first", run: () => { calls.push("first"); return skip("host missing"); } },
    { label: "second", run: () => { calls.push("second"); return ok(); } },
  ];
  const io = captureIo();
  const { status, skipped, installed } = runSteps(steps, io);
  assert.equal(status, 0);
  assert.deepEqual(calls, ["first", "second"]);
  assert.deepEqual(skipped, ["first"]);
  assert.deepEqual(installed, ["second"]);
  assert.match(io.text().out, /SKIPPED: host missing/);
});

test("runSteps reports every step as installed when nothing fails", () => {
  const { status, installed, skipped } = runSteps([
    { label: "a", run: () => ok() },
    { label: "b", run: () => ok() },
  ], captureIo());
  assert.equal(status, 0);
  assert.deepEqual(installed, ["a", "b"]);
  assert.deepEqual(skipped, []);
});

test("the final summary prints the pen, verification command, and restart reminder", () => {
  const io = captureIo();
  runSteps([{ label: "a", run: () => ok() }], io);
  const text = io.text().out;
  assert.match(text, /AGENTS\.md pen: papercuts add "what you hit/);
  assert.match(text, /Verify with: papercuts list/);
  assert.match(text, /Restart opencode and start a new Codex session/);
});

test("the final summary names skipped hosts when some steps skipped", () => {
  const io = captureIo();
  runSteps([
    { label: "codex plugin", run: () => skip("absent") },
    { label: "opencode config", run: () => ok() },
  ], io);
  const text = io.text().out;
  assert.match(text, /skipped \(host not installed\): codex plugin/);
});
