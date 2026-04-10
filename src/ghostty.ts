import path from "node:path";

import { execFileText } from "./exec";

export interface GhosttyTerminal {
  id: string;
  name: string;
  workingDirectory: string;
}

export interface TerminalCandidateProcess {
  cwd: string;
  command: string;
}

export interface GhosttyDeps {
  execFile?(file: string, args: string[]): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export type TerminalCandidateResolution =
  | {
      status: "selected";
      terminal: GhosttyTerminal;
    }
  | {
      status: "ambiguous";
      candidates: GhosttyTerminal[];
    }
  | {
      status: "invalid-selection";
      candidates: GhosttyTerminal[];
    }
  | {
      status: "not-found";
    };

export function parseGhosttyTerminalDump(output: string): GhosttyTerminal[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let [id, name, workingDirectory] = line.split("\t");

      if (!name || !workingDirectory) {
        const match = line.match(/^([0-9A-Fa-f-]+)tab(.+)tab(\/.*)$/);

        if (match) {
          [, id, name, workingDirectory] = match;
        }
      }

      return {
        id,
        name,
        workingDirectory,
      };
    });
}

export function resolveTerminalCandidate(
  process: TerminalCandidateProcess,
  terminals: GhosttyTerminal[],
  terminalId?: string,
): TerminalCandidateResolution {
  const exactMatches = terminals.filter(
    (terminal) => terminal.workingDirectory === process.cwd,
  );

  if (terminalId) {
    const selected = exactMatches.find((terminal) => terminal.id === terminalId);

    if (selected) {
      return {
        status: "selected",
        terminal: selected,
      };
    }

    if (exactMatches.length > 0) {
      return {
        status: "invalid-selection",
        candidates: exactMatches,
      };
    }
  }

  if (exactMatches.length === 1) {
    return {
      status: "selected",
      terminal: exactMatches[0],
    };
  }

  if (exactMatches.length > 1) {
    const cwdName = path.basename(process.cwd).toLowerCase();
    const titleMatches = exactMatches.filter((terminal) =>
      terminal.name.toLowerCase().includes(cwdName),
    );

    if (titleMatches.length === 1) {
      return {
        status: "selected",
        terminal: titleMatches[0],
      };
    }

    return {
      status: "ambiguous",
      candidates: exactMatches,
    };
  }

  return {
    status: "not-found",
  };
}

export function selectTerminalCandidate(
  process: TerminalCandidateProcess,
  terminals: GhosttyTerminal[],
): GhosttyTerminal | null {
  const resolution = resolveTerminalCandidate(process, terminals);

  if (resolution.status === "selected") {
    return resolution.terminal;
  }

  return null;
}

export async function listGhosttyTerminals(
  deps: GhosttyDeps = {},
): Promise<GhosttyTerminal[]> {
  const execFile = deps.execFile ?? execFileText;
  const script = [
    'tell application "Ghostty"',
    'set outputText to ""',
    "repeat with currentTerminal in terminals",
    'set outputText to outputText & (id of currentTerminal) & (ASCII character 9) & (name of currentTerminal) & (ASCII character 9) & (working directory of currentTerminal) & (ASCII character 10)',
    "end repeat",
    "return outputText",
    "end tell",
  ];
  const { stdout } = await execFile(
    "osascript",
    script.flatMap((line) => ["-e", line]),
  );

  return parseGhosttyTerminalDump(stdout);
}

export async function injectPromptIntoTerminal(
  terminalId: string,
  prompt: string,
  deps: GhosttyDeps = {},
): Promise<void> {
  const execFile = deps.execFile ?? execFileText;
  const script = [
    "on run argv",
    "set targetTerminalId to item 1 of argv",
    "set promptText to item 2 of argv",
    'tell application "Ghostty"',
    "input text promptText to terminal id targetTerminalId",
    'send key "enter" to terminal id targetTerminalId',
    "end tell",
    "end run",
  ];

  await execFile("osascript", [
    ...script.flatMap((line) => ["-e", line]),
    terminalId,
    prompt,
  ]);
}
