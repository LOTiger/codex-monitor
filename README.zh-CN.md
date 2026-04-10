# Codex Guard

[English](./README.md) | [简体中文](./README.zh-CN.md)

本项目用于在 macOS + Ghostty 场景下守护 Codex 会话。

它会发现当前机器上的 Codex 进程，把指定进程绑定到对应的 Ghostty 终端，并在以下场景自动补发继续提示词：

- 输出中断
- 网络或上下文异常导致会话停住
- 会话仍有待完成任务，但长时间没有新输出
- 助手询问是否继续实施/执行改动时自动输入 `y`

默认继续提示词：

```text
继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。
```

## 环境要求

- macOS
- Ghostty
- 本机正在运行 Codex CLI
- 当前用户可访问 `~/.codex` 下的会话和日志

默认目录：

- `CODEX_HOME=~/.codex`
- `CODEX_GUARD_HOME=~/.codex-guard`
- 状态文件：`~/.codex-guard/state.json`

## 安装

```bash
npm install
npm run build
```

## CLI 用法

查看帮助：

```bash
node dist/cli.js --help
```

查看当前 Codex 进程：

```bash
node dist/cli.js list
```

绑定指定进程：

```bash
node dist/cli.js bind <pid>
```

示例：

```bash
node dist/cli.js bind 58256
```

启动持续监听：

```bash
node dist/cli.js watch <pid>
```

只执行一次检测：

```bash
node dist/cli.js watch <pid> --once
```

手动触发一次继续：

```bash
node dist/cli.js trigger <pid>
```

推荐命令行流程：

```bash
node dist/cli.js list
node dist/cli.js bind 58256
node dist/cli.js watch 58256
```

## Web 控制台

启动：

```bash
npm run web
```

默认地址：

```text
http://127.0.0.1:4312
```

自定义端口：

```bash
PORT=4312 npm run web
```

当前页面支持：

- 查看本机所有 Codex 进程
- 显示 `PID / TTY / 会话摘要 / 工作目录 / 状态`
- 显示最近活动时间、会话短 ID、触发次数
- 绑定终端
- 启动监听
- 自动刷新，默认 `1 分钟`

自动刷新频率可选：

- `15 秒`
- `30 秒`
- `1 分钟`
- `5 分钟`
- `关闭`

推荐 Web 流程：

1. 启动 `npm run web`
2. 打开 `http://127.0.0.1:4312`
3. 找到目标 Codex 进程
4. 点击“绑定终端”
5. 点击“启动监听”

## 自动恢复规则

当前默认参数：

- 轮询频率：`5s`
- 空闲超时：`120s`
- 冷却时间：`180s`
- 自动继续上限：无限

会触发自动继续的两类情况：

1. 命中可恢复错误，例如：
   `stream interrupted`、`timed out`、`connection lost`、`error`、`failed`
2. 会话仍有待完成任务，但超过 `120s` 没有新活动

冷却期内不会重复触发。

另外，守护进程还会识别类似 `Ready to execute?`、`是否实施` 这类确认型提示，并自动向绑定终端输入 `y`。同一条确认提示只会自动确认一次。

## 绑定规则

`bind <pid>` 成功的前提：

- 该 `pid` 是有效的 Codex 进程
- Ghostty 中存在同工作目录终端
- 同工作目录终端必须能唯一匹配，或者你显式指定 `terminal-id`

如果同一目录开了多个 Ghostty 标签页，且标题也无法唯一判定：

- Web 控制台会弹出候选终端列表，让你选择要绑定的终端
- CLI 可以执行 `bind <pid> <terminal-id>` 完成绑定

## 常见问题

### `bind` 失败

通常是下面几类原因：

- 进程不存在
- 进程不是 Codex
- 找不到对应 Ghostty 终端
- 候选 Ghostty 终端不唯一

如果 CLI 输出了候选终端列表，复制其中一个 `terminal-id` 重新执行 `bind <pid> <terminal-id>` 即可。

### `watch` 提示 `No saved binding found`

说明你还没有先执行 `bind`。

### 已绑定但没有自动恢复

优先检查：

- 进程是否仍在运行
- Ghostty 是否仍在运行
- 会话文件和 `codex-tui.log` 是否还在更新
- 是否处于冷却期

### 绑定关系错了怎么清理

当前版本帮助文本里会显示 `unbind` 和 `daemon`，但这两个命令还没有实现。

如果你要清空绑定状态，可以删除状态文件：

```bash
rm -f ~/.codex-guard/state.json
```

然后重新执行 `bind`。

## 相关源码

- `src/cli.ts`：命令行入口
- `src/web.ts`：Web 控制台
- `src/detector.ts`：恢复判定逻辑
- `src/monitor.ts`：监听执行逻辑
- `src/process-discovery.ts`：Codex 进程发现
- `src/ghostty.ts`：Ghostty 集成
- `src/state.ts`：状态存储
