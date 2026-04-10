import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";

import { createWebServer } from "../src/web";

async function startServer(
  deps: Parameters<typeof createWebServer>[0],
): Promise<{
  baseUrl: string;
  close(): Promise<void>;
}> {
  const { server } = createWebServer(deps);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

test("web root serves the console page in Chinese", async () => {
  const app = await startServer({
    listCodexProcesses: async () => [],
    listGhosttyTerminals: async () => [],
    loadState: async () => ({ version: 1, bindings: [] }),
    saveState: async () => {},
    injectPromptIntoTerminal: async () => {},
    readTextFile: async (filePath) => {
      if (filePath.endsWith("codex-tui.log")) {
        return "";
      }

      return [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"请帮我排查 monitor 里 codex 为什么经常卡住"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"event_msg","payload":{"type":"task_started"}}',
      ].join("\n");
    },
    processAlive: async () => false,
    sleep: async () => {},
    now: () => Date.now(),
  });

  try {
    const response = await fetch(app.baseUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Codex 守护台/);
    assert.match(html, /启动监听/);
    assert.match(html, /会话摘要/);
    assert.match(html, /max-width:\s*1680px/);
    assert.doesNotMatch(html, /min-width:\s*1040px/);
    assert.doesNotMatch(html, /<colgroup>/);
    assert.match(html, /table-layout:\s*auto/);
    assert.match(html, /@media \(max-width:\s*1180px\)/);
    assert.match(html, /\.cell-tty,\s*\.cell-actions\s*\{\s*width:\s*auto;/);
    assert.match(html, /\.cell-tty code\s*\{\s*white-space:\s*nowrap;\s*word-break:\s*normal;/);
    assert.match(html, /自动刷新/);
    assert.match(html, /id="refresh-interval"/);
    assert.match(html, /<option value="60000" selected>1 分钟<\/option>/);
    assert.match(html, /watch-protected/);
    assert.match(html, /触发次数/);
    assert.match(html, /关闭监听/);
    assert.match(html, /terminal-selection-required/);
    assert.match(html, /window\.prompt/);
  } finally {
    await app.close();
  }
});

test("bind API saves a binding and process API reports protected state", async () => {
  let savedState = { version: 1, bindings: [] as Array<Record<string, unknown>> };

  const app = await startServer({
    listCodexProcesses: async () => [
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
    ],
    listGhosttyTerminals: async () => [
      {
        id: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
        name: "monitor",
        workingDirectory: "/Users/lotiger/xiaoe/ai/monitor",
      },
    ],
    loadState: async () => savedState as never,
    saveState: async (state) => {
      savedState = state as never;
    },
    injectPromptIntoTerminal: async () => {},
    readTextFile: async (filePath) => {
      if (filePath.endsWith("codex-tui.log")) {
        return "";
      }

      return [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"请帮我排查 monitor 里 codex 为什么经常卡住"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"event_msg","payload":{"type":"task_started"}}',
      ].join("\n");
    },
    processAlive: async () => true,
    sleep: async () => {},
    now: () => Date.now(),
  });

  try {
    const bindResponse = await fetch(`${app.baseUrl}/api/bind`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ pid: 58256 }),
    });
    const bindJson = (await bindResponse.json()) as { ok: boolean };

    assert.equal(bindResponse.status, 200);
    assert.equal(bindJson.ok, true);
    assert.equal(savedState.bindings.length, 1);

    const processesResponse = await fetch(`${app.baseUrl}/api/processes`);
    const processesJson = (await processesResponse.json()) as {
      processes: Array<{
        pid: number;
        protected: boolean;
        cwd: string;
        summary: { preview: string; lastActivityAt: string };
        resumeCount: number;
        maxAutoResume: number;
      }>;
    };

    assert.equal(processesResponse.status, 200);
    assert.equal(processesJson.processes.length, 1);
    assert.equal(processesJson.processes[0].pid, 58256);
    assert.equal(processesJson.processes[0].protected, true);
    assert.equal(
      processesJson.processes[0].cwd,
      "/Users/lotiger/xiaoe/ai/monitor",
    );
    assert.equal(
      processesJson.processes[0].summary.preview,
      "请帮我排查 monitor 里 codex 为什么经常卡住",
    );
    assert.equal(
      processesJson.processes[0].summary.lastActivityAt,
      "2026-04-06T01:00:05.000Z",
    );
    assert.equal(processesJson.processes[0].resumeCount, 0);
    assert.equal(processesJson.processes[0].maxAutoResume, 0);
  } finally {
    await app.close();
  }
});

test("bind API returns Ghostty terminal candidates when cwd matches are ambiguous", async () => {
  const app = await startServer({
    listCodexProcesses: async () => [
      {
        pid: 62841,
        ppid: 78988,
        tty: "ttys000",
        status: "S+",
        command: "codex -a never -s danger-full-access",
        ttyDevice: "/dev/ttys000",
        cwd: "/Users/lotiger/xiaoe/test-case/course-test-case",
        sessionFile:
          "/Users/lotiger/.codex/sessions/2026/04/08/rollout-2026-04-08T01-00-00-01900000-0000-7000-8000-000000000000.jsonl",
        sessionId: "01900000-0000-7000-8000-000000000000",
        protected: false,
      },
    ],
    listGhosttyTerminals: async () => [
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
    loadState: async () => ({ version: 1, bindings: [] }),
    saveState: async () => {},
    injectPromptIntoTerminal: async () => {},
    readTextFile: async () => "",
    processAlive: async () => true,
    sleep: async () => {},
    now: () => Date.now(),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/bind`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ pid: 62841 }),
    });
    const json = (await response.json()) as {
      ok: boolean;
      code: string;
      candidates: Array<{ id: string }>;
    };

    assert.equal(response.status, 409);
    assert.equal(json.ok, false);
    assert.equal(json.code, "terminal-selection-required");
    assert.equal(json.candidates.length, 2);
    assert.equal(json.candidates[0].id, "7F5DA08F-3A31-4965-A2AE-5DEC6857EBF6");
    assert.equal(json.candidates[1].id, "D56575E4-C599-4B78-B221-832D7BF5E16E");
  } finally {
    await app.close();
  }
});

test("bind API accepts an explicit Ghostty terminal id when cwd matches are ambiguous", async () => {
  let savedState = { version: 1, bindings: [] as Array<Record<string, unknown>> };

  const app = await startServer({
    listCodexProcesses: async () => [
      {
        pid: 62841,
        ppid: 78988,
        tty: "ttys000",
        status: "S+",
        command: "codex -a never -s danger-full-access",
        ttyDevice: "/dev/ttys000",
        cwd: "/Users/lotiger/xiaoe/test-case/course-test-case",
        sessionFile:
          "/Users/lotiger/.codex/sessions/2026/04/08/rollout-2026-04-08T01-00-00-01900000-0000-7000-8000-000000000000.jsonl",
        sessionId: "01900000-0000-7000-8000-000000000000",
        protected: false,
      },
    ],
    listGhosttyTerminals: async () => [
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
    loadState: async () => savedState as never,
    saveState: async (state) => {
      savedState = state as never;
    },
    injectPromptIntoTerminal: async () => {},
    readTextFile: async () => "",
    processAlive: async () => true,
    sleep: async () => {},
    now: () => Date.now(),
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/bind`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        pid: 62841,
        terminalId: "D56575E4-C599-4B78-B221-832D7BF5E16E",
      }),
    });
    const json = (await response.json()) as { ok: boolean };

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(savedState.bindings.length, 1);
    assert.equal(
      savedState.bindings[0].ghosttyTerminalId,
      "D56575E4-C599-4B78-B221-832D7BF5E16E",
    );
  } finally {
    await app.close();
  }
});

test("watch start API runs in the background and records the latest status", async () => {
  let savedState = {
    version: 1,
    bindings: [
      {
        pid: 58256,
        tty: "ttys002",
        cwd: "/Users/lotiger/xiaoe/ai/monitor",
        sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
        sessionFile:
          "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
        ghosttyTerminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
        ghosttyTerminalName: "monitor",
        prompt: "继续",
        idleTimeoutSeconds: 120,
        cooldownSeconds: 180,
        maxAutoResume: 3,
        resumeCount: 0,
        lastActivityAt: "",
        lastResumeAt: "",
        sessionOffset: 0,
        logOffset: 0,
      },
    ],
  };
  const aliveResults = [true, false];

  const app = await startServer({
    listCodexProcesses: async () => [
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
    ],
    listGhosttyTerminals: async () => [],
    loadState: async () => savedState as never,
    saveState: async (state) => {
      savedState = state as never;
    },
    injectPromptIntoTerminal: async () => {},
    readTextFile: async (filePath) => {
      if (filePath.endsWith("codex-tui.log")) {
        return "";
      }

      return [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:10.000Z","type":"event_msg","payload":{"type":"task_complete"}}',
      ].join("\n");
    },
    processAlive: async () => aliveResults.shift() ?? false,
    sleep: async () => {},
    now: () => Date.parse("2026-04-06T01:00:20.000Z"),
  });

  try {
    const startResponse = await fetch(`${app.baseUrl}/api/watch/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ pid: 58256 }),
    });
    const startJson = (await startResponse.json()) as { ok: boolean };

    assert.equal(startResponse.status, 202);
    assert.equal(startJson.ok, true);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const processesResponse = await fetch(`${app.baseUrl}/api/processes`);
    const processesJson = (await processesResponse.json()) as {
      processes: Array<{
        pid: number;
        cwd: string;
        watch: { running: boolean; lastMessage: string };
      }>;
    };

    assert.equal(processesResponse.status, 200);
    assert.equal(processesJson.processes[0].pid, 58256);
    assert.equal(
      processesJson.processes[0].cwd,
      "/Users/lotiger/xiaoe/ai/monitor",
    );
    assert.equal(processesJson.processes[0].watch.running, false);
    assert.equal(
      processesJson.processes[0].watch.lastMessage,
      "已停止：进程未运行",
    );
  } finally {
    await app.close();
  }
});

test("watch stop API closes an active listener", async () => {
  let savedState = {
    version: 1,
    bindings: [
      {
        pid: 58256,
        tty: "ttys002",
        cwd: "/Users/lotiger/xiaoe/ai/monitor",
        sessionId: "019d6057-5b00-70f0-bed7-96d71b8757fd",
        sessionFile:
          "/Users/lotiger/.codex/sessions/2026/04/06/rollout-2026-04-06T09-10-30-019d6057-5b00-70f0-bed7-96d71b8757fd.jsonl",
        ghosttyTerminalId: "8D7F3D83-AD46-4E7C-997D-6D5A6C147289",
        ghosttyTerminalName: "monitor",
        prompt: "继续",
        idleTimeoutSeconds: 120,
        cooldownSeconds: 180,
        maxAutoResume: 3,
        resumeCount: 0,
        lastActivityAt: "",
        lastResumeAt: "",
        sessionOffset: 0,
        logOffset: 0,
      },
    ],
  };
  let releaseSleep: (() => void) | null = null;

  const app = await startServer({
    listCodexProcesses: async () => [
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
    ],
    listGhosttyTerminals: async () => [],
    loadState: async () => savedState as never,
    saveState: async (state) => {
      savedState = state as never;
    },
    injectPromptIntoTerminal: async () => {},
    readTextFile: async (filePath) => {
      if (filePath.endsWith("codex-tui.log")) {
        return "";
      }

      return [
        '{"timestamp":"2026-04-06T01:00:00.000Z","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"2026-04-06T01:00:05.000Z","type":"response_item","payload":{"type":"message"}}',
      ].join("\n");
    },
    processAlive: async () => true,
    sleep: async () =>
      new Promise<void>((resolve) => {
        releaseSleep = resolve;
      }),
    now: () => Date.parse("2026-04-06T01:00:20.000Z"),
  });

  try {
    const startResponse = await fetch(`${app.baseUrl}/api/watch/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ pid: 58256 }),
    });

    assert.equal(startResponse.status, 202);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const stopResponse = await fetch(`${app.baseUrl}/api/watch/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ pid: 58256 }),
    });
    const stopJson = (await stopResponse.json()) as { ok: boolean };

    assert.equal(stopResponse.status, 202);
    assert.equal(stopJson.ok, true);

    releaseSleep?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const processesResponse = await fetch(`${app.baseUrl}/api/processes`);
    const processesJson = (await processesResponse.json()) as {
      processes: Array<{
        pid: number;
        watch: { running: boolean; lastMessage: string };
      }>;
    };

    assert.equal(processesResponse.status, 200);
    assert.equal(processesJson.processes[0].pid, 58256);
    assert.equal(processesJson.processes[0].watch.running, false);
    assert.equal(
      processesJson.processes[0].watch.lastMessage,
      "已停止：监听已关闭",
    );
  } finally {
    releaseSleep?.();
    await app.close();
  }
});
