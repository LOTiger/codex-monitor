# Auto Confirm And Background Watch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic `y` confirmation for implementation-approval prompts and then run the guard watcher as a background process for the current saved binding.

**Architecture:** Extend session summarization so monitor logic can detect assistant confirmation prompts independently from recoverable-error detection. Keep auto-confirm state separate from resume cooldown state, reuse the existing terminal injection path, and only start the watcher in the shell background after build and test verification.

**Tech Stack:** TypeScript, Node.js test runner, Ghostty AppleScript integration

---

### Task 1: Detect Confirmation Prompts In Session Records

**Files:**
- Modify: `src/session-files.ts`
- Test: `test/monitor.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add confirmation prompt extraction and summary fields**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Trigger Auto Confirm In Monitor Logic

**Files:**
- Modify: `src/monitor.ts`
- Modify: `src/types.ts`
- Modify: `src/cli.ts`
- Modify: `src/web.ts`
- Test: `test/monitor.test.ts`
- Test: `test/watch-command.test.ts`
- Test: `test/web.test.ts`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Add binding defaults and monitor decision path for auto-confirm**
- [ ] **Step 4: Run tests to verify they pass**

### Task 3: Verify, Build, And Start Background Watch

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full test suite**
- [ ] **Step 2: Run the build**
- [ ] **Step 3: Document the auto-confirm behavior briefly**
- [ ] **Step 4: Start `watch` in the shell background for the current saved binding**
