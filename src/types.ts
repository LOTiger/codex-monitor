export type CommandName =
  | "help"
  | "list"
  | "bind"
  | "watch"
  | "trigger"
  | "unbind"
  | "daemon";

export interface Binding {
  pid: number;
  tty: string;
  cwd: string;
  sessionId: string;
  sessionFile: string;
  ghosttyTerminalId: string;
  ghosttyTerminalName: string;
  prompt: string;
  autoConfirmEnabled: boolean;
  autoConfirmPrompt: string;
  idleTimeoutSeconds: number;
  cooldownSeconds: number;
  maxAutoResume: number;
  resumeCount: number;
  confirmCount: number;
  lastActivityAt: string;
  lastResumeAt: string;
  lastConfirmAt: string;
  sessionOffset: number;
  logOffset: number;
}

export interface GuardState {
  version: number;
  bindings: Binding[];
}
