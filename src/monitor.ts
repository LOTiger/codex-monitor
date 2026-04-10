import { evaluateResumeDecision } from "./detector";
import { parseSessionRecords, summarizeSessionRecords } from "./session-files";
import { Binding } from "./types";

const DEFAULT_CONFIRM_PROMPT = "y";
const DEFAULT_RESTART_COMMAND = "codex -a never -s danger-full-access";

const RECOVERABLE_PATTERNS = [
  {
    pattern: /Function call output is missing/i,
    requiresIdle: true,
  },
  {
    pattern: /Custom tool call output is missing/i,
    requiresIdle: true,
  },
  {
    pattern: /stream interrupted/i,
    requiresIdle: false,
  },
  {
    pattern: /stream disconnected before completion/i,
    requiresIdle: false,
  },
  {
    pattern: /stream closed before response\.completed/i,
    requiresIdle: false,
  },
  {
    pattern: /timed? out/i,
    requiresIdle: false,
  },
  {
    pattern: /connection .*?(closed|reset|lost|failed)/i,
    requiresIdle: false,
  },
];

interface RecoverableErrorMatch {
  text: string;
  timestamp: string;
  requiresIdle: boolean;
}

function extractLogTimestamp(line: string): string {
  return line.match(/^(\S+)/)?.[1] ?? "";
}

function findRecoverableError(
  logText: string,
  sessionId: string,
): RecoverableErrorMatch | null {
  let latestMatch: RecoverableErrorMatch | null = null;

  for (const line of logText.split("\n")) {
    if (!line.includes(sessionId)) {
      continue;
    }

    for (const entry of RECOVERABLE_PATTERNS) {
      const match = line.match(entry.pattern);

      if (match) {
        latestMatch = {
          text: match[0],
          timestamp: extractLogTimestamp(line),
          requiresIdle: entry.requiresIdle,
        };
        break;
      }
    }
  }

  return latestMatch;
}

function isSupersededBySessionActivity(
  recoverableError: RecoverableErrorMatch | null,
  lastProgressAt: string,
): boolean {
  if (!recoverableError?.timestamp || !lastProgressAt) {
    return false;
  }

  const errorAt = Date.parse(recoverableError.timestamp);
  const activityAt = Date.parse(lastProgressAt);

  if (Number.isNaN(errorAt) || Number.isNaN(activityAt)) {
    return false;
  }

  return activityAt > errorAt;
}

function latestRecoverableError(
  ...candidates: Array<RecoverableErrorMatch | null>
): RecoverableErrorMatch | null {
  let latest: RecoverableErrorMatch | null = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (!latest) {
      latest = candidate;
      continue;
    }

    const latestAt = Date.parse(latest.timestamp);
    const candidateAt = Date.parse(candidate.timestamp);

    if (Number.isNaN(latestAt) && !Number.isNaN(candidateAt)) {
      latest = candidate;
      continue;
    }

    if (!Number.isNaN(candidateAt) && candidateAt >= latestAt) {
      latest = candidate;
    }
  }

  return latest;
}

function normalizeBinding(binding: Binding): Binding {
  return {
    ...binding,
    autoConfirmEnabled: binding.autoConfirmEnabled ?? true,
    autoConfirmPrompt: binding.autoConfirmPrompt || DEFAULT_CONFIRM_PROMPT,
    confirmCount: binding.confirmCount ?? 0,
    lastConfirmAt: binding.lastConfirmAt || "",
  };
}

function timestampAtOrAfter(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }

  const leftAt = Date.parse(left);
  const rightAt = Date.parse(right);

  if (Number.isNaN(leftAt) || Number.isNaN(rightAt)) {
    return false;
  }

  return leftAt >= rightAt;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildRestartCommand(binding: Binding): string {
  return [
    DEFAULT_RESTART_COMMAND,
    "-C",
    shellQuote(binding.cwd),
    "resume",
    shellQuote(binding.sessionId),
    shellQuote(binding.prompt),
  ].join(" ");
}

function isCooldownActive(binding: Binding, now: number): boolean {
  if (!binding.lastResumeAt) {
    return false;
  }

  const lastResumeAt = Date.parse(binding.lastResumeAt);
  const cooldownSeconds = Number.isNaN(lastResumeAt)
    ? Number.POSITIVE_INFINITY
    : Math.floor((now - lastResumeAt) / 1000);

  return cooldownSeconds < binding.cooldownSeconds;
}

function shouldAutoConfirm(
  binding: Binding,
  summary: ReturnType<typeof summarizeSessionRecords>,
): boolean {
  if (!binding.autoConfirmEnabled) {
    return false;
  }

  if (!summary.lastAutoConfirmPrompt || !summary.lastAutoConfirmPromptAt) {
    return false;
  }

  if (
    summary.lastAgentMessageAt &&
    summary.lastAgentMessageAt !== summary.lastAutoConfirmPromptAt
  ) {
    return false;
  }

  if (timestampAtOrAfter(summary.lastUserMessageAt, summary.lastAutoConfirmPromptAt)) {
    return false;
  }

  if (timestampAtOrAfter(binding.lastConfirmAt, summary.lastAutoConfirmPromptAt)) {
    return false;
  }

  return true;
}

export interface WatchBindingDeps {
  sessionText(): Promise<string>;
  logText(): Promise<string>;
  processAlive(): Promise<boolean>;
  injectPromptIntoTerminal(terminalId: string, prompt: string): Promise<void>;
  now(): number;
}

export function matchRecoverableError(
  logText: string,
  sessionId: string,
): string {
  return findRecoverableError(logText, sessionId)?.text ?? "";
}

export async function watchBindingOnce(
  binding: Binding,
  deps: WatchBindingDeps,
): Promise<{
  binding: Binding;
  decision: ReturnType<typeof evaluateResumeDecision>;
  processAlive: boolean;
}> {
  const [alive, sessionText, logText] = await Promise.all([
    deps.processAlive(),
    deps.sessionText(),
    deps.logText(),
  ]);
  const tickNow = deps.now();

  const records = parseSessionRecords(sessionText);
  const summary = summarizeSessionRecords(records);
  const effectiveBinding = {
    ...normalizeBinding(binding),
    lastActivityAt: summary.lastActivityAt || binding.lastActivityAt,
  };

  if (alive && shouldAutoConfirm(effectiveBinding, summary)) {
    await deps.injectPromptIntoTerminal(
      effectiveBinding.ghosttyTerminalId,
      effectiveBinding.autoConfirmPrompt,
    );

    return {
      binding: {
        ...effectiveBinding,
        confirmCount: effectiveBinding.confirmCount + 1,
        lastConfirmAt: new Date(tickNow).toISOString(),
      },
      decision: {
        action: "resume" as const,
        reason: "confirm" as const,
        detail: summary.lastAutoConfirmPrompt,
      },
      processAlive: alive,
    };
  }

  const recoverableError = latestRecoverableError(
    findRecoverableError(logText, binding.sessionId),
    summary.lastRecoverableError
      ? {
          text: summary.lastRecoverableError,
          timestamp: summary.lastRecoverableErrorAt,
          requiresIdle: false,
        }
      : null,
  );
  const matchedError = isSupersededBySessionActivity(
    recoverableError,
    summary.lastProgressAt,
  )
    ? ""
    : recoverableError?.text ?? "";

  if (!alive) {
    const shouldRestart = summary.hasPendingWork || Boolean(matchedError);

    if (!shouldRestart) {
      return {
        binding: effectiveBinding,
        decision: {
          action: "noop" as const,
          reason: "healthy" as const,
          detail: "Process is not running",
        },
        processAlive: alive,
      };
    }

    if (isCooldownActive(effectiveBinding, tickNow)) {
      return {
        binding: effectiveBinding,
        decision: {
          action: "suppress" as const,
          reason: "cooldown" as const,
          detail: "Recovery cooldown active",
        },
        processAlive: alive,
      };
    }

    await deps.injectPromptIntoTerminal(
      effectiveBinding.ghosttyTerminalId,
      buildRestartCommand(effectiveBinding),
    );

    return {
      binding: {
        ...effectiveBinding,
        resumeCount: effectiveBinding.resumeCount + 1,
        lastResumeAt: new Date(tickNow).toISOString(),
      },
      decision: {
        action: "resume" as const,
        reason: "exit" as const,
        detail: matchedError || "Process exited while work was pending",
      },
      processAlive: alive,
    };
  }

  const decision = alive
    ? evaluateResumeDecision({
        binding: effectiveBinding,
        hasPendingWork: summary.hasPendingWork,
        matchedError,
        errorRequiresIdle: Boolean(recoverableError?.requiresIdle && matchedError),
        now: tickNow,
      })
    : {
        action: "noop" as const,
        reason: "healthy" as const,
        detail: "Process is not running",
      };

  if (decision.action !== "resume") {
    return {
      binding: effectiveBinding,
      decision,
      processAlive: alive,
    };
  }

  await deps.injectPromptIntoTerminal(
    effectiveBinding.ghosttyTerminalId,
    effectiveBinding.prompt,
  );

  return {
    binding: {
      ...effectiveBinding,
      resumeCount: effectiveBinding.resumeCount + 1,
      lastResumeAt: new Date(tickNow).toISOString(),
    },
    decision,
    processAlive: alive,
  };
}
