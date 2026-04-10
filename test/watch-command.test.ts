import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/cli";

const logFile = path.join(
  "/Users/lotiger/.codex",
  "log",
  "codex-tui.log",
);

test("watch --once triggers recovery and persists updated binding state", async () => {
  let stdout = "";
  let stderr = "";
  let savedState = null as Awaited<ReturnType<Parameters<typeof runCli>[1]["loadState"]>> | null;
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const exitCode = await runCli(["watch", "58256", "--once"], {
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
          ghosttyTerminalName: "monitor",
          prompt:
            "继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。",
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
    saveState: async (state) => {
      savedState = state;
    },
    readTextFile: async (filePath) => {
      if (filePath === logFile) {
        return "";
      }

      return [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"hi"}}',
        '{"timestamp":"2026-04-06T01:00:01.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
      ].join("\n");
    },
    processAlive: async () => true,
    now: () => Date.parse("2026-04-06T01:02:10.000Z"),
    sleep: async () => {},
    injectPromptIntoTerminal: async (terminalId, prompt) => {
      prompts.push({ terminalId, prompt });
    },
    writeStdout: (chunk) => {
      stdout += chunk;
    },
    writeStderr: (chunk) => {
      stderr += chunk;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /resume triggered/i);
  assert.match(stdout, /No session activity for 125s/);
  assert.deepEqual(prompts, [
    {
      terminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
      prompt:
        "继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。",
    },
  ]);
  assert.equal(savedState?.bindings[0].resumeCount, 1);
  assert.equal(
    savedState?.bindings[0].lastResumeAt,
    "2026-04-06T01:02:10.000Z",
  );
});

test("watch keeps polling until the protected process exits", async () => {
  let stdout = "";
  let stderr = "";
  let sleepCalls = 0;
  const savedStates: Array<
    Awaited<ReturnType<Parameters<typeof runCli>[1]["loadState"]>>
  > = [];
  const aliveResults = [true, false];

  const exitCode = await runCli(["watch", "58256"], {
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
          ghosttyTerminalName: "monitor",
          prompt:
            "继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。",
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
    saveState: async (state) => {
      savedStates.push(state);
    },
    readTextFile: async (filePath) => {
      if (filePath === logFile) {
        return "";
      }

      return [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
        '{"timestamp":"2026-04-06T01:00:10.000Z","type":"event_msg","payload":{"type":"task_complete"}}',
      ].join("\n");
    },
    processAlive: async () => aliveResults.shift() ?? false,
    now: () => Date.parse("2026-04-06T01:00:20.000Z"),
    sleep: async () => {
      sleepCalls += 1;
    },
    injectPromptIntoTerminal: async () => {
      throw new Error("recovery should not trigger");
    },
    writeStdout: (chunk) => {
      stdout += chunk;
    },
    writeStderr: (chunk) => {
      stderr += chunk;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /Watching pid 58256 every 5s/);
  assert.match(stdout, /healthy: No recovery action needed/);
  assert.match(stdout, /stopped: Process is not running/);
  assert.equal(savedStates.length, 2);
  assert.equal(savedStates[0].bindings[0].resumeCount, 0);
  assert.equal(savedStates[1].bindings[0].resumeCount, 0);
  assert.equal(sleepCalls, 1);
});

test("watch keeps polling after restarting a dead unfinished process and rebinds to the replacement pid", async () => {
  let stdout = "";
  let stderr = "";
  let sleepCalls = 0;
  const prompts: Array<{ terminalId: string; prompt: string }> = [];
  const savedStates: Array<
    Awaited<ReturnType<Parameters<typeof runCli>[1]["loadState"]>>
  > = [];
  const sessionId = "019d6057-5b00-70f0-bed7-96d71b8757fd";
  const sessionFile =
    "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl";
  const nowValues = [
    Date.parse("2026-04-06T01:00:20.000Z"),
    Date.parse("2026-04-06T01:00:25.000Z"),
    Date.parse("2026-04-06T01:00:30.000Z"),
  ];

  const exitCode = await runCli(["watch", "58256"], {
    listCodexProcesses: async () =>
      sleepCalls === 0
        ? []
        : [
            {
              pid: 60000,
              ppid: 23000,
              tty: "ttys002",
              status: "S+",
              command: `codex -a never -s danger-full-access resume ${sessionId}`,
              cwd: "/Users/lotiger/xiaoe/ai/monitor",
              ttyDevice: "/dev/ttys002",
              sessionFile,
              sessionId,
              protected: false,
            },
          ],
    listGhosttyTerminals: async () => [],
    loadState: async () => ({
      version: 1,
      bindings: [
        {
          pid: 58256,
          tty: "ttys002",
          cwd: "/Users/lotiger/xiaoe/ai/monitor",
          sessionId,
          sessionFile,
          ghosttyTerminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
          ghosttyTerminalName: "monitor",
          prompt:
            "继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。",
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
    saveState: async (state) => {
      savedStates.push(state);
    },
    readTextFile: async (filePath) => {
      if (filePath === logFile) {
        return "";
      }

      if (sleepCalls === 0) {
        return [
          '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"task_started"}}',
          '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
        ].join("\n");
      }

      return [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
        '{"timestamp":"2026-04-06T01:00:15.000Z","type":"event_msg","payload":{"type":"task_complete"}}',
      ].join("\n");
    },
    processAlive: async (pid) => {
      if (pid === 58256) {
        return false;
      }

      if (pid === 60000) {
        return sleepCalls === 1;
      }

      return false;
    },
    now: () => nowValues.shift() ?? Date.parse("2026-04-06T01:00:30.000Z"),
    sleep: async () => {
      sleepCalls += 1;
    },
    injectPromptIntoTerminal: async (terminalId, prompt) => {
      prompts.push({ terminalId, prompt });
    },
    writeStdout: (chunk) => {
      stdout += chunk;
    },
    writeStderr: (chunk) => {
      stderr += chunk;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /Watching pid 58256 every 5s/);
  assert.match(stdout, /Process exited while work was pending/);
  assert.match(stdout, /healthy: No recovery action needed/);
  assert.equal(prompts.length, 1);
  assert.equal(savedStates.length, 3);
  assert.equal(savedStates[0].bindings[0].resumeCount, 1);
  assert.equal(savedStates[0].bindings[0].lastResumeAt, "2026-04-06T01:00:20.000Z");
  assert.equal(savedStates[1].bindings.length, 1);
  assert.equal(savedStates[1].bindings[0].pid, 60000);
  assert.equal(savedStates[1].bindings[0].resumeCount, 1);
  assert.equal(savedStates[2].bindings[0].pid, 60000);
  assert.equal(sleepCalls, 2);
});
