import assert from "node:assert/strict";
import test from "node:test";

import {
  listCodexProcesses,
  parseLsofOutput,
  parsePsOutput,
} from "../src/process-discovery";
import { parseSessionMetaLine } from "../src/session-files";

test("parsePsOutput keeps only codex processes and extracts pid, tty, and command", () => {
  const output = `
58256 23000 ttys002 S+ codex -a never -s danger-full-access
33127 23001 ttys001 S+ codex -a never -s danger-full-access resume 019d53bd-98b9-7ac2-8eb6-be8642f71228
60918 60910 ?? R rg [c]odex|[n]ode.*codex|[p]ython.*codex
`;

  assert.deepEqual(parsePsOutput(output), [
    {
      pid: 58256,
      ppid: 23000,
      tty: "ttys002",
      status: "S+",
      command: "codex -a never -s danger-full-access",
    },
    {
      pid: 33127,
      ppid: 23001,
      tty: "ttys001",
      status: "S+",
      command:
        "codex -a never -s danger-full-access resume 019d53bd-98b9-7ac2-8eb6-be8642f71228",
    },
  ]);
});

test("parseLsofOutput extracts cwd, tty device, and session file", () => {
  const output = `
codex-aar 58256 lotiger  cwd       DIR               1,14         64            21007947 /Users/lotiger/xiaoe/ai/monitor
codex-aar 58256 lotiger    0u      CHR               16,2 0t96784541                 939 /dev/ttys002
codex-aar 58256 lotiger   24w      REG               1,14     594385            21008284 /Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl
`;

  assert.deepEqual(parseLsofOutput(output), {
    cwd: "/Users/lotiger/xiaoe/ai/monitor",
    ttyDevice: "/dev/ttys002",
    sessionFile:
      "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
  });
});

test("parseSessionMetaLine extracts session id and cwd from session meta", () => {
  const line =
    '{"timestamp":"2026-04-06T01:11:56.717Z","type":"session_meta","payload":{"id":"019d6057-5b00-70f0-bed7-96d71b8757fd","timestamp":"2026-04-06T01:10:30.914Z","cwd":"/Users/lotiger/xiaoe/ai/monitor"}}';

  assert.deepEqual(parseSessionMetaLine(line), {
    sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
    cwd: "/Users/lotiger/xiaoe/ai/monitor",
  });
});

test("listCodexProcesses combines ps, lsof, and session meta into a process record", async () => {
  const processList = await listCodexProcesses({
    codexHome: "/Users/lotiger/.codex",
    execFile: async (file, args) => {
      const key = `${file} ${args.join(" ")}`;

      if (key === "ps -axo pid=,ppid=,tty=,stat=,command=") {
        return {
          stdout:
            "58256 23000 ttys002 S+ codex -a never -s danger-full-access\n",
          stderr: "",
        };
      }

      if (key === "lsof -p 58256") {
        return {
          stdout: `
codex-aar 58256 lotiger  cwd       DIR               1,14         64            21007947 /Users/lotiger/xiaoe/ai/monitor
codex-aar 58256 lotiger    0u      CHR               16,2 0t96784541                 939 /dev/ttys002
codex-aar 58256 lotiger   24w      REG               1,14     594385            21008284 /Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl
`,
          stderr: "",
        };
      }

      throw new Error(`Unexpected command: ${key}`);
    },
    readTextFile: async (filePath) => {
      assert.equal(
        filePath,
        "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
      );

      return '{"timestamp":"2026-04-06T01:11:56.717Z","type":"session_meta","payload":{"id":"019d6057-5b00-70f0-bed7-96d71b8757fd","cwd":"/Users/lotiger/xiaoe/ai/monitor"}}\n';
    },
  });

  assert.deepEqual(processList, [
    {
      pid: 58256,
      ppid: 23000,
      tty: "ttys002",
      status: "S+",
      command: "codex -a never -s danger-full-access",
      ttyDevice: "/dev/ttys002",
      cwd: "/Users/lotiger/xiaoe/ai/monitor",
      sessionFile:
        "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
      sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
      protected: false,
    },
  ]);
});
