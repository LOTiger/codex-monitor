import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGhosttyTerminalDump,
  resolveTerminalCandidate,
  selectTerminalCandidate,
} from "../src/ghostty";

test("parseGhosttyTerminalDump extracts terminal id, title, and working directory", () => {
  const dump = [
    "8D7F3D83-AD46-4E7C-997D-6D5A6C147289\t⠹ monitor\t/Users/lotiger/xiaoe/ai/monitor",
    "041DDFEB-E900-40BC-9416-D81960C5A785\txiaoe-cloud-cli\t/Users/lotiger/xiaoe/ai/xiaoe-cloud-cli",
  ].join("\n");

  assert.deepEqual(parseGhosttyTerminalDump(dump), [
    {
      id: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
      name: "⠹ monitor",
      workingDirectory: "/Users/lotiger/xiaoe/ai/monitor",
    },
    {
      id: "041DDFEB-E900-40BC-9416-D81960C5A785",
      name: "xiaoe-cloud-cli",
      workingDirectory: "/Users/lotiger/xiaoe/ai/xiaoe-cloud-cli",
    },
  ]);
});

test("parseGhosttyTerminalDump handles literal AppleScript tab separators", () => {
  const dump =
    "8D7F3D83-AD46-4E7C-997D-6D5A6C147289tab⠹ monitortab/Users/lotiger/xiaoe/ai/monitor";

  assert.deepEqual(parseGhosttyTerminalDump(dump), [
    {
      id: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
      name: "⠹ monitor",
      workingDirectory: "/Users/lotiger/xiaoe/ai/monitor",
    },
  ]);
});

test("selectTerminalCandidate prefers the only exact cwd match", () => {
  const terminal = selectTerminalCandidate(
    {
      cwd: "/Users/lotiger/xiaoe/ai/monitor",
      command: "codex -a never -s danger-full-access",
    },
    [
      {
        id: "A",
        name: "xiaoe-cloud-cli",
        workingDirectory: "/Users/lotiger/xiaoe/ai/xiaoe-cloud-cli",
      },
      {
        id: "B",
        name: "⠹ monitor",
        workingDirectory: "/Users/lotiger/xiaoe/ai/monitor",
      },
    ],
  );

  assert.deepEqual(terminal, {
    id: "B",
    name: "⠹ monitor",
    workingDirectory: "/Users/lotiger/xiaoe/ai/monitor",
  });
});

test("selectTerminalCandidate returns null when exact cwd matches are ambiguous", () => {
  const terminal = selectTerminalCandidate(
    {
      cwd: "/Users/lotiger/xiaoe/ai/xiaoe-cloud-cli",
      command: "codex -a never -s danger-full-access",
    },
    [
      {
        id: "A",
        name: "cli-1",
        workingDirectory: "/Users/lotiger/xiaoe/ai/xiaoe-cloud-cli",
      },
      {
        id: "B",
        name: "cli-2",
        workingDirectory: "/Users/lotiger/xiaoe/ai/xiaoe-cloud-cli",
      },
    ],
  );

  assert.equal(terminal, null);
});

test("resolveTerminalCandidate accepts an explicit terminal id when exact cwd matches are ambiguous", () => {
  const resolution = resolveTerminalCandidate(
    {
      cwd: "/Users/lotiger/xiaoe/test-case/course-test-case",
      command: "codex -a never -s danger-full-access",
    },
    [
      {
        id: "7F5DA08F-3A31-4965-A2AE-5DEC6857EBF6",
        name: "lotiger@lotigerdeMac-mini:~/xiaoe/test-case/course-test-case",
        workingDirectory: "/Users/lotiger/xiaoe/test-case/course-test-case",
      },
      {
        id: "D56575E4-C599-4B78-B221-832D7BF5E16E",
        name: "lotiger@lotigerdeMac-mini:~/xiaoe/test-case/course-test-case",
        workingDirectory: "/Users/lotiger/xiaoe/test-case/course-test-case",
      },
    ],
    "D56575E4-C599-4B78-B221-832D7BF5E16E",
  );

  assert.equal(resolution.status, "selected");
  assert.deepEqual(resolution.terminal, {
    id: "D56575E4-C599-4B78-B221-832D7BF5E16E",
    name: "lotiger@lotigerdeMac-mini:~/xiaoe/test-case/course-test-case",
    workingDirectory: "/Users/lotiger/xiaoe/test-case/course-test-case",
  });
});
