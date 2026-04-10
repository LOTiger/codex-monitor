# Codex Guard Design

## Goal

Build a macOS-only CLI that can discover currently running interactive `codex` processes, bind a specific process to a Ghostty terminal surface, monitor Codex session activity for interruption signals, and automatically inject a fixed "continue" prompt when the session stalls or logs a recoverable error.

## Constraints

- Platform scope is this machine only: macOS.
- Terminal scope is Ghostty only.
- Target processes are already-running interactive `codex` CLI sessions.
- Recovery action is fixed text injection into the original Ghostty terminal, followed by Enter.
- Idle interruption threshold is 120 seconds.
- The tool must avoid unsafe blind PTY injection.

## Key Findings

### Codex observability

- Running `codex` processes expose `pid`, `tty`, and command line via `ps`.
- `lsof -p <pid>` exposes the current working directory, the attached TTY device, and the active session JSONL file under `~/.codex/sessions/...jsonl`.
- The active session JSONL contains structured events such as `agent_message`, `agent_reasoning`, `function_call`, `function_call_output`, `task_started`, and `task_complete`.
- Global Codex logs in `~/.codex/log/codex-tui.log` include thread-scoped error and warning lines keyed by `thread_id=<session_id>`.

### Recovery path

- Direct PTY input injection with `TIOCSTI` is not reliable on this macOS environment and returns permission errors when targeting another session.
- Ghostty exposes AppleScript support with addressable `terminal` objects and commands including:
  - `input text ... to terminal id ...`
  - `send key "enter" to terminal id ...`
- Ghostty terminal scripting exposes `id`, `name`, and `working directory`, which is enough for a safe binding flow but not enough for a guaranteed zero-interaction PID-to-terminal mapping in all cases.

## Recommended Approach

Use local Codex session/log files for monitoring and Ghostty AppleScript for recovery.

### Why this approach

- It works with already-running `codex` processes.
- It avoids unreliable TTY scraping and unsafe kernel-level injection tricks.
- It keeps the detection side deterministic by relying on Codex's own persisted artifacts.
- It keeps the recovery side deterministic by targeting a specific Ghostty terminal ID after a one-time bind.

## User-Facing Commands

- `codex-guard list`
  - Show discovered `codex` processes with PID, TTY, cwd, session ID, session file, and protection status.
- `codex-guard bind <pid>`
  - Bind a discovered process to a Ghostty terminal. Prefer automatic matching by cwd; fall back to candidate selection.
- `codex-guard watch <pid>`
  - Foreground monitor for one bound process.
- `codex-guard trigger <pid>`
  - Manually send the fixed continue prompt to the bound terminal.
- `codex-guard unbind <pid>`
  - Remove a saved binding.
- `codex-guard daemon start|run|stop|status`
  - Background monitoring lifecycle for all bindings.

## Binding Model

Each protected process stores:

- `pid`
- `tty`
- `cwd`
- `session_id`
- `session_file`
- `ghostty_terminal_id`
- `ghostty_terminal_name`
- `prompt`
- `idle_timeout_seconds`
- `cooldown_seconds`
- `max_auto_resume`
- `resume_count`
- `last_activity_at`
- `last_resume_at`
- `session_offset`
- `log_offset`

State is stored at `~/.codex-guard/state.json`.

## Detection Rules

### Normal activity

The monitor refreshes `last_activity_at` when new session events arrive for:

- `event_msg.agent_message`
- `event_msg.agent_reasoning`
- `event_msg.task_started`
- `event_msg.task_complete`
- `response_item.function_call`
- `response_item.function_call_output`
- `response_item.message`
- `response_item.reasoning`

### Recoverable interruption

Trigger recovery when either condition is met:

1. A new Codex log line for the same `session_id` matches a recoverable anomaly pattern, such as:
   - `Function call output is missing`
   - `stream interrupted`
   - connection reset/closed/lost
   - timeout
   - explicit `error` or `failed` lines from the session loop
2. The process is still alive, but no new activity has been recorded for 120 seconds after a previously active session.

### Safety guards

- Only trigger recovery for a still-running process.
- Apply a cooldown window between automatic injections.
- Cap automatic retries per binding.
- If the cap is reached, keep reporting the interruption but stop injecting prompts.

## Recovery Prompt

Default fixed prompt:

`继续，刚才中断了。请从上次停下的位置继续，不要重复已经完成的内容。`

## Architecture

### `src/process-discovery.ts`

- Find running `codex` processes.
- Resolve cwd, tty, session file, and session metadata.

### `src/session-files.ts`

- Parse session JSONL lines.
- Read appended events from a saved offset.
- Determine latest activity timestamps.

### `src/ghostty.ts`

- Enumerate Ghostty terminals via AppleScript.
- Resolve terminal candidates.
- Inject text and Enter into a bound terminal.

### `src/state.ts`

- Persist and update bindings in `~/.codex-guard/state.json`.

### `src/detector.ts`

- Turn session/log deltas into `activity`, `idle`, `error`, or `resume-suppressed` decisions.

### `src/monitor.ts`

- Poll bindings, evaluate detector state, and trigger recovery when allowed.

### `src/cli.ts`

- Parse commands and render user-facing output.

## Error Handling

- Missing Ghostty terminal ID: refuse recovery and ask for re-bind.
- Missing session file: show bind/process is stale.
- Exited process: do not inject; surface exited status.
- Ambiguous Ghostty match during bind: present candidates and require explicit choice.
- AppleScript failure: report the exact `osascript` stderr and keep the binding unchanged.

## Testing Strategy

### Unit tests

- Parse `ps` and `lsof` outputs.
- Parse session JSONL deltas and timestamps.
- Parse Ghostty AppleScript terminal output.
- Detect interruption, idle timeout, cooldown suppression, and retry exhaustion.

### Integration-style tests with fakes

- Mock command runners for `ps`, `lsof`, and `osascript`.
- Verify `bind` picks the correct terminal candidate.
- Verify `trigger` generates the correct Ghostty input action.
- Verify monitor loop issues exactly one recovery during an interruption scenario.

## Demo Strategy

- Show `list` against real local `codex` processes.
- Show `bind` against a discovered process in the current `monitor` directory.
- Show automated recovery behavior with fixture-backed session and log inputs.

## Deferred Scope

- Linux support
- Terminal support beyond Ghostty
- Fully automatic PID-to-terminal mapping without a bind step
- Resuming exited `codex` processes with `codex resume`
- GUI dashboard
