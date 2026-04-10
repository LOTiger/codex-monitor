import assert from "node:assert/strict";
import test from "node:test";

import {
  matchRecoverableError,
  watchBindingOnce,
} from "../src/monitor";

const binding = {
  pid: 58256,
  tty: "ttys002",
  cwd: "/Users/lotiger/xiaoe/ai/monitor",
  sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
  sessionFile:
    "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
  ghosttyTerminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
  ghosttyTerminalName: "⠹ monitor",
  prompt: "继续",
  idleTimeoutSeconds: 120,
  cooldownSeconds: 180,
  maxAutoResume: 3,
  resumeCount: 0,
  lastActivityAt: "2026-04-06T01:00:00.000Z",
  lastResumeAt: "",
  sessionOffset: 0,
  logOffset: 0,
};

test("matchRecoverableError filters by session id", () => {
  const error = matchRecoverableError(
    [
      "2026-04-06T01:22:54.500786Z INFO session_loop{thread_id=other}: healthy line",
      "2026-04-06T01:22:54.500804Z INFO session_loop{thread_id=019d6057-5b00-70f0-bed7-96d71b8757fd}: context_manager::normalize: Function call output is missing for call id: call_abc",
    ].join("\n"),
    "019d6057-5b00-70f0-bed7-96d71b8757fd",
  );

  assert.equal(error, "Function call output is missing");
});

test("matchRecoverableError recognizes custom tool missing-output logs", () => {
  const error = matchRecoverableError(
    [
      "2026-04-06T01:22:54.500786Z ERROR session_loop{thread_id=019d6057-5b00-70f0-bed7-96d71b8757fd}: codex_core::util: Custom tool call output is missing for call id: call_abc",
      "2026-04-06T01:22:54.500804Z INFO session_loop{thread_id=other}: stream interrupted",
    ].join("\n"),
    "019d6057-5b00-70f0-bed7-96d71b8757fd",
  );

  assert.equal(error, "Custom tool call output is missing");
});

test("matchRecoverableError ignores unrelated ERROR log lines", () => {
  const error = matchRecoverableError(
    [
      "2026-04-06T01:22:54.500786Z ERROR session_loop{thread_id=019d6057-5b00-70f0-bed7-96d71b8757fd}: codex_core::util: unrelated failure",
      "2026-04-06T01:22:54.500804Z INFO session_loop{thread_id=other}: stream interrupted",
    ].join("\n"),
    "019d6057-5b00-70f0-bed7-96d71b8757fd",
  );

  assert.equal(error, "");
});

test("watchBindingOnce injects a prompt when an idle pending task needs recovery", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(binding, {
    logText: async () => "",
    now: () => Date.parse("2026-04-06T01:02:10.000Z"),
    processAlive: async () => true,
    sessionText: async () =>
      [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"hi"}}',
        '{"timestamp":"2026-04-06T01:00:01.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
      ].join("\n"),
    injectPromptIntoTerminal: async (terminalId, prompt) => {
      prompts.push({ terminalId, prompt });
    },
  });

  assert.equal(result.decision.action, "resume");
  assert.equal(result.binding.resumeCount, 1);
  assert.equal(result.binding.lastResumeAt, "2026-04-06T01:02:10.000Z");
  assert.equal(result.binding.lastActivityAt, "2026-04-06T01:00:05.000Z");
  assert.deepEqual(prompts, [
    {
      terminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
      prompt: "继续",
    },
  ]);
});

test("watchBindingOnce does not inject a prompt when session activity continues after an error log", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(binding, {
    logText: async () =>
      "2026-04-06T01:00:29.000Z ERROR session_loop{thread_id=019d6057-5b00-70f0-bed7-96d71b8757fd}: codex_core::context_manager::normalize: Function call output is missing for call id: call_abc",
    now: () => Date.parse("2026-04-06T01:00:50.000Z"),
    processAlive: async () => true,
    sessionText: async () =>
      [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"hi"}}',
        '{"timestamp":"2026-04-06T01:00:01.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:35.000Z","type":"response_item","payload":{"type":"message"}}',
      ].join("\n"),
    injectPromptIntoTerminal: async (terminalId, prompt) => {
      prompts.push({ terminalId, prompt });
    },
  });

  assert.equal(result.decision.action, "noop");
  assert.equal(result.decision.reason, "healthy");
  assert.equal(result.binding.resumeCount, 0);
  assert.equal(result.binding.lastResumeAt, "");
  assert.equal(result.binding.lastActivityAt, "2026-04-06T01:00:35.000Z");
  assert.deepEqual(prompts, []);
});

test("watchBindingOnce injects a prompt when session ends with a recoverable error event", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(
    {
      ...binding,
      pid: 33127,
      tty: "ttys001",
      cwd: "/Users/lotiger/xiaoe/ai/content",
      sessionId: "019d53bd-98b9-7ac2-8eb6-be8642f71228",
      sessionFile:
        "/Users/lotiger/.codex/sessions/2026/04/03/rollout-2026-04-03T22-27-07-019d53bd-98b9-7ac2-8eb6-be8642f71228.jsonl",
      ghosttyTerminalId: "BF1F951F-A18F-4CBE-BF31-240F93AAD438",
      ghosttyTerminalName: "content",
      lastActivityAt: "2026-04-06T13:21:38.433Z",
      lastResumeAt: "2026-04-06T12:56:27.566Z",
      resumeCount: 13,
    },
    {
      logText: async () => "",
      now: () => Date.parse("2026-04-06T13:48:31.465Z"),
      processAlive: async () => true,
      sessionText: async () =>
        [
          '{"timestamp":"2026-04-06T13:23:39.102Z","type":"response_item","payload":{"type":"function_call"}}',
          '{"timestamp":"2026-04-06T13:23:39.103Z","type":"event_msg","payload":{"type":"error","message":"stream disconnected before completion: stream closed before response.completed","codex_error_info":"other"}}',
          '{"timestamp":"2026-04-06T13:23:39.104Z","type":"event_msg","payload":{"type":"task_complete"}}',
        ].join("\n"),
      injectPromptIntoTerminal: async (terminalId, prompt) => {
        prompts.push({ terminalId, prompt });
      },
    },
  );

  assert.equal(result.decision.action, "resume");
  assert.equal(result.decision.reason, "error");
  assert.equal(
    result.decision.detail,
    "stream disconnected before completion: stream closed before response.completed",
  );
  assert.equal(result.binding.resumeCount, 14);
  assert.equal(result.binding.lastResumeAt, "2026-04-06T13:48:31.465Z");
  assert.equal(result.binding.lastActivityAt, "2026-04-06T13:23:39.104Z");
  assert.deepEqual(prompts, [
    {
      terminalId: "BF1F951F-A18F-4CBE-BF31-240F93AAD438",
      prompt: "继续",
    },
  ]);
});

test("watchBindingOnce ignores noisy missing-output logs while the session is still actively progressing", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(
    {
      ...binding,
      pid: 33127,
      tty: "ttys001",
      cwd: "/Users/lotiger/xiaoe/ai/content",
      sessionId: "019d53bd-98b9-7ac2-8eb6-be8642f71228",
      sessionFile:
        "/Users/lotiger/.codex/sessions/2026/04/03/rollout-2026-04-03T22-27-07-019d53bd-98b9-7ac2-8eb6-be8642f71228.jsonl",
      ghosttyTerminalId: "BF1F951F-A18F-4CBE-BF31-240F93AAD438",
      ghosttyTerminalName: "content",
      lastActivityAt: "2026-04-07T02:22:35.447Z",
    },
    {
      logText: async () =>
        "2026-04-07T02:22:38.162071Z INFO session_loop{thread_id=019d53bd-98b9-7ac2-8eb6-be8642f71228}: codex_core::context_manager::normalize: Function call output is missing for call id: call_QUON29IYAdX4M0BkgOrmiRY7",
      now: () => Date.parse("2026-04-07T02:22:38.500Z"),
      processAlive: async () => true,
      sessionText: async () =>
        [
          '{"timestamp":"2026-04-07T02:22:08.969Z","type":"event_msg","payload":{"type":"task_started"}}',
          '{"timestamp":"2026-04-07T02:22:08.974Z","type":"event_msg","payload":{"type":"user_message","message":"做统一账号服务，接入到这套系统里"}}',
          '{"timestamp":"2026-04-07T02:22:35.446Z","type":"event_msg","payload":{"type":"agent_message","message":"我在用 brainstorming 先做下一阶段设计"}}',
          '{"timestamp":"2026-04-07T02:22:35.447Z","type":"response_item","payload":{"type":"message"}}',
          '{"timestamp":"2026-04-07T02:22:35.447Z","type":"response_item","payload":{"type":"function_call"}}',
          '{"timestamp":"2026-04-07T02:22:38.159Z","type":"response_item","payload":{"type":"function_call_output"}}',
        ].join("\n"),
      injectPromptIntoTerminal: async (terminalId, prompt) => {
        prompts.push({ terminalId, prompt });
      },
    },
  );

  assert.equal(result.decision.action, "noop");
  assert.equal(result.decision.reason, "healthy");
  assert.equal(result.binding.resumeCount, 0);
  assert.equal(result.binding.lastResumeAt, "");
  assert.equal(result.binding.lastActivityAt, "2026-04-07T02:22:38.159Z");
  assert.deepEqual(prompts, []);
});

test("watchBindingOnce resumes after custom tool output goes missing and the session stays idle", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(binding, {
    logText: async () =>
      "2026-04-06T01:00:29.000Z ERROR session_loop{thread_id=019d6057-5b00-70f0-bed7-96d71b8757fd}: codex_core::util: Custom tool call output is missing for call id: call_abc",
    now: () => Date.parse("2026-04-06T01:02:50.000Z"),
    processAlive: async () => true,
    sessionText: async () =>
      [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"hi"}}',
        '{"timestamp":"2026-04-06T01:00:01.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"function_call"}}',
      ].join("\n"),
    injectPromptIntoTerminal: async (terminalId, prompt) => {
      prompts.push({ terminalId, prompt });
    },
  });

  assert.equal(result.decision.action, "resume");
  assert.equal(result.decision.reason, "error");
  assert.equal(result.decision.detail, "Custom tool call output is missing");
  assert.equal(result.binding.resumeCount, 1);
  assert.equal(result.binding.lastResumeAt, "2026-04-06T01:02:50.000Z");
  assert.equal(result.binding.lastActivityAt, "2026-04-06T01:00:05.000Z");
  assert.deepEqual(prompts, [
    {
      terminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
      prompt: "继续",
    },
  ]);
});

test("watchBindingOnce auto-confirms the latest implementation prompt with y", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(
    {
      ...binding,
      lastActivityAt: "2026-04-07T03:00:12.000Z",
    },
    {
      logText: async () => "",
      now: () => Date.parse("2026-04-07T03:00:30.000Z"),
      processAlive: async () => true,
      sessionText: async () =>
        [
          '{"timestamp":"2026-04-07T03:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"增加自动确认功能"}}',
          '{"timestamp":"2026-04-07T03:00:12.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Plan complete and saved to docs/superpowers/plans/2026-04-07-auto-confirm-and-background-watch.md. Ready to execute?"}}',
        ].join("\n"),
      injectPromptIntoTerminal: async (terminalId, prompt) => {
        prompts.push({ terminalId, prompt });
      },
    },
  );

  assert.equal(result.decision.action, "resume");
  assert.equal(result.decision.reason, "confirm");
  assert.equal(result.binding.resumeCount, 0);
  assert.equal(result.binding.lastResumeAt, "");
  assert.equal(result.binding.confirmCount, 1);
  assert.equal(result.binding.lastConfirmAt, "2026-04-07T03:00:30.000Z");
  assert.deepEqual(prompts, [
    {
      terminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
      prompt: "y",
    },
  ]);
});

test("watchBindingOnce does not repeat auto-confirm for the same implementation prompt", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(
    {
      ...binding,
      confirmCount: 1,
      lastConfirmAt: "2026-04-07T03:00:30.000Z",
    },
    {
      logText: async () => "",
      now: () => Date.parse("2026-04-07T03:01:00.000Z"),
      processAlive: async () => true,
      sessionText: async () =>
        [
          '{"timestamp":"2026-04-07T03:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"增加自动确认功能"}}',
          '{"timestamp":"2026-04-07T03:00:12.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Plan complete and saved to docs/superpowers/plans/2026-04-07-auto-confirm-and-background-watch.md. Ready to execute?"}}',
        ].join("\n"),
      injectPromptIntoTerminal: async (terminalId, prompt) => {
        prompts.push({ terminalId, prompt });
      },
    },
  );

  assert.equal(result.decision.action, "noop");
  assert.equal(result.decision.reason, "healthy");
  assert.equal(result.binding.confirmCount, 1);
  assert.equal(result.binding.lastConfirmAt, "2026-04-07T03:00:30.000Z");
  assert.deepEqual(prompts, []);
});

test("watchBindingOnce restarts a dead process when the session still has pending work", async () => {
  const prompts: Array<{ terminalId: string; prompt: string }> = [];

  const result = await watchBindingOnce(
    {
      ...binding,
      pid: 33127,
      tty: "ttys001",
      cwd: "/Users/lotiger/xiaoe/ai/content",
      sessionId: "019d53bd-98b9-7ac2-8eb6-be8642f71228",
      sessionFile:
        "/Users/lotiger/.codex/sessions/2026/04/03/rollout-2026-04-03T22-27-07-019d53bd-98b9-7ac2-8eb6-be8642f71228.jsonl",
      ghosttyTerminalId: "BF1F951F-A18F-4CBE-BF31-240F93AAD438",
      ghosttyTerminalName: "content",
      prompt: "继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。",
      lastActivityAt: "2026-04-07T14:54:57.720Z",
      lastResumeAt: "",
      resumeCount: 0,
    },
    {
      logText: async () => "",
      now: () => Date.parse("2026-04-07T14:55:05.000Z"),
      processAlive: async () => false,
      sessionText: async () =>
        [
          '{"timestamp":"2026-04-07T14:54:15.391Z","type":"event_msg","payload":{"type":"task_started"}}',
          '{"timestamp":"2026-04-07T14:54:15.393Z","type":"event_msg","payload":{"type":"user_message","message":"可以"}}',
          '{"timestamp":"2026-04-07T14:54:57.720Z","type":"event_msg","payload":{"type":"agent_message","message":"这次先确认一件事：你要我优先落地的统一账号中心，还是已有外部身份源？"}}',
        ].join("\n"),
      injectPromptIntoTerminal: async (terminalId, prompt) => {
        prompts.push({ terminalId, prompt });
      },
    },
  );

  assert.equal(result.decision.action, "resume");
  assert.equal(result.decision.reason, "exit");
  assert.equal(result.decision.detail, "Process exited while work was pending");
  assert.equal(result.processAlive, false);
  assert.equal(result.binding.resumeCount, 1);
  assert.equal(result.binding.lastResumeAt, "2026-04-07T14:55:05.000Z");
  assert.deepEqual(prompts, [
    {
      terminalId: "BF1F951F-A18F-4CBE-BF31-240F93AAD438",
      prompt:
        "codex -a never -s danger-full-access -C '/Users/lotiger/xiaoe/ai/content' resume '019d53bd-98b9-7ac2-8eb6-be8642f71228' '继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。'",
    },
  ]);
});
