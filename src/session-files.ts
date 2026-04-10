export interface SessionMeta {
  sessionId: string;
  cwd: string;
}

export interface SessionRecord {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    message?: string;
    [key: string]: unknown;
  };
}

const RECOVERABLE_SESSION_ERROR_PATTERNS = [
  /stream disconnected before completion/i,
  /stream closed before response\.completed/i,
  /stream interrupted/i,
  /timed? out/i,
  /connection .*?(closed|reset|lost|failed)/i,
];

const AUTO_CONFIRM_PATTERNS = [
  /ready to execute\??/i,
  /(?:should|shall|do you want me to|would you like me to|want me to).{0,40}(?:implement|execute|proceed|apply|make (?:the|these) changes)/i,
  /(?:是否|要我|让我|请确认).{0,20}(?:实施|执行|继续|应用|修改|改动|变更)/i,
];

export function parseSessionMetaLine(line: string): SessionMeta {
  const parsed = JSON.parse(line) as {
    type?: string;
    payload?: {
      id?: string;
      cwd?: string;
    };
  };

  if (parsed.type !== "session_meta" || !parsed.payload?.id) {
    throw new Error("Session meta line is missing payload.id");
  }

  return {
    sessionId: parsed.payload.id,
    cwd: parsed.payload.cwd ?? "",
  };
}

export function parseSessionRecords(content: string): SessionRecord[] {
  const records: SessionRecord[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    try {
      records.push(JSON.parse(line) as SessionRecord);
    } catch {
      // Active JSONL files can end with a partially written line.
      continue;
    }
  }

  return records;
}

function isActivityRecord(record: SessionRecord): boolean {
  const payloadType = record.payload?.type ?? "";

  if (record.type === "event_msg") {
    return [
      "user_message",
      "agent_message",
      "agent_reasoning",
      "task_started",
      "task_complete",
      "token_count",
    ].includes(payloadType);
  }

  if (record.type === "response_item") {
    return [
      "message",
      "reasoning",
      "function_call",
      "function_call_output",
    ].includes(payloadType);
  }

  return false;
}

function isProgressRecord(record: SessionRecord): boolean {
  const payloadType = record.payload?.type ?? "";

  if (record.type === "event_msg") {
    return [
      "user_message",
      "agent_message",
      "agent_reasoning",
      "task_started",
    ].includes(payloadType);
  }

  if (record.type === "response_item") {
    return [
      "message",
      "reasoning",
      "function_call",
      "function_call_output",
    ].includes(payloadType);
  }

  return false;
}

function findRecoverableSessionError(record: SessionRecord): string {
  if (record.type !== "event_msg" || record.payload?.type !== "error") {
    return "";
  }

  const message =
    typeof record.payload.message === "string" ? record.payload.message.trim() : "";

  if (!message) {
    return "";
  }

  for (const pattern of RECOVERABLE_SESSION_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return message;
    }
  }

  return "";
}

function findAutoConfirmPrompt(record: SessionRecord): string {
  if (record.type !== "event_msg" || record.payload?.type !== "agent_message") {
    return "";
  }

  const message =
    typeof record.payload.message === "string" ? record.payload.message.trim() : "";

  if (!message) {
    return "";
  }

  for (const pattern of AUTO_CONFIRM_PATTERNS) {
    if (pattern.test(message)) {
      return message;
    }
  }

  return "";
}

export function summarizeSessionRecords(records: SessionRecord[]): {
  hasPendingWork: boolean;
  lastActivityAt: string;
  lastProgressAt: string;
  lastUserMessageAt: string;
  lastAgentMessageAt: string;
  lastRecoverableError: string;
  lastRecoverableErrorAt: string;
  lastAutoConfirmPrompt: string;
  lastAutoConfirmPromptAt: string;
} {
  let hasPendingWork = false;
  let lastActivityAt = "";
  let lastProgressAt = "";
  let lastUserMessageAt = "";
  let lastAgentMessageAt = "";
  let lastRecoverableError = "";
  let lastRecoverableErrorAt = "";
  let lastAutoConfirmPrompt = "";
  let lastAutoConfirmPromptAt = "";

  for (const record of records) {
    const payloadType = record.payload?.type ?? "";

    if (payloadType === "user_message" || payloadType === "task_started") {
      hasPendingWork = true;
    }

    if (payloadType === "task_complete") {
      hasPendingWork = false;
    }

    if (isActivityRecord(record) && record.timestamp) {
      lastActivityAt = record.timestamp;
    }

    if (isProgressRecord(record) && record.timestamp) {
      lastProgressAt = record.timestamp;
    }

    if (payloadType === "user_message" && record.timestamp) {
      lastUserMessageAt = record.timestamp;
    }

    if (payloadType === "agent_message" && record.timestamp) {
      lastAgentMessageAt = record.timestamp;
    }

    const recoverableError = findRecoverableSessionError(record);

    if (recoverableError) {
      lastRecoverableError = recoverableError;
      lastRecoverableErrorAt = record.timestamp ?? lastRecoverableErrorAt;
    }

    const autoConfirmPrompt = findAutoConfirmPrompt(record);

    if (autoConfirmPrompt) {
      lastAutoConfirmPrompt = autoConfirmPrompt;
      lastAutoConfirmPromptAt = record.timestamp ?? lastAutoConfirmPromptAt;
    }
  }

  return {
    hasPendingWork,
    lastActivityAt,
    lastProgressAt,
    lastUserMessageAt,
    lastAgentMessageAt,
    lastRecoverableError,
    lastRecoverableErrorAt,
    lastAutoConfirmPrompt,
    lastAutoConfirmPromptAt,
  };
}
