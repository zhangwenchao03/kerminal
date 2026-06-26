# Agent Launcher Kitty Keyboard Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable kitty keyboard protocol in Agent Launcher (right-side panel) terminals so that `Shift+Enter` properly inserts a newline instead of submitting, matching the behavior of system terminals.

**Architecture:** When `inputCompatibilityMode === "agentTui"`, push the kitty keyboard protocol enable sequence (`\x1b[>1u`) into the xterm.js instance immediately after `terminal.open()`, and set `terminal.options.modifyOtherKeys = 2`. This makes xterm.js encode `Shift+Enter` as the kitty sequence `\x1b[13;2u` instead of the default `\r`. Shell-mode terminals (`inputCompatibilityMode === "shell"`) are untouched.

**Tech Stack:** React + TypeScript frontend, xterm.js 6 (`@xterm/xterm`), vitest + @testing-library/react. No backend changes.

---

## File Structure

This plan modifies 3 files and extends 2 existing test files:

| File | Change |
|---|---|
| `src/features/terminal/terminalKeyboardPolicy.ts` | Add `KITTY_KEYBOARD_PROTOCOL_ENABLE` constant and `shouldEnableKittyKeyboardProtocol(mode)` helper. |
| `src/features/terminal/XtermPane.runtime.ts` | After `terminal.open(container)`, conditionally write the kitty enable sequence. |
| `src/features/terminal/XtermPane.tsx` | Extend the `terminalAppearance` sync `useEffect` to also set `modifyOtherKeys` based on `inputCompatibilityMode`, and add `inputCompatibilityMode` to its dependency array. |
| `src/features/terminal/terminalKeyboardPolicy.test.ts` | Add tests for `KITTY_KEYBOARD_PROTOCOL_ENABLE` value and `shouldEnableKittyKeyboardProtocol` logic. |
| `src/features/terminal/XtermPane.inputCompatibility.test.tsx` | Add tests verifying `terminal.write("\x1b[>1u")` is called for `agentTui` mode, not for `shell` mode. |

Files NOT changed (intentionally):
- `src/features/terminal/terminalInputModel.ts` — kit
- `src/features/terminal/terminalKeyboardPolicy.ts:shiftEnter case` — retained as defensive layer
- Rust backend, `XtermPane.helpers.ts`, `keybindingUtils.ts`

---

## Task 1: Add kitty constants and helper to terminalKeyboardPolicy

**Files:**
- Modify: `src/features/terminal/terminalKeyboardPolicy.ts:1-15` (add exports near the type aliases)

- [ ] **Step 1: Write the failing test for the new constant and helper**

Open `src/features/terminal/terminalKeyboardPolicy.test.ts`. Add a new `describe` block at the end of the existing `describe("terminalKeyboardPolicy", ...)` block (just before the closing `});` on line 137). Insert these tests:

```ts
  it("exposes the kitty keyboard protocol enable sequence constant", () => {
    expect(KITTY_KEYBOARD_PROTOCOL_ENABLE).toBe("\x1b[>1u");
  });

  it("enables kitty keyboard protocol only for agentTui mode", () => {
    expect(shouldEnableKittyKeyboardProtocol("agentTui")).toBe(true);
    expect(shouldEnableKittyKeyboardProtocol("shell")).toBe(false);
  });
```

Also update the import at the top of the file (line 2-10). Change:

```ts
import {
  TERMINAL_KEYBOARD_COMPATIBILITY_CASES,
  describeTerminalKeyboardData,
  findTerminalKeyboardCompatibilityCase,
  resolveTerminalInputCompatibilityOverride,
  resolveTerminalRuntimeKeydownOverride,
  shouldAppKeybindingYieldForTerminalFocus,
  type TerminalKeyboardCompatibilityCase,
} from "./terminalKeyboardPolicy";
```

To:

```ts
import {
  KITTY_KEYBOARD_PROTOCOL_ENABLE,
  TERMINAL_KEYBOARD_COMPATIBILITY_CASES,
  describeTerminalKeyboardData,
  findTerminalKeyboardCompatibilityCase,
  resolveTerminalInputCompatibilityOverride,
  resolveTerminalRuntimeKeydownOverride,
  shouldAppKeybindingYieldForTerminalFocus,
  shouldEnableKittyKeyboardProtocol,
  type TerminalKeyboardCompatibilityCase,
} from "./terminalKeyboardPolicy";
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/features/terminal/terminalKeyboardPolicy.test.ts`
Expected: FAIL — `KITTY_KEYBOARD_PROTOCOL_ENABLE` and `shouldEnableKittyKeyboardProtocol` are not exported from `./terminalKeyboardPolicy`. TypeScript compile error: "Module has no exported member".

- [ ] **Step 3: Implement the constant and helper**

Open `src/features/terminal/terminalKeyboardPolicy.ts`. Add the following at the end of the file (after line 283, after `terminalKeyboardEventMatchesDescriptor`):

```ts
export const KITTY_KEYBOARD_PROTOCOL_ENABLE = "\x1b[>1u";

export function shouldEnableKittyKeyboardProtocol(
  mode: TerminalInputCompatibilityMode,
): boolean {
  return mode === "agentTui";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/terminal/terminalKeyboardPolicy.test.ts`
Expected: PASS — all tests including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/terminalKeyboardPolicy.ts src/features/terminal/terminalKeyboardPolicy.test.ts
git commit -m "feat(terminal): add kitty keyboard protocol enable sequence and helper"
```

---

## Task 2: Push kitty enable sequence from XtermPane.runtime.ts

**Files:**
- Modify: `src/features/terminal/XtermPane.runtime.ts:554-556` (after `terminal.open(container)` and `terminalRef.current = terminal;`)
- Modify: `src/features/terminal/XtermPane.runtime.ts:1-27` (add import — verify the file already imports from `./terminalKeyboardPolicy`; if not, add it)

- [ ] **Step 1: Inspect the existing import to know where to add**

Run: `grep -n "terminalKeyboardPolicy" src/features/terminal/XtermPane.runtime.ts`
Expected output: a line like `import { ... } from "./terminalKeyboardPolicy";` (verify the file already imports from this module). If yes, just extend the existing import. If no, add a new import.

The existing import (from prior exploration) is at the top of the file. Extend it to include `KITTY_KEYBOARD_PROTOCOL_ENABLE` and `shouldEnableKittyKeyboardProtocol`. The exact lines vary — match the existing import style. Final import block should include both new names alongside whatever is already imported from that module.

- [ ] **Step 2: Add the kitty enable write after terminal.open**

In `src/features/terminal/XtermPane.runtime.ts`, locate the `terminal.open(container);` line (currently around line 554). Immediately after `terminalRef.current = terminal;` (line 555), add:

```ts
    if (shouldEnableKittyKeyboardProtocol(inputCompatibilityMode)) {
      terminal.write(KITTY_KEYBOARD_PROTOCOL_ENABLE);
    }
```

The `inputCompatibilityMode` variable is already defined at lines 46-47 of this file as a local variable inside `installXtermPaneRuntime`.

- [ ] **Step 3: Run typecheck to verify the change compiles**

Run: `npm run typecheck`
Expected: PASS — no type errors. (vitest tests are not run here because runtime tests require DOM mocking.)

- [ ] **Step 4: Run existing input compatibility tests to verify no regression**

Run: `npx vitest run src/features/terminal/XtermPane.inputCompatibility.test.tsx`
Expected: PASS — all existing tests still pass. The new `terminal.write` call should not interfere with existing assertions (they check `writeTerminal` mock, not `terminal.write`).

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/XtermPane.runtime.ts
git commit -m "feat(terminal): enable kitty keyboard protocol for agentTui mode"
```

---

## Task 3: Sync modifyOtherKeys option in XtermPane.tsx

**Files:**
- Modify: `src/features/terminal/XtermPane.tsx:489-510` (the useEffect that syncs `terminalAppearance` to `terminal.options`)
- Modify: `src/features/terminal/XtermPane.tsx:510` (the dependency array of that useEffect)

- [ ] **Step 1: Verify the existing imports**

Run: `grep -n "from \"./terminalKeyboardPolicy\"\|TerminalInputCompatibilityMode" src/features/terminal/XtermPane.tsx | head -5`
Expected: at least one import of `TerminalInputCompatibilityMode` type from `./terminalKeyboardPolicy`. (If the import line does not include the new `KITTY_KEYBOARD_PROTOCOL_ENABLE` constant or `shouldEnableKittyKeyboardProtocol` helper, extend it — but neither is needed in this file; we only need the existing `TerminalInputCompatibilityMode` type. **No import changes needed for this task**.)

- [ ] **Step 2: Add `modifyOtherKeys` sync line**

In `src/features/terminal/XtermPane.tsx`, locate the useEffect starting at line 483-510:

```tsx
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.cursorBlink = terminalAppearance.cursorBlink;
    terminal.options.cursorStyle = terminalAppearance.cursorStyle;
    terminal.options.fontFamily = terminalAppearance.fontFamily;
    terminal.options.fontSize = terminalAppearance.fontSize;
    terminal.options.fontWeight = terminalFontWeight;
    terminal.options.fontWeightBold = 700;
    terminal.options.lineHeight = terminalAppearance.lineHeight;
    terminal.options.macOptionIsMeta = terminalAppearance.macOptionIsMeta;
    terminal.options.scrollback = terminalAppearance.scrollback;
    terminal.options.theme = terminalTheme;
    if (containerRef.current) {
      containerRef.current.style.fontFamily = terminalAppearance.fontFamily;
    }
    fitAddonRef.current?.fit();
    terminal.refresh?.(0, Math.max(0, terminal.rows - 1));
    const dimensions = { cols: terminal.cols, rows: terminal.rows };
    const sessionId = sessionIdRef.current;
    onTerminalDimensionsChangeRef.current?.(dimensions);
    if (sessionId) {
      void resizeTerminal(sessionId, dimensions);
    }
  }, [terminalAppearance, terminalFontWeight, terminalTheme]);
```

Make two changes:

1. After the line `terminal.options.theme = terminalTheme;` (and before `if (containerRef.current)`), add:

```tsx
    terminal.options.modifyOtherKeys =
      inputCompatibilityMode === "agentTui" ? 2 : 0;
```

2. Update the dependency array at line 510 from:

```tsx
  }, [terminalAppearance, terminalFontWeight, terminalTheme]);
```

To:

```tsx
  }, [inputCompatibilityMode, terminalAppearance, terminalFontWeight, terminalTheme]);
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run all XtermPane tests to verify no regression**

Run: `npx vitest run src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/terminal/XtermPane.tsx
git commit -m "feat(terminal): sync modifyOtherKeys option based on inputCompatibilityMode"
```

---

## Task 4: Reset terminal.write spy in test setup

**Files:**
- Modify: `src/features/terminal/__tests__/support/XtermPane.testSupport.tsx:553-554` (existing `mockReset` block)

This task ensures the existing `terminal.write` spy (already declared at `XtermPane.testSupport.tsx:112` as `write = vi.fn((_data, callback?) => {...})`) is reset between tests so the new kitty-related assertions in Task 5 are reliable.

- [ ] **Step 1: Locate the existing mockReset block**

Open `src/features/terminal/__tests__/support/XtermPane.testSupport.tsx`. Locate the existing reset block at lines 553-554:

```ts
  mocks.api.writeDesktopClipboardText.mockReset();
  mocks.api.writeTerminal.mockReset();
```

This block is inside a setup function (likely `beforeEach` or a custom setup helper — match the surrounding style).

- [ ] **Step 2: Add reset for all terminal.write spies**

Immediately after `mocks.api.writeTerminal.mockReset();`, add:

```ts
  mocks.terminalInstances.forEach((terminal) => terminal.write.mockReset());
```

This resets the spy on every mock terminal instance, so test ordering cannot leak state.

- [ ] **Step 3: Run existing tests to verify the reset change does not break anything**

Run: `npx vitest run src/features/terminal/XtermPane.inputCompatibility.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/terminal/__tests__/support/XtermPane.testSupport.tsx
git commit -m "test(terminal): reset terminal.write spy between tests"
```

---

## Task 5: Add integration tests for kitty enable sequence

**Files:**
- Modify: `src/features/terminal/XtermPane.inputCompatibility.test.tsx` (add tests after existing `describe` block)

- [ ] **Step 1: Add the failing tests**

Open `src/features/terminal/XtermPane.inputCompatibility.test.tsx`. Locate the end of the `describe("XtermPane input compatibility", () => { ... })` block. Add these tests just before its closing `});`:

```tsx
  it("writes the kitty keyboard protocol enable sequence for Agent TUI mode", async () => {
    render(
      <XtermPane
        focused
        inputCompatibilityMode="agentTui"
        paneId="pane-agent-codex-kitty"
        resolvedTheme="dark"
        shellAssistEnabled={false}
        terminalAppearance={defaultAppSettings.terminal}
        title="Codex"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    expect(terminal.write).toHaveBeenCalledWith("\x1b[>1u");
    expect(terminal.options.modifyOtherKeys).toBe(2);
  });

  it("does not write the kitty keyboard protocol enable sequence for shell mode", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-shell-kitty"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    expect(terminal.write).not.toHaveBeenCalledWith("\x1b[>1u");
    expect(terminal.options.modifyOtherKeys).toBe(0);
  });
```

Note: Each test renders its own `XtermPane`, so `mocks.terminalInstances[0]` is the freshly-created mock for that test. This matches the pattern in existing tests at `XtermPane.inputCompatibility.test.tsx:25, 54, 84`.

- [ ] **Step 2: Run the new tests to verify they pass**

Run: `npx vitest run src/features/terminal/XtermPane.inputCompatibility.test.tsx`
Expected: PASS — both new tests pass and all existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/features/terminal/XtermPane.inputCompatibility.test.tsx
git commit -m "test(terminal): verify kitty keyboard protocol is enabled only for agentTui"
```

---

## Task 6: End-to-end verification

**Files:** none (manual verification + automated test runs)

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm run test:frontend`
Expected: PASS — all tests pass.

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke test in dev mode**

Run: `npm run tauri:dev`

Then in the running app:
1. Press `Alt+2` to open Agent Launcher.
2. Click a Codex (or Claude/Kimi) agent icon to launch the TUI.
3. Wait for the TUI prompt to appear.
4. Press `Shift+Enter` — verify the cursor moves to a new line within the input box (does NOT submit).
5. Type a single character, press `Enter` (no Shift) — verify it submits normally.
6. Close the TUI and reopen — verify Shift+Enter still works (the kitty enable sequence is re-sent on each `terminal.open`).

- [ ] **Step 4: Commit any verification artifacts (none expected)**

If no changes were made during verification, skip this step. Otherwise commit with `chore: post-verification tweaks`.

---

## Spec Coverage Check

Walking through the spec section by section:

| Spec section | Covered by |
|---|---|
| Background | (design rationale, no implementation task needed) |
| Goal — Shift+Enter inserts newline | Task 2 (push enable sequence) + Task 3 (modifyOtherKeys option) |
| Non-goals | (no task — explicitly out of scope) |
| Range — agentTui mode only | Task 1 (`shouldEnableKittyKeyboardProtocol` returns true only for agentTui), Task 2 (conditional write), Task 3 (modifyOtherKeys=2 only for agentTui), Task 5 (test asserts both modes) |
| Range — Shift+Enter encodes as `\x1b[13;2u` | Task 2 enables kitty protocol which causes this encoding (no explicit test for the exact byte sequence in Task 5; if verification in Task 6 step 3 fails, add a real-xterm test in a follow-up) |
| Range — other modifiers continue via compatibility cases | (no change — existing `shiftEnter` case retained, explicitly noted) |
| Out-of-scope items | (no task — all explicitly excluded) |
| Decision 1 — aggressive, no fallback | (no task — design decision, no code) |
| Decision 2 — enable on Agent start | Task 2 (write happens after `terminal.open`) |
| Decision 3 — agentTui-only scope | Task 1 helper, Task 3 useEffect, Task 5 tests |
| Architecture — 3 files | Tasks 1, 2, 3 each touch one file |
| Component `terminalKeyboardPolicy.ts` | Task 1 |
| Component `XtermPane.runtime.ts` | Task 2 |
| Component `XtermPane.tsx` | Task 3 |
| Data flow | (documented in spec; no implementation task needed beyond Task 2's write call) |
| Error handling — terminal.write silent failure | (documented; no code change needed — xterm.js 6 swallows errors silently as designed) |
| Error handling — PTY close/reopen | (covered by Task 2 — `terminal.open` is re-invoked on pane rebuild, which re-writes the enable sequence) |
| Tests — unit | Task 1 |
| Tests — integration | Tasks 4 + 5 |
| Tests — manual verification script | (marked stretch goal in spec; omitted from this plan per scope check) |

**Gap:** No automated test verifies the exact byte sequence `\x1b[13;2u` is produced by xterm.js after kitty enable. The spec marks this as stretch (Task 6 step 3 manual verification covers it). If a real-xterm test is desired later, it can use the existing `createRealXtermKeyboardHarness` pattern from `terminalKeyboardPolicy.test.ts:147-192` to test actual xterm behavior. Out of scope for this plan.

---

## Risks & Rollback

- **Risk 1 (accepted):** Old TUIs that don't support kitty will receive `\x1b[13;2u` and may show garbage. Aggressive approach accepted per spec.
- **Risk 2:** `modifyOtherKeys = 2` may have bugs in some xterm.js 6.x versions. Rollback: change `2` to `1` in Task 3 step 2. Level 1 still encodes Shift+Enter but won't encode normal Enter with modifiers.
- **Rollback path:** `git revert` of the 5 commits in this plan restores the previous behavior in one step.

---

## Out of Scope

- Rust backend changes
- Shell-mode terminal behavior changes
- UI toggle / settings option
- Protocol probing / fallback
- `terminalInputModel.ts` changes
- Automated end-to-end test of the exact `\x1b[13;2u` byte sequence