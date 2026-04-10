import assert from "node:assert/strict";
import test from "node:test";

import { evaluateResumeDecision } from "../src/detector";

const baseBinding = {
  pid: 58256,
  tty: "ttys002",
  cwd: "/Users/lotiger/xiaoe/ai/monitor",
  sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
  sessionFile:
    "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
  ghosttyTerminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
  ghosttyTerminalName: "⠹ monitor",
  prompt: "continue",
  idleTimeoutSeconds: 120,
  cooldownSeconds: 180,
  maxAutoResume: 3,
  resumeCount: 0,
  lastActivityAt: "2026-04-06T01:00:00.000Z",
  lastResumeAt: "",
  sessionOffset: 0,
  logOffset: 0,
};

test("evaluateResumeDecision requests resume immediately on recoverable error", () => {
  const result = evaluateResumeDecision({
    binding: baseBinding,
    hasPendingWork: true,
    matchedError: "Function call output is missing",
    errorRequiresIdle: false,
    now: Date.parse("2026-04-06T01:00:10.000Z"),
  });

  assert.deepEqual(result, {
    action: "resume",
    reason: "error",
    detail: "Function call output is missing",
  });
});

test("evaluateResumeDecision requests resume after idle timeout while work is pending", () => {
  const result = evaluateResumeDecision({
    binding: baseBinding,
    hasPendingWork: true,
    matchedError: "",
    errorRequiresIdle: false,
    now: Date.parse("2026-04-06T01:02:01.000Z"),
  });

  assert.deepEqual(result, {
    action: "resume",
    reason: "idle",
    detail: "No session activity for 121s",
  });
});

test("evaluateResumeDecision suppresses resume while still in cooldown", () => {
  const result = evaluateResumeDecision({
    binding: {
      ...baseBinding,
      lastResumeAt: "2026-04-06T01:00:30.000Z",
    },
    hasPendingWork: true,
    matchedError: "stream interrupted",
    errorRequiresIdle: false,
    now: Date.parse("2026-04-06T01:01:00.000Z"),
  });

  assert.deepEqual(result, {
    action: "suppress",
    reason: "cooldown",
    detail: "Recovery cooldown active",
  });
});

test("evaluateResumeDecision no longer suppresses resume after max retries", () => {
  const result = evaluateResumeDecision({
    binding: {
      ...baseBinding,
      resumeCount: 3,
    },
    hasPendingWork: true,
    matchedError: "stream interrupted",
    errorRequiresIdle: false,
    now: Date.parse("2026-04-06T01:03:00.000Z"),
  });

  assert.deepEqual(result, {
    action: "resume",
    reason: "error",
    detail: "stream interrupted",
  });
});

test("evaluateResumeDecision defers noisy recoverable errors until idle timeout", () => {
  const result = evaluateResumeDecision({
    binding: {
      ...baseBinding,
      lastActivityAt: "2026-04-06T01:00:35.000Z",
    },
    hasPendingWork: true,
    matchedError: "Function call output is missing",
    errorRequiresIdle: true,
    now: Date.parse("2026-04-06T01:01:05.000Z"),
  });

  assert.deepEqual(result, {
    action: "noop",
    reason: "healthy",
    detail: "No recovery action needed",
  });
});

test("evaluateResumeDecision resumes when noisy recoverable errors persist past idle timeout", () => {
  const result = evaluateResumeDecision({
    binding: {
      ...baseBinding,
      lastActivityAt: "2026-04-06T01:00:00.000Z",
    },
    hasPendingWork: true,
    matchedError: "Function call output is missing",
    errorRequiresIdle: true,
    now: Date.parse("2026-04-06T01:02:01.000Z"),
  });

  assert.deepEqual(result, {
    action: "resume",
    reason: "error",
    detail: "Function call output is missing",
  });
});
