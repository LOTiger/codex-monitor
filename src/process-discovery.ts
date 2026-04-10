import { parseSessionMetaLine } from "./session-files";

export interface PsProcessRow {
  pid: number;
  ppid: number;
  tty: string;
  status: string;
  command: string;
}

export interface LsofDetails {
  cwd: string;
  ttyDevice: string;
  sessionFile: string;
}

export interface CodexProcess extends PsProcessRow, LsofDetails {
  sessionId: string;
  protected: boolean;
}

export interface ProcessDiscoveryDeps {
  codexHome: string;
  execFile(file: string, args: string[]): Promise<{
    stdout: string;
    stderr: string;
  }>;
  readTextFile(filePath: string): Promise<string>;
}

export function parsePsOutput(output: string): PsProcessRow[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);

      if (!match) {
        return null;
      }

      const [, pid, ppid, tty, status, command] = match;
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        tty,
        status,
        command,
      };
    })
    .filter((row): row is PsProcessRow => Boolean(row))
    .filter((row) => row.command === "codex" || row.command.startsWith("codex "));
}

export function parseLsofOutput(output: string): LsofDetails {
  let cwd = "";
  let ttyDevice = "";
  let sessionFile = "";

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const pathMatch = line.match(/\s(\/.*)$/);
    const path = pathMatch?.[1] ?? "";

    if (line.includes(" cwd ") && path) {
      cwd = path;
      continue;
    }

    if (!ttyDevice && /\/dev\/ttys\d+/.test(path)) {
      ttyDevice = path;
      continue;
    }

    if (!sessionFile && /\/\.codex\/sessions\/.*\.jsonl$/.test(path)) {
      sessionFile = path;
    }
  }

  return {
    cwd,
    ttyDevice,
    sessionFile,
  };
}

export async function listCodexProcesses(
  deps: ProcessDiscoveryDeps,
): Promise<CodexProcess[]> {
  const { stdout } = await deps.execFile("ps", [
    "-axo",
    "pid=,ppid=,tty=,stat=,command=",
  ]);

  const rows = parsePsOutput(stdout);
  const results: CodexProcess[] = [];

  for (const row of rows) {
    const lsof = await deps.execFile("lsof", ["-p", String(row.pid)]);
    const details = parseLsofOutput(lsof.stdout);
    let sessionId = "";

    if (
      details.sessionFile &&
      details.sessionFile.includes(`${deps.codexHome}/sessions/`)
    ) {
      const sessionFileContent = await deps.readTextFile(details.sessionFile);
      const firstLine = sessionFileContent.split("\n").find(Boolean);

      if (firstLine) {
        sessionId = parseSessionMetaLine(firstLine).sessionId;
      }
    }

    results.push({
      ...row,
      ...details,
      sessionId,
      protected: false,
    });
  }

  return results;
}
