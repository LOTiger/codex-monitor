#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
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
import { parseSessionRecords, summarizeSessionRecords } from "./session-files";
import { createEmptyState, loadState, saveState, upsertBinding } from "./state";
import { Binding, GuardState } from "./types";

const DEFAULT_PROMPT =
  "继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。";
const WATCH_INTERVAL_MS = 5_000;
const DEFAULT_PORT = 4312;

export interface WebDeps {
  listCodexProcesses(): Promise<CodexProcess[]>;
  listGhosttyTerminals(): Promise<GhosttyTerminal[]>;
  loadState(): Promise<GuardState>;
  saveState(state: GuardState): Promise<void>;
  injectPromptIntoTerminal(terminalId: string, prompt: string): Promise<void>;
  readTextFile(filePath: string): Promise<string>;
  processAlive(pid: number): Promise<boolean>;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
}

interface WatchStatus {
  running: boolean;
  lastMessage: string;
  lastUpdatedAt: string;
}

interface WatchRuntime extends WatchStatus {
  stopRequested: boolean;
  task: Promise<void> | null;
}

interface SessionSummary {
  preview: string;
  lastActivityAt: string;
}

type WatchResult = Awaited<ReturnType<typeof watchBindingOnce>>;
type BindResult =
  | {
      status: "bound";
    }
  | {
      status: "selection-required";
      candidates: GhosttyTerminal[];
    };

function createDefaultWebDeps(): WebDeps {
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
  };
}

function buildBinding(
  codexProcess: CodexProcess,
  terminal: GhosttyTerminal,
): Binding {
  return {
    pid: codexProcess.pid,
    tty: codexProcess.tty,
    cwd: codexProcess.cwd,
    sessionId: codexProcess.sessionId,
    sessionFile: codexProcess.sessionFile,
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

async function readOptionalTextFile(
  deps: WebDeps,
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
  if (offset <= 0 || offset > content.length) {
    return content;
  }

  return content.slice(offset);
}

function formatWatchStatus(result: WatchResult): string {
  if (!result.processAlive) {
    return "已停止：进程未运行";
  }

  if (result.decision.action === "resume") {
    if (result.decision.reason === "confirm") {
      return `已自动确认：${result.decision.detail}`;
    }

    if (result.decision.reason === "idle") {
      return `已触发继续：长时间无输出，${result.decision.detail}`;
    }

    return `已触发继续：检测到异常，${result.decision.detail}`;
  }

  if (result.decision.action === "suppress") {
    if (result.decision.reason === "cooldown") {
      return "已抑制恢复：冷却时间内不重复触发";
    }

    if (result.decision.reason === "max-auto-resume") {
      return "已抑制恢复：已达到自动继续上限";
    }

    return `已抑制恢复：${result.decision.detail}`;
  }

  return "状态正常：无需恢复";
}

async function watchBoundProcessOnce(
  binding: Binding,
  deps: WebDeps,
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

function createWatchRuntime(now: number): WatchRuntime {
  return {
    running: false,
    lastMessage: "",
    lastUpdatedAt: new Date(now).toISOString(),
    stopRequested: false,
    task: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isoTime(value: number): string {
  return new Date(value).toISOString();
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function previewFromRecord(
  record: ReturnType<typeof parseSessionRecords>[number],
): string {
  const payloadType = record.payload?.type ?? "";
  const payloadMessage = record.payload?.message;
  const message = typeof payloadMessage === "string" ? payloadMessage.trim() : "";

  if (payloadType === "user_message" && message) {
    return clipText(message, 54);
  }

  if (payloadType === "task_started") {
    return "任务执行中";
  }

  if (payloadType === "task_complete") {
    return "任务已完成";
  }

  if (payloadType === "agent_message" && message) {
    return `助手回复：${clipText(message, 42)}`;
  }

  if (payloadType === "agent_reasoning") {
    return "模型正在思考";
  }

  if (record.type === "response_item" && payloadType === "function_call") {
    return "正在调用工具";
  }

  if (record.type === "response_item" && payloadType === "function_call_output") {
    return "工具结果已返回";
  }

  if (record.type === "response_item" && payloadType === "message") {
    return "助手已输出内容";
  }

  return "";
}

function summarizeSessionText(content: string): SessionSummary {
  if (!content.trim()) {
    return {
      preview: "暂无会话摘要",
      lastActivityAt: "",
    };
  }

  const records = parseSessionRecords(content);
  const activity = summarizeSessionRecords(records);
  let preview = "";

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const current = previewFromRecord(records[index]);

    if (current && records[index].payload?.type === "user_message") {
      preview = current;
      break;
    }

    if (!preview && current) {
      preview = current;
    }
  }

  return {
    preview: preview || "暂无会话摘要",
    lastActivityAt: activity.lastActivityAt,
  };
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  return rawBody ? (JSON.parse(rawBody) as unknown) : {};
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(response: http.ServerResponse, content: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(content);
}

function pageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex 守护台</title>
    <style>
      :root {
        --bg: #f6f1e8;
        --card: rgba(255, 252, 246, 0.94);
        --ink: #1f1a17;
        --muted: #6f6359;
        --line: rgba(76, 58, 44, 0.18);
        --accent: #0b8a6d;
        --accent-strong: #086a54;
        --warn: #b54a1f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(11,138,109,0.16), transparent 30%),
          linear-gradient(140deg, #ece2d1 0%, var(--bg) 48%, #e5ecdf 100%);
      }
      main {
        width: min(1680px, calc(100% - 32px));
        max-width: 1680px;
        margin: 32px auto;
        padding: 28px;
        border-radius: 24px;
        border: 1px solid var(--line);
        background: var(--card);
        box-shadow: 0 18px 48px rgba(31, 26, 23, 0.08);
      }
      h1 { margin: 0; font-size: clamp(2rem, 4vw, 3.4rem); line-height: 0.95; }
      p { color: var(--muted); }
      .toolbar {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        margin: 18px 0 16px;
      }
      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .table-wrap {
        width: 100%;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.52);
      }
      .pills { display: flex; gap: 8px; flex-wrap: wrap; }
      .pill {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 6px 10px;
        color: var(--muted);
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
        color: white;
        background: var(--accent);
      }
      button:hover { background: var(--accent-strong); }
      button.secondary { color: var(--ink); background: #e6dacc; }
      button:disabled { opacity: 0.55; cursor: default; }
      .refresh-control {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        font-size: 14px;
      }
      select {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 9px 12px;
        font: inherit;
        color: var(--ink);
        background: rgba(255, 252, 246, 0.96);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: auto;
      }
      th, td {
        text-align: left;
        padding: 12px 10px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      .cell-process { min-width: 138px; }
      .cell-tty { width: 1%; white-space: nowrap; }
      .cell-summary { min-width: 300px; }
      .cell-cwd { min-width: 280px; }
      .cell-status { min-width: 220px; }
      .cell-actions { width: 1%; white-space: nowrap; }
      th {
        font-size: 13px;
        color: var(--muted);
        text-transform: none;
        letter-spacing: 0.04em;
      }
      tbody tr:last-child td { border-bottom: 0; }
      tbody tr:nth-child(even) { background: rgba(246, 241, 232, 0.62); }
      code {
        font-size: 13px;
        font-family: "SF Mono", "Menlo", monospace;
        word-break: break-all;
        white-space: pre-wrap;
      }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .watch-running { color: var(--accent-strong); }
      .watch-protected, .protection-active { color: var(--accent-strong); }
      .watch-stopped, .error { color: var(--warn); }
      #status { min-height: 24px; }
      .cell-title { display: block; font-weight: 600; line-height: 1.5; }
      .cell-subtitle { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.45; }
      .summary-text {
        display: -webkit-box;
        overflow: hidden;
        line-height: 1.55;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }
      .summary-time { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
      @media (max-width: 1180px) {
        main {
          width: calc(100% - 20px);
          margin: 10px auto;
          padding: 18px;
          border-radius: 20px;
        }
        .toolbar-actions {
          width: 100%;
          justify-content: space-between;
        }
        .refresh-control {
          width: 100%;
          justify-content: space-between;
        }
        .table-wrap {
          overflow: visible;
          border: 0;
          background: transparent;
        }
        table, thead, tbody {
          display: block;
          width: 100%;
        }
        thead {
          display: none;
        }
        tbody {
          display: grid;
          gap: 12px;
        }
        tbody tr {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px 16px;
          padding: 16px;
          border: 1px solid var(--line);
          border-radius: 18px;
          background: rgba(255, 252, 246, 0.94);
          box-shadow: 0 12px 28px rgba(31, 26, 23, 0.06);
        }
        tbody tr:nth-child(even) {
          background: rgba(255, 252, 246, 0.94);
        }
        td {
          display: block;
          min-width: 0;
          padding: 0;
          border-bottom: 0;
        }
        td::before {
          content: attr(data-label);
          display: block;
          margin-bottom: 6px;
          color: var(--muted);
          font-size: 12px;
          letter-spacing: 0.04em;
        }
        .cell-summary,
        .cell-cwd,
        .cell-status,
        .cell-actions {
          grid-column: 1 / -1;
        }
        .cell-tty,
        .cell-actions {
          width: auto;
          white-space: normal;
        }
        .cell-tty code {
          white-space: nowrap;
          word-break: normal;
        }
        .cell-actions::before {
          margin-bottom: 10px;
        }
        .actions {
          width: 100%;
        }
        .actions button {
          flex: 1 1 180px;
        }
        .empty-row {
          display: block;
          padding: 0;
          border: 0;
          background: transparent;
          box-shadow: none;
        }
        .empty-row td {
          padding: 18px;
          border: 1px solid var(--line);
          border-radius: 18px;
          background: rgba(255, 252, 246, 0.94);
        }
        .empty-row td::before {
          content: none;
        }
      }
      @media (max-width: 720px) {
        .refresh-control {
          align-items: flex-start;
          flex-direction: column;
        }
        tbody tr {
          grid-template-columns: minmax(0, 1fr);
        }
        .cell-process,
        .cell-tty,
        .cell-summary,
        .cell-cwd,
        .cell-status,
        .cell-actions {
          grid-column: 1 / -1;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <p>本机 Ghostty 会话保护台</p>
      <h1>Codex 守护台</h1>
      <p>绑定会话并启动监听后，输出中断或异常停滞时会自动续跑。</p>
      <div class="toolbar">
        <div class="pills">
          <span class="pill">绑定终端</span>
          <span class="pill">启动监听</span>
          <span class="pill">自动续跑</span>
        </div>
        <div class="toolbar-actions">
          <label class="refresh-control" for="refresh-interval">
            自动刷新
            <select id="refresh-interval">
              <option value="15000">15 秒</option>
              <option value="30000">30 秒</option>
              <option value="60000" selected>1 分钟</option>
              <option value="300000">5 分钟</option>
              <option value="0">关闭</option>
            </select>
          </label>
          <button id="refresh" class="secondary" type="button">刷新</button>
        </div>
      </div>
      <p id="status">正在加载当前 Codex 进程...</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>进程</th>
              <th>TTY</th>
              <th>会话摘要</th>
              <th>工作目录</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="rows">
            <tr class="empty-row"><td colspan="6">正在加载...</td></tr>
          </tbody>
        </table>
      </div>
    <script>
      const rows = document.getElementById("rows");
      const statusNode = document.getElementById("status");
      const refreshButton = document.getElementById("refresh");
      const refreshIntervalSelect = document.getElementById("refresh-interval");
      const DEFAULT_REFRESH_INTERVAL_MS = 60000;
      let refreshInFlight = null;
      let refreshTimer = null;

      function setStatus(text, isError = false) {
        statusNode.textContent = text;
        statusNode.className = isError ? "error" : "";
      }

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => {
          if (char === "&") return "&amp;";
          if (char === "<") return "&lt;";
          if (char === ">") return "&gt;";
          if (char === '"') return "&quot;";
          return "&#39;";
        });
      }

      function formatActivity(value) {
        if (!value) {
          return "最近活动：暂无";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
          return "最近活动：暂无";
        }

        return "最近活动：" + date.toLocaleString("zh-CN");
      }

      function shortSessionId(value) {
        if (!value) {
          return "未知";
        }

        const text = String(value);

        if (text.length <= 16) {
          return text;
        }

        return text.slice(0, 8) + "..." + text.slice(-6);
      }

      function formatRefreshInterval(value) {
        if (value === 0) {
          return "关闭";
        }

        if (value < 60000) {
          return Math.round(value / 1000) + " 秒";
        }

        return Math.round(value / 60000) + " 分钟";
      }

      function clearRefreshTimer() {
        if (refreshTimer !== null) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
      }

      function selectedRefreshInterval() {
        const value = Number(refreshIntervalSelect.value);

        if (!Number.isFinite(value) || value < 0) {
          return DEFAULT_REFRESH_INTERVAL_MS;
        }

        return value;
      }

      function scheduleRefresh() {
        clearRefreshTimer();

        const interval = selectedRefreshInterval();

        if (interval === 0) {
          return;
        }

        refreshTimer = setTimeout(() => {
          void refreshProcesses("正在自动刷新列表...");
        }, interval);
      }

      async function fetchJson(url, options) {
        const response = await fetch(url, options);
        let json = {};

        try {
          json = await response.json();
        } catch (error) {
          json = {};
        }

        if (!response.ok) {
          const error = new Error(json.error || "请求失败");
          error.payload = json;
          error.status = response.status;
          throw error;
        }

        return json;
      }

      function pickGhosttyCandidate(choice, candidates) {
        const value = String(choice ?? "").trim();

        if (!value) {
          return null;
        }

        const index = Number(value);

        if (Number.isInteger(index) && index >= 1 && index <= candidates.length) {
          return candidates[index - 1];
        }

        return candidates.find((candidate) => candidate.id === value) || null;
      }

      function promptForGhosttyCandidate(pid, candidates) {
        const lines = [
          "检测到多个 Ghostty 终端，请输入要绑定的序号或完整终端 ID：",
        ];

        candidates.forEach((candidate, index) => {
          lines.push(
            (index + 1) +
              ". " +
              candidate.name +
              " | " +
              candidate.workingDirectory +
              " | " +
              candidate.id,
          );
        });

        const choice = window.prompt(lines.join("\\n"), "1");

        if (choice === null) {
          setStatus("已取消绑定进程 " + pid);
          return null;
        }

        const selected = pickGhosttyCandidate(choice, candidates);

        if (!selected) {
          throw new Error("请输入候选列表中的序号或完整终端 ID");
        }

        return selected.id;
      }

      async function bindProcessFromUi(pid) {
        try {
          await fetchJson("/api/bind", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pid }),
          });
          return true;
        } catch (error) {
          const payload = error && typeof error === "object" ? error.payload : null;

          if (
            !payload ||
            payload.code !== "terminal-selection-required" ||
            !Array.isArray(payload.candidates) ||
            payload.candidates.length === 0
          ) {
            throw error;
          }

          const terminalId = promptForGhosttyCandidate(pid, payload.candidates);

          if (!terminalId) {
            return false;
          }

          await fetchJson("/api/bind", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pid, terminalId }),
          });
          return true;
        }
      }

      function render(processes) {
        if (!processes.length) {
          rows.innerHTML = '<tr class="empty-row"><td colspan="6">当前没有发现运行中的 Codex 进程。</td></tr>';
          return;
        }

        rows.innerHTML = processes.map((item) => {
          const watchClass = item.watch.running
            ? "watch-running"
            : item.watch.lastMessage
              ? "watch-stopped"
              : item.protected
                ? "watch-protected"
                : "watch-stopped";
          const watchLabel = item.watch.lastMessage || (item.protected ? "已保护" : "未保护");
          const summaryText = item.summary ? item.summary.preview : "暂无会话摘要";
          const summaryTime = formatActivity(item.summary && item.summary.lastActivityAt);
          const bindDisabled = item.protected ? "disabled" : "";
          const watchDisabled = item.protected ? "" : "disabled";
          const watchAction = item.watch.running ? "watch-stop" : "watch-start";
          const watchButtonLabel = item.watch.running ? "关闭监听" : "启动监听";
          const protectionClass = item.protected ? "cell-subtitle protection-active" : "cell-subtitle";
          const resumeText = item.protected
            ? "触发次数：" + item.resumeCount + " / 无限"
            : "触发次数：未启用";
          const sessionId = item.sessionId || "";
          return \`<tr>
            <td class="cell-process" data-label="进程">
              <span class="cell-title">PID \${item.pid}</span>
              <span class="\${protectionClass}">\${item.protected ? "已绑定保护" : "未绑定保护"}</span>
            </td>
            <td class="cell-tty" data-label="TTY"><code>\${escapeHtml(item.tty)}</code></td>
            <td class="cell-summary" data-label="会话摘要">
              <span class="summary-text">\${escapeHtml(summaryText)}</span>
              <span class="summary-time">\${escapeHtml(summaryTime)}</span>
              <span class="cell-subtitle" title="\${escapeHtml(sessionId || "未知")}">会话 ID：\${escapeHtml(shortSessionId(sessionId))}</span>
            </td>
            <td class="cell-cwd" data-label="工作目录"><code>\${escapeHtml(item.cwd)}</code></td>
            <td class="cell-status \${watchClass}" data-label="状态">
              <span class="cell-title">\${escapeHtml(watchLabel)}</span>
              <span class="cell-subtitle">\${escapeHtml(item.ghosttyTerminalName || "未绑定 Ghostty 终端")}</span>
              <span class="cell-subtitle">\${escapeHtml(resumeText)}</span>
            </td>
            <td class="cell-actions" data-label="操作"><div class="actions">
              <button data-action="bind" data-pid="\${item.pid}" \${bindDisabled}>绑定终端</button>
              <button data-action="\${watchAction}" data-pid="\${item.pid}" \${watchDisabled}>\${watchButtonLabel}</button>
            </div></td>
          </tr>\`;
        }).join("");
      }

      async function refreshProcesses(message) {
        if (refreshInFlight) {
          return refreshInFlight;
        }

        if (message) {
          setStatus(message);
        }

        clearRefreshTimer();
        refreshButton.disabled = true;
        refreshInFlight = (async () => {
          try {
            const json = await fetchJson("/api/processes");
            render(json.processes || []);
            setStatus("列表已更新：" + new Date().toLocaleTimeString("zh-CN"));
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), true);
          } finally {
            refreshButton.disabled = false;
            refreshInFlight = null;
            scheduleRefresh();
          }
        })();

        return refreshInFlight;
      }

      rows.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const pid = Number(button.dataset.pid);
        const action = button.dataset.action;

        try {
          button.disabled = true;

          if (action === "bind") {
            const bound = await bindProcessFromUi(pid);

            if (bound) {
              await refreshProcesses("已绑定进程 " + pid);
            }
          }

          if (action === "watch-start") {
            await fetchJson("/api/watch/start", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ pid }),
            });
            await refreshProcesses("已启动监听，进程 " + pid);
          }

          if (action === "watch-stop") {
            await fetchJson("/api/watch/stop", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ pid }),
            });
            await refreshProcesses("已关闭监听，进程 " + pid);
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), true);
        } finally {
          button.disabled = false;
        }
      });

      refreshButton.addEventListener("click", () => {
        void refreshProcesses("正在刷新列表...");
      });

      refreshIntervalSelect.addEventListener("change", () => {
        const interval = selectedRefreshInterval();
        scheduleRefresh();
        setStatus("自动刷新频率已切换为 " + formatRefreshInterval(interval));
      });

      void refreshProcesses();
    </script>
    </main>
  </body>
</html>`;
}

export function createWebServer(
  overrides: Partial<WebDeps> = {},
): {
  server: http.Server;
  close(): Promise<void>;
} {
  const deps: WebDeps = {
    ...createDefaultWebDeps(),
    ...overrides,
  };
  const watches = new Map<number, WatchRuntime>();

  const getOrCreateWatch = (pid: number): WatchRuntime => {
    const existing = watches.get(pid);

    if (existing) {
      return existing;
    }

    const next = createWatchRuntime(deps.now());
    watches.set(pid, next);
    return next;
  };

  const getWatchStatus = (pid: number): WatchStatus => {
    const watch = watches.get(pid);

    if (!watch) {
      return {
        running: false,
        lastMessage: "",
        lastUpdatedAt: "",
      };
    }

    return {
      running: watch.running,
      lastMessage: watch.lastMessage,
      lastUpdatedAt: watch.lastUpdatedAt,
    };
  };

  const listProcesses = async () => {
    const [state, processes] = await Promise.all([
      deps.loadState().catch(() => createEmptyState()),
      deps.listCodexProcesses(),
    ]);
    const bindingsByPid = new Map(
      state.bindings.map((binding) => [binding.pid, binding]),
    );
    const summaries = await Promise.all(
      processes.map(async (codexProcess) => {
        if (!codexProcess.sessionFile) {
          return {
            preview: "暂无会话摘要",
            lastActivityAt: "",
          };
        }

        const content = await readOptionalTextFile(deps, codexProcess.sessionFile);
        return summarizeSessionText(content);
      }),
    );

    return processes.map((codexProcess, index) => {
      const binding = bindingsByPid.get(codexProcess.pid);

      return {
        ...codexProcess,
        protected: Boolean(binding),
        ghosttyTerminalName: binding?.ghosttyTerminalName ?? "",
        resumeCount: binding?.resumeCount ?? 0,
        maxAutoResume: 0,
        summary: summaries[index],
        watch: getWatchStatus(codexProcess.pid),
      };
    });
  };

  const bindProcess = async (
    pid: number,
    terminalId?: string,
  ): Promise<BindResult> => {
    const [state, processes, terminals] = await Promise.all([
      deps.loadState(),
      deps.listCodexProcesses(),
      deps.listGhosttyTerminals(),
    ]);
    const codexProcess = processes.find((item) => item.pid === pid);

    if (!codexProcess) {
      throw new Error(`未找到 pid ${pid} 对应的 Codex 进程`);
    }

    const resolution = resolveTerminalCandidate(
      codexProcess,
      terminals,
      terminalId || undefined,
    );

    if (resolution.status === "selected") {
      await deps.saveState(
        upsertBinding(state, buildBinding(codexProcess, resolution.terminal)),
      );

      return {
        status: "bound",
      };
    }

    if (
      resolution.status === "ambiguous" ||
      resolution.status === "invalid-selection"
    ) {
      return {
        status: "selection-required",
        candidates: resolution.candidates,
      };
    }

    if (resolution.status === "not-found") {
      throw new Error(`无法为 pid ${pid} 唯一定位 Ghostty 终端`);
    }

    throw new Error(`无法为 pid ${pid} 唯一定位 Ghostty 终端`);
  };

  const runWatch = async (pid: number): Promise<void> => {
    const watch = getOrCreateWatch(pid);

    watch.stopRequested = false;
    watch.running = true;
    watch.lastMessage = "监听启动中";
    watch.lastUpdatedAt = isoTime(deps.now());

    while (!watch.stopRequested) {
      let state = await deps.loadState();
      let binding = state.bindings.find((item) => item.pid === pid);

      if (!binding) {
        watch.running = false;
        watch.lastMessage = "已停止：未找到已保存的绑定";
        watch.lastUpdatedAt = isoTime(deps.now());
        return;
      }

      const tickNow = deps.now();
      const result = await watchBoundProcessOnce(binding, {
        ...deps,
        now: () => tickNow,
      });

      binding = result.binding;
      state = upsertBinding(state, binding);
      await deps.saveState(state);

      watch.running = result.processAlive;
      watch.lastMessage = formatWatchStatus(result);
      watch.lastUpdatedAt = isoTime(tickNow);

      if (!result.processAlive) {
        watch.running = false;
        return;
      }

      await deps.sleep(WATCH_INTERVAL_MS);
    }

    watch.running = false;
    watch.lastMessage = "已停止：监听已关闭";
    watch.lastUpdatedAt = isoTime(deps.now());
  };

  const startWatch = async (pid: number): Promise<void> => {
    const state = await deps.loadState();
    const binding = state.bindings.find((item) => item.pid === pid);

    if (!binding) {
      throw new Error(`未找到 pid ${pid} 的已保存绑定`);
    }

    const watch = getOrCreateWatch(pid);

    if (watch.running) {
      return;
    }

    watch.task = runWatch(pid)
      .catch((error) => {
        watch.running = false;
        watch.lastMessage = `错误：${errorMessage(error)}`;
        watch.lastUpdatedAt = isoTime(deps.now());
      })
      .finally(() => {
        watch.task = null;
      });
  };

  const stopWatch = async (pid: number): Promise<void> => {
    const watch = getOrCreateWatch(pid);

    watch.stopRequested = true;
    watch.running = false;
    watch.lastMessage = "已停止：监听已关闭";
    watch.lastUpdatedAt = isoTime(deps.now());
  };

  const server = http.createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (method === "GET" && url.pathname === "/") {
        sendHtml(response, pageHtml());
        return;
      }

      if (method === "GET" && url.pathname === "/api/processes") {
        sendJson(response, 200, {
          processes: await listProcesses(),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/bind") {
        const body = (await readJsonBody(request)) as {
          pid?: number;
          terminalId?: string;
        };
        const pid = Number(body.pid);
        const terminalId =
          typeof body.terminalId === "string" ? body.terminalId.trim() : "";

        if (!Number.isInteger(pid) || pid <= 0) {
          sendJson(response, 400, {
            ok: false,
            error: "绑定操作需要有效的数字 pid",
          });
          return;
        }

        const result = await bindProcess(pid, terminalId || undefined);

        if (result.status === "selection-required") {
          sendJson(response, 409, {
            ok: false,
            error: `无法为 pid ${pid} 唯一定位 Ghostty 终端`,
            code: "terminal-selection-required",
            candidates: result.candidates,
          });
          return;
        }

        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "POST" && url.pathname === "/api/watch/start") {
        const body = (await readJsonBody(request)) as { pid?: number };
        const pid = Number(body.pid);

        if (!Number.isInteger(pid) || pid <= 0) {
          sendJson(response, 400, {
            ok: false,
            error: "监听操作需要有效的数字 pid",
          });
          return;
        }

        await startWatch(pid);
        sendJson(response, 202, { ok: true });
        return;
      }

      if (method === "POST" && url.pathname === "/api/watch/stop") {
        const body = (await readJsonBody(request)) as { pid?: number };
        const pid = Number(body.pid);

        if (!Number.isInteger(pid) || pid <= 0) {
          sendJson(response, 400, {
            ok: false,
            error: "关闭监听操作需要有效的数字 pid",
          });
          return;
        }

        await stopWatch(pid);
        sendJson(response, 202, { ok: true });
        return;
      }

      sendJson(response, 404, {
        ok: false,
        error: "请求路径不存在",
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: errorMessage(error),
      });
    }
  });

  server.on("close", () => {
    for (const watch of watches.values()) {
      watch.stopRequested = true;
      watch.running = false;
    }
  });

  return {
    server,
    close: () =>
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

if (require.main === module) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const { server } = createWebServer();

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
      `Codex 守护台已启动：http://127.0.0.1:${port}\n`,
    );
  });
}
