import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSessionRecords,
  summarizeSessionRecords,
} from "../src/session-files";

test("parseSessionRecords parses JSONL records and ignores blank lines", () => {
  const records = parseSessionRecords(
    [
      '{"timestamp":"2026-04-06T01:00:00.000Z","type":"session_meta","payload":{"id":"session-a","cwd":"/tmp"}}',
      "",
      '{"timestamp":"2026-04-06T01:00:10.000Z","type":"event_msg","payload":{"type":"task_started"}}',
    ].join("\n"),
  );

  assert.equal(records.length, 2);
  assert.equal(records[0].type, "session_meta");
  assert.equal(records[1].payload?.type, "task_started");
});

test("parseSessionRecords ignores a truncated trailing line", () => {
  const records = parseSessionRecords(
    [
      '{"timestamp":"2026-04-06T01:00:00.000Z","type":"session_meta","payload":{"id":"session-a","cwd":"/tmp"}}',
      '{"timestamp":"2026-04-06T01:00:10.000Z","type":"event_msg","payload":{"type":"task_started"',
    ].join("\n"),
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].type, "session_meta");
});

test("summarizeSessionRecords tracks last activity and pending work", () => {
  const records = parseSessionRecords(
    [
      '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"hi"}}',
      '{"timestamp":"2026-04-06T01:00:01.000Z","type":"event_msg","payload":{"type":"task_started"}}',
      '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
    ].join("\n"),
  );

  assert.deepEqual(summarizeSessionRecords(records), {
    hasPendingWork: true,
    lastActivityAt: "2026-04-06T01:00:05.000Z",
    lastProgressAt: "2026-04-06T01:00:05.000Z",
    lastUserMessageAt: "2026-04-06T01:00:00.000Z",
    lastAgentMessageAt: "",
    lastRecoverableError: "",
    lastRecoverableErrorAt: "",
    lastAutoConfirmPrompt: "",
    lastAutoConfirmPromptAt: "",
  });
});

test("summarizeSessionRecords clears pending work on task_complete", () => {
  const records = parseSessionRecords(
    [
      '{"timestamp":"2026-04-06T01:00:01.000Z","type":"event_msg","payload":{"type":"task_started"}}',
      '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
      '{"timestamp":"2026-04-06T01:00:10.000Z","type":"event_msg","payload":{"type":"task_complete"}}',
    ].join("\n"),
  );

  assert.deepEqual(summarizeSessionRecords(records), {
    hasPendingWork: false,
    lastActivityAt: "2026-04-06T01:00:10.000Z",
    lastProgressAt: "2026-04-06T01:00:05.000Z",
    lastUserMessageAt: "",
    lastAgentMessageAt: "",
    lastRecoverableError: "",
    lastRecoverableErrorAt: "",
    lastAutoConfirmPrompt: "",
    lastAutoConfirmPromptAt: "",
  });
});

test("summarizeSessionRecords keeps a recoverable error even after task_complete", () => {
  const records = parseSessionRecords(
    [
      '{"timestamp":"2026-04-06T01:00:01.000Z","type":"event_msg","payload":{"type":"task_started"}}',
      '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"function_call"}}',
      '{"timestamp":"2026-04-06T01:00:06.000Z","type":"event_msg","payload":{"type":"error","message":"stream disconnected before completion: stream closed before response.completed"}}',
      '{"timestamp":"2026-04-06T01:00:07.000Z","type":"event_msg","payload":{"type":"task_complete"}}',
    ].join("\n"),
  );

  assert.deepEqual(summarizeSessionRecords(records), {
    hasPendingWork: false,
    lastActivityAt: "2026-04-06T01:00:07.000Z",
    lastProgressAt: "2026-04-06T01:00:05.000Z",
    lastUserMessageAt: "",
    lastAgentMessageAt: "",
    lastRecoverableError:
      "stream disconnected before completion: stream closed before response.completed",
    lastRecoverableErrorAt: "2026-04-06T01:00:06.000Z",
    lastAutoConfirmPrompt: "",
    lastAutoConfirmPromptAt: "",
  });
});

test("summarizeSessionRecords keeps the latest auto-confirm prompt from assistant output", () => {
  const records = parseSessionRecords(
    [
      '{"timestamp":"2026-04-07T03:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"继续"}}',
      '{"timestamp":"2026-04-07T03:00:12.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Plan complete and saved to docs/superpowers/plans/2026-04-07-auto-confirm-and-background-watch.md. Ready to execute?"}}',
      '{"timestamp":"2026-04-07T03:00:12.050Z","type":"event_msg","payload":{"type":"task_complete"}}',
    ].join("\n"),
  );

  assert.deepEqual(summarizeSessionRecords(records), {
    hasPendingWork: false,
    lastActivityAt: "2026-04-07T03:00:12.050Z",
    lastProgressAt: "2026-04-07T03:00:12.000Z",
    lastUserMessageAt: "2026-04-07T03:00:00.000Z",
    lastAgentMessageAt: "2026-04-07T03:00:12.000Z",
    lastRecoverableError: "",
    lastRecoverableErrorAt: "",
    lastAutoConfirmPrompt:
      "Plan complete and saved to docs/superpowers/plans/2026-04-07-auto-confirm-and-background-watch.md. Ready to execute?",
    lastAutoConfirmPromptAt: "2026-04-07T03:00:12.000Z",
  });
});
