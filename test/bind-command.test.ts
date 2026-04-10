import assert from "node:assert/strict";
import test from "node:test";

import { GuardState } from "../src/types";
import { runCli } from "../src/cli";

test("bind saves a binding when exactly one Ghostty terminal matches the cwd", async () => {
  let stdout = "";
  let savedState: GuardState | null = null;

  const exitCode = await runCli(["bind", "58256"], {
    listCodexProcesses: async () => [
      {
        pid: 58256,
        ppid: 23000,
        tty: "ttys002",
        status: "S+",
        command: "codex -a never -s danger-full-access",
        ttyDevice: "/dev/ttys002",
        cwd: "/Users/lotiger/xiaoe/ai/monitor",
        sessionFile:
          "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
        sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
        protected: false,
      },
    ],
    listGhosttyTerminals: async () => [
      {
        id: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
        name: "⠹ monitor",
        workingDirectory: "/Users/lotiger/xiaoe/ai/monitor",
      },
    ],
    loadState: async () => ({
      version: 1,
      bindings: [],
    }),
    saveState: async (state) => {
      savedState = state;
    },
    writeStdout: (chunk) => {
      stdout += chunk;
    },
    writeStderr: () => {},
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Bound pid 58256/);
  assert.equal(savedState?.bindings.length, 1);
  assert.equal(
    savedState?.bindings[0].ghosttyTerminalId,
    "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
  );
});

test("bind lists Ghostty terminal candidates when cwd matches are ambiguous", async () => {
  let stderr = "";

  const exitCode = await runCli(["bind", "62841"], {
    listCodexProcesses: async () => [
      {
        pid: 62841,
        ppid: 78988,
        tty: "ttys000",
        status: "S+",
        command: "codex -a never -s danger-full-access",
        ttyDevice: "/dev/ttys000",
        cwd: "/Users/lotiger/xiaoe/test-case/course-test-case",
        sessionFile:
          "/Users/lotiger/.codex/sessions/2026/04/08/rollout-2026-04-08T01-00-00-01900000-0000-7000-8000-000000000000.jsonl",
        sessionId: "01900000-0000-7000-8000-000000000000",
        protected: false,
      },
    ],
    listGhosttyTerminals: async () => [
      {
        id: "7F5DA08F-3A31-4965-A2AE-5DEC6857EBF6",
        name: "lotiger@lotigerdeMac-mini:~/xiaoe/test-case/course-test-case",
        workingDirectory: "/Users/lotiger/xiaoe/test-case/course-test-case",
      },
      {
        id: "D56575E4-C599-4B78-B221-832D7BF5E16E",
        name: "lotiger@lotigerdeMac-mini:~/xiaoe/test-case/course-test-case",
        workingDirectory: "/Users/lotiger/xiaoe/test-case/course-test-case",
      },
    ],
    loadState: async () => ({
      version: 1,
      bindings: [],
    }),
    saveState: async () => {},
    writeStdout: () => {},
    writeStderr: (chunk) => {
      stderr += chunk;
    },
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /Could not determine a unique Ghostty terminal for pid 62841/);
  assert.match(stderr, /7F5DA08F-3A31-4965-A2AE-5DEC6857EBF6/);
  assert.match(stderr, /D56575E4-C599-4B78-B221-832D7BF5E16E/);
  assert.match(stderr, /codex-guard bind 62841 <terminal-id>/);
});

test("bind accepts an explicit Ghostty terminal id when cwd matches are ambiguous", async () => {
  let stdout = "";
  let savedState: GuardState | null = null;

  const exitCode = await runCli(
    ["bind", "62841", "D56575E4-C599-4B78-B221-832D7BF5E16E"],
    {
      listCodexProcesses: async () => [
        {
          pid: 62841,
          ppid: 78988,
          tty: "ttys000",
          status: "S+",
          command: "codex -a never -s danger-full-access",
          ttyDevice: "/dev/ttys000",
          cwd: "/Users/lotiger/xiaoe/test-case/course-test-case",
          sessionFile:
            "/Users/lotiger/.codex/sessions/2026/04/08/rollout-2026-04-08T01-00-00-01900000-0000-7000-8000-000000000000.jsonl",
          sessionId: "01900000-0000-7000-8000-000000000000",
          protected: false,
        },
      ],
      listGhosttyTerminals: async () => [
        {
          id: "7F5DA08F-3A31-4965-A2AE-5DEC6857EBF6",
          name: "lotiger@lotigerdeMac-mini:~/xiaoe/test-case/course-test-case",
          workingDirectory: "/Users/lotiger/xiaoe/test-case/course-test-case",
        },
        {
          id: "D56575E4-C599-4B78-B221-832D7BF5E16E",
          name: "lotiger@lotigerdeMac-mini:~/xiaoe/test-case/course-test-case",
          workingDirectory: "/Users/lotiger/xiaoe/test-case/course-test-case",
        },
      ],
      loadState: async () => ({
        version: 1,
        bindings: [],
      }),
      saveState: async (state) => {
        savedState = state;
      },
      writeStdout: (chunk) => {
        stdout += chunk;
      },
      writeStderr: () => {},
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stdout, /Bound pid 62841/);
  assert.equal(
    savedState?.bindings[0].ghosttyTerminalId,
    "D56575E4-C599-4B78-B221-832D7BF5E16E",
  );
});
