# Codex Guard

[English](./README.md) | [简体中文](./README.zh-CN.md)

This project is designed to guard Codex sessions in a macOS + Ghostty environment.

It discovers Codex processes on the current machine, binds a selected process to the matching Ghostty terminal, and automatically sends a continue prompt in the following cases:

- output is interrupted
- the session stalls because of network or context issues
- the session still has unfinished work, but no new output appears for a long time
- the assistant asks whether to continue implementation or apply changes, in which case it automatically types `y`

Default continue prompt:

```text
Continue, the previous response was interrupted. Please resume from where you stopped and do not repeat work that is already finished.
```

## Requirements

- macOS
- Ghostty
- Codex CLI running locally
- the current user can access sessions and logs under `~/.codex`

Default paths:

- `CODEX_HOME=~/.codex`
- `CODEX_GUARD_HOME=~/.codex-guard`
- state file: `~/.codex-guard/state.json`

## Installation

```bash
npm install
npm run build
```

## CLI Usage

Show help:

```bash
node dist/cli.js --help
```

List current Codex processes:

```bash
node dist/cli.js list
```

Bind a specific process:

```bash
node dist/cli.js bind <pid>
```

Example:

```bash
node dist/cli.js bind 58256
```

Start continuous monitoring:

```bash
node dist/cli.js watch <pid>
```

Run a single check:

```bash
node dist/cli.js watch <pid> --once
```

Manually trigger one continue action:

```bash
node dist/cli.js trigger <pid>
```

Recommended command-line workflow:

```bash
node dist/cli.js list
node dist/cli.js bind 58256
node dist/cli.js watch 58256
```

## Web Console

Start:

```bash
npm run web
```

Default URL:

```text
http://127.0.0.1:4312
```

Custom port:

```bash
PORT=4312 npm run web
```

The current page supports:

- viewing all Codex processes on the machine
- showing `PID / TTY / session summary / working directory / status`
- showing recent activity time, short session ID, and trigger count
- binding a terminal
- starting monitoring
- auto refresh, default `1 minute`

Available auto-refresh intervals:

- `15 seconds`
- `30 seconds`
- `1 minute`
- `5 minutes`
- `Off`

Recommended Web workflow:

1. Start `npm run web`
2. Open `http://127.0.0.1:4312`
3. Find the target Codex process
4. Click `Bind Terminal`
5. Click `Start Watch`

## Auto-Recovery Rules

Current default parameters:

- polling interval: `5s`
- idle timeout: `120s`
- cooldown: `180s`
- auto-continue limit: unlimited

Automatic continue is triggered in two cases:

1. A recoverable error is matched, for example:
   `stream interrupted`, `timed out`, `connection lost`, `error`, `failed`
2. The session still has unfinished work, but there has been no new activity for more than `120s`

No duplicate trigger is sent during the cooldown period.

In addition, the guard process recognizes confirmation prompts such as `Ready to execute?` and `是否实施`, then automatically types `y` into the bound terminal. The same confirmation prompt is auto-confirmed only once.

## Binding Rules

`bind <pid>` succeeds only when:

- the `pid` is a valid Codex process
- a Ghostty terminal with the same working directory exists
- the matching terminal is unique, or you explicitly provide `terminal-id`

If multiple Ghostty tabs are open under the same directory and the title still cannot identify one uniquely:

- the Web console shows a list of candidate terminals for you to choose from
- the CLI can run `bind <pid> <terminal-id>` to complete the binding

## FAQ

### `bind` fails

Common causes:

- the process does not exist
- the process is not Codex
- the matching Ghostty terminal cannot be found
- multiple Ghostty terminals match

If the CLI prints a list of candidate terminals, copy one `terminal-id` and rerun `bind <pid> <terminal-id>`.

### `watch` says `No saved binding found`

This means you have not run `bind` first.

### A process is bound, but auto-recovery does not happen

Check these first:

- whether the process is still running
- whether Ghostty is still running
- whether the session files and `codex-tui.log` are still updating
- whether the guard is in the cooldown period

### How to clear an incorrect binding

The current help text shows `unbind` and `daemon`, but those two commands are not implemented yet.

If you want to clear the binding state, delete the state file:

```bash
rm -f ~/.codex-guard/state.json
```

Then run `bind` again.

## Related Source Files

- `src/cli.ts`: command-line entry
- `src/web.ts`: Web console
- `src/detector.ts`: recovery decision logic
- `src/monitor.ts`: monitoring execution logic
- `src/process-discovery.ts`: Codex process discovery
- `src/ghostty.ts`: Ghostty integration
- `src/state.ts`: state storage
