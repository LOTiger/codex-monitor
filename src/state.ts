import fs from "node:fs/promises";
import path from "node:path";

import { Binding, GuardState } from "./types";

export interface LoadStateDeps {
  stateFile: string;
  readTextFile?(filePath: string): Promise<string>;
}

export interface SaveStateDeps {
  stateFile: string;
  ensureDir?(dirPath: string): Promise<void>;
  writeTextFile?(filePath: string, content: string): Promise<void>;
}

export function createEmptyState(): GuardState {
  return {
    version: 1,
    bindings: [],
  };
}

function normalizeBindings(bindings: Binding[]): Binding[] {
  return bindings.reduce<Binding[]>((result, binding) => {
    const existingIndex = result.findIndex(
      (existing) =>
        existing.pid === binding.pid ||
        existing.ghosttyTerminalId === binding.ghosttyTerminalId,
    );

    if (existingIndex >= 0) {
      result.splice(existingIndex, 1);
    }

    result.push(binding);
    return result;
  }, []);
}

export async function loadState(deps: LoadStateDeps): Promise<GuardState> {
  const readTextFile =
    deps.readTextFile ?? ((filePath: string) => fs.readFile(filePath, "utf8"));

  try {
    const content = await readTextFile(deps.stateFile);
    const parsed = JSON.parse(content) as GuardState;

    return {
      version: parsed.version ?? 1,
      bindings: normalizeBindings(parsed.bindings ?? []),
    };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;

    if (errno.code === "ENOENT") {
      return createEmptyState();
    }

    throw error;
  }
}

export function upsertBinding(state: GuardState, binding: Binding): GuardState {
  return {
    ...state,
    bindings: normalizeBindings([...state.bindings, binding]),
  };
}

export function removeBinding(state: GuardState, pid: number): GuardState {
  return {
    ...state,
    bindings: state.bindings.filter((binding) => binding.pid !== pid),
  };
}

export async function saveState(
  state: GuardState,
  deps: SaveStateDeps,
): Promise<void> {
  const ensureDir =
    deps.ensureDir ?? ((dirPath: string) => fs.mkdir(dirPath, { recursive: true }));
  const writeTextFile =
    deps.writeTextFile ??
    ((filePath: string, content: string) => fs.writeFile(filePath, content, "utf8"));

  await ensureDir(path.dirname(deps.stateFile));
  await writeTextFile(deps.stateFile, `${JSON.stringify(state, null, 2)}\n`);
}
