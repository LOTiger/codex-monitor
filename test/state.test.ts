import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createEmptyState,
  removeBinding,
  saveState,
  loadState,
  upsertBinding,
} from "../src/state";

test("loadState returns an empty state when the file does not exist", async () => {
  const state = await loadState({
    stateFile: "/tmp/codex-guard-state-missing.json",
    readTextFile: async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.deepEqual(state, createEmptyState());
});

test("upsertBinding replaces an existing binding with the same pid", () => {
  const initial = createEmptyState();
  const once = upsertBinding(initial, {
    pid: 58256,
    tty: "ttys002",
    cwd: "/Users/lotiger/xiaoe/ai/monitor",
    sessionId: "session-a",
    sessionFile: "/tmp/a.jsonl",
    ghosttyTerminalId: "terminal-a",
    ghosttyTerminalName: "monitor",
    prompt: "continue",
    idleTimeoutSeconds: 120,
    cooldownSeconds: 180,
    maxAutoResume: 3,
    resumeCount: 0,
    lastActivityAt: "2026-04-06T01:11:56.717Z",
    lastResumeAt: "",
    sessionOffset: 42,
    logOffset: 99,
  });

  const twice = upsertBinding(once, {
    ...once.bindings[0],
    ghosttyTerminalId: "terminal-b",
  });

  assert.equal(twice.bindings.length, 1);
  assert.equal(twice.bindings[0].ghosttyTerminalId, "terminal-b");
});

test("upsertBinding keeps separate bindings when the same session id is bound to different terminals", () => {
  const initial = createEmptyState();
  const once = upsertBinding(initial, {
    pid: 58256,
    tty: "ttys002",
    cwd: "/Users/lotiger/xiaoe/ai/monitor",
    sessionId: "session-a",
    sessionFile: "/tmp/a.jsonl",
    ghosttyTerminalId: "terminal-a",
    ghosttyTerminalName: "monitor",
    prompt: "continue",
    idleTimeoutSeconds: 120,
    cooldownSeconds: 180,
    maxAutoResume: 3,
    resumeCount: 0,
    lastActivityAt: "2026-04-06T01:11:56.717Z",
    lastResumeAt: "",
    sessionOffset: 42,
    logOffset: 99,
  });

  const twice = upsertBinding(once, {
    ...once.bindings[0],
    pid: 60000,
    tty: "ttys003",
    ghosttyTerminalId: "terminal-b",
    ghosttyTerminalName: "monitor-2",
  });

  assert.equal(twice.bindings.length, 2);
  assert.equal(twice.bindings[0].ghosttyTerminalId, "terminal-a");
  assert.equal(twice.bindings[1].ghosttyTerminalId, "terminal-b");
});

test("upsertBinding replaces an existing binding with the same terminal id after pid changes", () => {
  const initial = createEmptyState();
  const once = upsertBinding(initial, {
    pid: 58256,
    tty: "ttys002",
    cwd: "/Users/lotiger/xiaoe/ai/monitor",
    sessionId: "session-a",
    sessionFile: "/tmp/a.jsonl",
    ghosttyTerminalId: "terminal-a",
    ghosttyTerminalName: "monitor",
    prompt: "continue",
    idleTimeoutSeconds: 120,
    cooldownSeconds: 180,
    maxAutoResume: 3,
    resumeCount: 0,
    lastActivityAt: "2026-04-06T01:11:56.717Z",
    lastResumeAt: "",
    sessionOffset: 42,
    logOffset: 99,
  });

  const twice = upsertBinding(once, {
    ...once.bindings[0],
    pid: 60000,
    tty: "ttys003",
    sessionId: "session-b",
    sessionFile: "/tmp/b.jsonl",
  });

  assert.equal(twice.bindings.length, 1);
  assert.equal(twice.bindings[0].pid, 60000);
  assert.equal(twice.bindings[0].tty, "ttys003");
  assert.equal(twice.bindings[0].sessionId, "session-b");
});

test("removeBinding deletes a binding by pid", () => {
  const state = upsertBinding(createEmptyState(), {
    pid: 58256,
    tty: "ttys002",
    cwd: "/Users/lotiger/xiaoe/ai/monitor",
    sessionId: "session-a",
    sessionFile: "/tmp/a.jsonl",
    ghosttyTerminalId: "terminal-a",
    ghosttyTerminalName: "monitor",
    prompt: "continue",
    idleTimeoutSeconds: 120,
    cooldownSeconds: 180,
    maxAutoResume: 3,
    resumeCount: 0,
    lastActivityAt: "2026-04-06T01:11:56.717Z",
    lastResumeAt: "",
    sessionOffset: 42,
    logOffset: 99,
  });

  const next = removeBinding(state, 58256);

  assert.equal(next.bindings.length, 0);
});

test("saveState serializes the state as JSON", async () => {
  let writtenPath = "";
  let writtenContent = "";
  const stateFile = path.join("/tmp", "codex-guard-state.json");

  await saveState(
    {
      version: 1,
      bindings: [],
    },
    {
      stateFile,
      ensureDir: async (dirPath) => {
        assert.equal(dirPath, "/tmp");
      },
      writeTextFile: async (filePath, content) => {
        writtenPath = filePath;
        writtenContent = content;
      },
    },
  );

  assert.equal(writtenPath, stateFile);
  assert.match(writtenContent, /"version": 1/);
  assert.match(writtenContent, /"bindings": \[/);
});
