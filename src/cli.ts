#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { getCodexHome, getStateFile } from "./config";
import { execFileText } from "./exec";
import {
  GhosttyTerminal,
  injectPromptIntoTerminal,
  listGhosttyTerminals,
  resolveTerminalCandidate,
} from "./ghostty";
import { watchBindingOnce } from "./monitor";
import { CodexProcess, listCodexProcesses } from "./process-discovery";
import { createEmptyState, loadState, saveState, upsertBinding } from "./state";
import { Binding, GuardState } from "./types";
import { CommandName } from "./types";

const DEFAULT_PROMPT =
  "继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。";
const WATCH_INTERVAL_MS = 5_000;

const HELP_TEXT = `codex-guard

Commands:
  list
  bind <pid> [terminal-id]
  watch <pid> [--once]
  trigger <pid>
  unbind <pid>
  daemon <action>
`;

export interface CliDeps {
  listCodexProcesses(): Promise<CodexProcess[]>;
  listGhosttyTerminals(): Promise<GhosttyTerminal[]>;
  loadState(): Promise<GuardState>;
  saveState(state: GuardState): Promise<void>;
  injectPromptIntoTerminal(terminalId: string, prompt: string): Promise<void>;
  readTextFile(filePath: string): Promise<string>;
  processAlive(pid: number): Promise<boolean>;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
  writeStdout(chunk: string): void;
  writeStderr(chunk: string): void;
}

function createDefaultCliDeps(): CliDeps {
  return {
    listCodexProcesses: () =>
      listCodexProcesses({
        codexHome: getCodexHome(),
        execFile: execFileText,
        readTextFile: (filePath) => fs.readFile(filePath, "utf8"),
      }),
    listGhosttyTerminals: () => listGhosttyTerminals(),
    loadState: () =>
      loadState({
        stateFile: getStateFile(),
      }),
    saveState: (state) =>
      saveState(state, {
        stateFile: getStateFile(),
      }),
    injectPromptIntoTerminal: (terminalId, prompt) =>
      injectPromptIntoTerminal(terminalId, prompt),
    readTextFile: (filePath) => fs.readFile(filePath, "utf8"),
    processAlive: async (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const errno = error as NodeJS.ErrnoException;

        if (errno.code === "ESRCH") {
          return false;
        }

        if (errno.code === "EPERM") {
          return true;
        }

        throw error;
      }
    },
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
    now: () => Date.now(),
    writeStdout: (chunk) => {
      process.stdout.write(chunk);
    },
    writeStderr: (chunk) => {
      process.stderr.write(chunk);
    },
  };
}

function normalizeCommand(raw?: string): CommandName {
  if (!raw || raw === "--help" || raw === "-h" || raw === "help") {
    return "help";
  }

  if (
    raw === "list" ||
    raw === "bind" ||
    raw === "watch" ||
    raw === "trigger" ||
    raw === "unbind" ||
    raw === "daemon"
  ) {
    return raw;
  }

  return "help";
}

function buildBinding(
  process: CodexProcess,
  terminal: GhosttyTerminal,
): Binding {
  return {
    pid: process.pid,
    tty: process.tty,
    cwd: process.cwd,
    sessionId: process.sessionId,
    sessionFile: process.sessionFile,
    ghosttyTerminalId: terminal.id,
    ghosttyTerminalName: terminal.name,
    prompt: DEFAULT_PROMPT,
    autoConfirmEnabled: true,
    autoConfirmPrompt: "y",
    idleTimeoutSeconds: 120,
    cooldownSeconds: 180,
    maxAutoResume: 0,
    resumeCount: 0,
    confirmCount: 0,
    lastActivityAt: "",
    lastResumeAt: "",
    lastConfirmAt: "",
    sessionOffset: 0,
    logOffset: 0,
  };
}

function formatGhosttyCandidate(terminal: GhosttyTerminal): string {
  return `  ${terminal.id}  ${terminal.name}  ${terminal.workingDirectory}\n`;
}

type WatchResult = Awaited<ReturnType<typeof watchBindingOnce>>;

async function readOptionalTextFile(
  deps: CliDeps,
  filePath: string,
): Promise<string> {
  try {
    return await deps.readTextFile(filePath);
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;

    if (errno.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function sliceSinceOffset(content: string, offset: number): string {
  if (offset <= 0) {
    return content;
  }

  if (offset > content.length) {
    return content;
  }

  return content.slice(offset);
}

function refreshBindingFromProcesses(
  binding: Binding,
  processes: CodexProcess[],
): Binding {
  const replacement =
    processes.find((process) => process.pid === binding.pid) ??
    processes.find((process) => process.tty === binding.tty) ??
    (() => {
      if (!binding.sessionId) {
        return undefined;
      }

      const sessionMatches = processes.filter(
        (process) => process.sessionId === binding.sessionId,
      );

      return sessionMatches.length === 1 ? sessionMatches[0] : undefined;
    })();

  if (!replacement) {
    return binding;
  }

  return {
    ...binding,
    pid: replacement.pid,
    tty: replacement.tty || binding.tty,
    cwd: replacement.cwd || binding.cwd,
    sessionId: replacement.sessionId || binding.sessionId,
    sessionFile: replacement.sessionFile || binding.sessionFile,
  };
}

function formatWatchStatus(result: WatchResult): string {
  if (result.decision.action === "resume") {
    if (result.decision.reason === "confirm") {
      return `confirm triggered: ${result.decision.detail}`;
    }

    return `resume triggered: ${result.decision.reason} - ${result.decision.detail}`;
  }

  if (result.decision.action === "suppress") {
    return `suppressed: ${result.decision.reason} - ${result.decision.detail}`;
  }

  if (!result.processAlive) {
    return "stopped: Process is not running";
  }

  return `healthy: ${result.decision.detail}`;
}

async function watchBoundProcessOnce(
  binding: Binding,
  deps: CliDeps,
): Promise<WatchResult> {
  const logFile = path.join(getCodexHome(), "log", "codex-tui.log");
  let sessionContent = "";
  let logContent = "";

  const result = await watchBindingOnce(binding, {
    sessionText: async () => {
      sessionContent = await readOptionalTextFile(deps, binding.sessionFile);
      return sessionContent;
    },
    logText: async () => {
      logContent = await readOptionalTextFile(deps, logFile);
      return sliceSinceOffset(logContent, binding.logOffset);
    },
    processAlive: () => deps.processAlive(binding.pid),
    injectPromptIntoTerminal: deps.injectPromptIntoTerminal,
    now: deps.now,
  });

  return {
    ...result,
    binding: {
      ...result.binding,
      sessionOffset: sessionContent.length,
      logOffset: logContent.length,
    },
  };
}

function formatProcessTable(
  rows: Array<{
    pid: number;
    tty: string;
    cwd: string;
    sessionId: string;
    protected: boolean;
  }>,
): string {
  const headers = ["PID", "TTY", "Protected", "Session", "CWD"];
  const body = rows.map((row) => [
    String(row.pid),
    row.tty,
    row.protected ? "yes" : "no",
    row.sessionId,
    row.cwd,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...body.map((row) => row[index].length)),
  );
  const formatRow = (columns: string[]) =>
    columns
      .map((column, index) => column.padEnd(widths[index]))
      .join("  ")
      .trimEnd();

  return [formatRow(headers), ...body.map(formatRow)].join("\n") + "\n";
}

export async function runCli(
  argv: string[],
  deps: CliDeps = createDefaultCliDeps(),
): Promise<number> {
  const command = normalizeCommand(argv[0]);

  if (command === "help") {
    deps.writeStdout(HELP_TEXT);
    return 0;
  }

  if (command === "list") {
    const state =
      typeof deps.loadState === "function"
        ? await deps.loadState()
        : createEmptyState();
    const processes = await deps.listCodexProcesses();
    const protectedPids = new Set(state.bindings.map((binding) => binding.pid));
    deps.writeStdout(
      formatProcessTable(
        processes.map((process) => ({
          ...process,
          protected: protectedPids.has(process.pid),
        })),
      ),
    );
    return 0;
  }

  if (command === "bind") {
    const pid = Number(argv[1]);
    const requestedTerminalId = argv[2]?.trim();

    if (!Number.isInteger(pid) || pid <= 0) {
      deps.writeStderr("bind requires a numeric pid\n");
      return 1;
    }

    const processes = await deps.listCodexProcesses();
    const process = processes.find((item) => item.pid === pid);

    if (!process) {
      deps.writeStderr(`No codex process found for pid ${pid}\n`);
      return 1;
    }

    const terminals = await deps.listGhosttyTerminals();
    const resolution = resolveTerminalCandidate(
      process,
      terminals,
      requestedTerminalId || undefined,
    );

    if (resolution.status !== "selected") {
      deps.writeStderr(`Could not determine a unique Ghostty terminal for pid ${pid}\n`);

      if (
        resolution.status === "ambiguous" ||
        resolution.status === "invalid-selection"
      ) {
        deps.writeStderr("Matching Ghostty terminals:\n");

        for (const candidate of resolution.candidates) {
          deps.writeStderr(formatGhosttyCandidate(candidate));
        }

        deps.writeStderr(`Re-run with: codex-guard bind ${pid} <terminal-id>\n`);
      }

      return 1;
    }

    const terminal = resolution.terminal;
    const state = await deps.loadState();
    const nextState = upsertBinding(state, buildBinding(process, terminal));

    await deps.saveState(nextState);
    deps.writeStdout(`Bound pid ${pid} to Ghostty terminal ${terminal.name}\n`);
    return 0;
  }

  if (command === "watch") {
    const pid = Number(argv[1]);
    const once = argv.includes("--once");

    if (!Number.isInteger(pid) || pid <= 0) {
      deps.writeStderr("watch requires a numeric pid\n");
      return 1;
    }

    let state = await deps.loadState();
    let binding = state.bindings.find((item) => item.pid === pid);

    if (!binding) {
      deps.writeStderr(`No saved binding found for pid ${pid}\n`);
      return 1;
    }

    if (!once) {
      deps.writeStdout(`Watching pid ${pid} every ${WATCH_INTERVAL_MS / 1000}s\n`);
    }

    while (true) {
      binding = refreshBindingFromProcesses(
        binding,
        await deps.listCodexProcesses(),
      );

      const tickNow = deps.now();
      const result = await watchBoundProcessOnce(binding, {
        ...deps,
        now: () => tickNow,
      });

      binding = result.binding;
      state = upsertBinding(state, binding);
      await deps.saveState(state);
      deps.writeStdout(`${formatWatchStatus(result)}\n`);

      if (
        once ||
        (!result.processAlive && result.decision.reason === "healthy")
      ) {
        return 0;
      }

      await deps.sleep(WATCH_INTERVAL_MS);
    }
  }

  if (command === "trigger") {
    const pid = Number(argv[1]);

    if (!Number.isInteger(pid) || pid <= 0) {
      deps.writeStderr("trigger requires a numeric pid\n");
      return 1;
    }

    const state = await deps.loadState();
    const binding = state.bindings.find((item) => item.pid === pid);

    if (!binding) {
      deps.writeStderr(`No saved binding found for pid ${pid}\n`);
      return 1;
    }

    await deps.injectPromptIntoTerminal(
      binding.ghosttyTerminalId,
      binding.prompt,
    );
    deps.writeStdout(`Triggered recovery prompt for pid ${pid}\n`);
    return 0;
  }

  deps.writeStdout(`${command} is not implemented yet\n`);
  return 0;
}

if (require.main === module) {
  void runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
