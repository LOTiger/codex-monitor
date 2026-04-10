import { Binding } from "./types";

export interface ResumeDecisionInput {
  binding: Binding;
  hasPendingWork: boolean;
  matchedError: string;
  errorRequiresIdle?: boolean;
  now: number;
}

export interface ResumeDecision {
  action: "resume" | "suppress" | "noop";
  reason:
    | "error"
    | "exit"
    | "idle"
    | "confirm"
    | "cooldown"
    | "max-auto-resume"
    | "healthy";
  detail: string;
}

export function evaluateResumeDecision(
  input: ResumeDecisionInput,
): ResumeDecision {
  const { binding, hasPendingWork, matchedError, now } = input;
  const hasRecoverableError = Boolean(matchedError);
  const errorRequiresIdle = Boolean(input.errorRequiresIdle);
  const lastActivityAt = Date.parse(binding.lastActivityAt);
  const idleSeconds = Number.isNaN(lastActivityAt)
    ? 0
    : Math.floor((now - lastActivityAt) / 1000);
  const idleTriggered = hasPendingWork && idleSeconds > binding.idleTimeoutSeconds;
  const errorTriggered =
    hasRecoverableError && (!errorRequiresIdle || idleTriggered);

  if (!errorTriggered && !(idleTriggered && !hasRecoverableError)) {
    return {
      action: "noop",
      reason: "healthy",
      detail: "No recovery action needed",
    };
  }

  if (binding.lastResumeAt) {
    const lastResumeAt = Date.parse(binding.lastResumeAt);
    const cooldownSeconds = Number.isNaN(lastResumeAt)
      ? Number.POSITIVE_INFINITY
      : Math.floor((now - lastResumeAt) / 1000);

    if (cooldownSeconds < binding.cooldownSeconds) {
      return {
        action: "suppress",
        reason: "cooldown",
        detail: "Recovery cooldown active",
      };
    }
  }

  if (errorTriggered) {
    return {
      action: "resume",
      reason: "error",
      detail: matchedError,
    };
  }

  return {
    action: "resume",
    reason: "idle",
    detail: `No session activity for ${idleSeconds}s`,
  };
}
