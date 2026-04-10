import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli";

test("trigger injects the saved prompt into the bound Ghostty terminal", async () => {
  let stdout = "";
  const calls: Array<{ terminalId: string; prompt: string }> = [];

  const exitCode = await runCli(["trigger", "58256"], {
    listCodexProcesses: async () => [],
    listGhosttyTerminals: async () => [],
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
          ghosttyTerminalName: "⠹ monitor",
          prompt: "继续，刚才中断了。请从上次停下的位置继续。",
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
    saveState: async () => {},
    injectPromptIntoTerminal: async (terminalId, prompt) => {
      calls.push({ terminalId, prompt });
    },
    writeStdout: (chunk) => {
      stdout += chunk;
    },
    writeStderr: () => {},
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    terminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
    prompt: "继续，刚才中断了。请从上次停下的位置继续。",
  });
  assert.match(stdout, /Triggered recovery prompt for pid 58256/);
});
