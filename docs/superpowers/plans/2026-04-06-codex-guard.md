# Codex Guard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS-only `codex-guard` CLI that discovers running Codex sessions, binds a chosen process to a Ghostty terminal, watches for recoverable interruptions, and auto-injects a fixed continue prompt.

**Architecture:** The CLI is a small Node.js/TypeScript program that discovers processes from `ps` and `lsof`, reads Codex activity from session JSONL plus `codex-tui.log`, persists bindings in a local JSON state file, and performs recovery through Ghostty AppleScript. Monitoring runs either in the foreground for one binding or in a detached daemon for all saved bindings.

**Tech Stack:** Node.js, TypeScript, Node built-in modules, `tsx`, Node test runner

---

### Task 1: Scaffold the CLI project and lock in TDD entry points

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/cli.ts`
- Create: `src/types.ts`
- Test: `test/cli-smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**
- [ ] **Step 2: Run the targeted test and confirm it fails**
- [ ] **Step 3: Write the minimal CLI bootstrap**
- [ ] **Step 4: Re-run the targeted test and confirm it passes**

### Task 2: Discover running Codex processes and Codex session metadata

**Files:**
- Create: `src/exec.ts`
- Create: `src/config.ts`
- Create: `src/process-discovery.ts`
- Create: `src/session-files.ts`
- Modify: `src/cli.ts`
- Test: `test/process-discovery.test.ts`

- [ ] **Step 1: Write a failing discovery test**
- [ ] **Step 2: Run the targeted test and confirm it fails**
- [ ] **Step 3: Implement minimal process and session discovery**
- [ ] **Step 4: Re-run the targeted test and confirm it passes**
- [ ] **Step 5: Extend the `list` command**

### Task 3: Add Ghostty terminal discovery and binding persistence

**Files:**
- Create: `src/ghostty.ts`
- Create: `src/state.ts`
- Modify: `src/cli.ts`
- Test: `test/ghostty.test.ts`
- Test: `test/bind-command.test.ts`

- [ ] **Step 1: Write failing Ghostty parsing and bind tests**
- [ ] **Step 2: Run the targeted tests and confirm they fail**
- [ ] **Step 3: Implement minimal Ghostty/state support**
- [ ] **Step 4: Re-run the targeted tests and confirm they pass**
- [ ] **Step 5: Wire `bind`, `unbind`, and protected status in `list`**

### Task 4: Implement interruption detection and manual recovery

**Files:**
- Create: `src/detector.ts`
- Modify: `src/session-files.ts`
- Modify: `src/ghostty.ts`
- Modify: `src/cli.ts`
- Test: `test/detector.test.ts`
- Test: `test/trigger-command.test.ts`

- [ ] **Step 1: Write failing detector and trigger tests**
- [ ] **Step 2: Run the targeted tests and confirm they fail**
- [ ] **Step 3: Implement minimal detector and manual trigger**
- [ ] **Step 4: Re-run the targeted tests and confirm they pass**
- [ ] **Step 5: Add `watch <pid> --once`**

### Task 5: Implement continuous watch and detached daemon management

**Files:**
- Create: `src/monitor.ts`
- Create: `src/daemon.ts`
- Modify: `src/cli.ts`
- Test: `test/watch-command.test.ts`
- Test: `test/daemon.test.ts`

- [ ] **Step 1: Write failing watch and daemon tests**
- [ ] **Step 2: Run the targeted tests and confirm they fail**
- [ ] **Step 3: Implement minimal monitoring loop**
- [ ] **Step 4: Implement detached daemon lifecycle**
- [ ] **Step 5: Re-run the targeted tests and confirm they pass**

### Task 6: Document usage and run final verification

**Files:**
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Write a failing README smoke check**
- [ ] **Step 2: Run the targeted test and confirm it fails**
- [ ] **Step 3: Write the minimal README**
- [ ] **Step 4: Run `npm test && npm run build`**
- [ ] **Step 5: Run live commands against this machine and record results**
