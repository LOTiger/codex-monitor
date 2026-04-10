import os from "node:os";
import path from "node:path";

export function getCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

export function getGuardHome(): string {
  return process.env.CODEX_GUARD_HOME ?? path.join(os.homedir(), ".codex-guard");
}

export function getStateFile(): string {
  return path.join(getGuardHome(), "state.json");
}
