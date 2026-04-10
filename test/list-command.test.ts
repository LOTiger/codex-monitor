import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli";

test("list prints discovered codex processes in a readable table", async () => {
  let stdout = "";
  let stderr = "";

  const exitCode = await runCli(["list"], {
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
    loadState: async () => ({
      version: 1,
      bindings: [
        {
          pid: 58256,
          tty: "ttys002",
          cwd: "/Users/lotiger/xiaoe/ai/monitor",
          sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
          sessionFile:
            "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
          ghosttyTerminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
          ghosttyTerminalName: "monitor",
          prompt: "继续",
          idleTimeoutSeconds: 120,
          cooldownSeconds: 180,
          maxAutoResume: 3,
          resumeCount: 0,
          lastActivityAt: "",
          lastResumeAt: "",
          sessionOffset: 0,
          logOffset: 0,
        },
      ],
    }),
    writeStdout: (chunk) => {
      stdout += chunk;
    },
    writeStderr: (chunk) => {
      stderr += chunk;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /PID/);
  assert.match(stdout, /58256/);
  assert.match(stdout, /ttys002/);
  assert.match(stdout, /monitor/);
  assert.match(stdout, /019d6057-5b00-70f0-bed7-96d71b8757fd/);
  assert.match(stdout, /\byes\b/);
});
