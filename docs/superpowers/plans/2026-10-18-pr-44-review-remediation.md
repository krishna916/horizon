# PR #44 — Issue #19 Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve two behavior bugs and one UI inconsistency identified in the independent review of PR #44 while preserving approved task navigation, data isolation, and layout behavior.

**Architecture:** Keep all fixes in the existing Tasks frontend feature. Anchor Radix's modal drawer to the available Tasks workspace, preserve the user's requested split ratio separately from temporarily clamped display geometry, and keep one visible detail header in both split and overlay modes.

**Tech Stack:** React, TypeScript, Tailwind CSS, Radix Dialog, ResizeObserver, Vitest/React Testing Library, Playwright. No new production libraries or backend changes.

**Spec:** `docs/superpowers/specs/2026-10-18-issue-19-task-detail-design.md`, especially sections 3 and 7; parent implementation plan `docs/superpowers/plans/2026-10-18-issue-19-task-detail.md`. PR: https://github.com/krishna916/horizon/pull/44, reviewed head `41247b8147c9beb33f486ae9d30f0584c4e94a8c`.

## Global Constraints

- Implement on the existing PR branch `feat/issue-19-task-detail-panel`; no worktree or subagents. Use Superpowers `executing-plans` inline as already chosen by the owner.
- Do not extend issue #19 into task creation, editing, lifecycle mutations, mobile redesign, new global state, or backend code.
- Preserve list minimum **480px**, detail minimum **360px**, divider **5px**, and overlay whenever **available Tasks workspace width < 845px**.
- Preserve route-visit-only requested list width, starting **60%/40%**; resize keypress granularity **2 percentage points** where movement is possible.
- Preserve current URL/history behavior, canonical page, task privacy/error feedback, and both themes.
- Keep the existing Radix Dialog accessibility contract: modal focus trap, Escape/backdrop dismissal, and focus restoration.
- Use failing tests before changes; validate focused tests and full frontend suite; commit fixes to the PR branch and push.

## Review Focus

1. **Viewport narrower than sidebar + drawer width** (e.g. viewport 800px, sidebar 256px, Tasks workspace 544px): overlay must not cover the sidebar or global header; backdrop and panel stay within Tasks workspace (Task 1).
2. **Exactly-at-boundary layout** (845px Tasks workspace): list remains 480px, detail remains 360px, divider remains 5px; no spurious overlay or overflow (Tasks 1–2).
3. **Clamped width without real movement** (1024px workspace with 60% request → shrink to 845px → press ArrowRight → re-expand): still restores 60%, not 57.14% (Task 2).
4. **Pointer drag interrupted by responsive change** (split → overlay while dragging): terminate the drag and do not persist values from later pointermove events (Task 2).
5. **Dialog title and controls**: one visible header and Close action; accessible dialog title, full-page action, Escape and keyboard focus retained (Task 3).

---

## File map

- `client/src/task/TaskOverlay.tsx` and `TaskOverlay.test.tsx` — workspace-relative Radix portal/layout and visible header simplification.
- `client/src/task/TaskSplitView.tsx` and `TaskSplitView.test.tsx` — workspace portal host, resize constraints, drag lifecycle and requested-ratio preservation.
- `client/src/task/TaskWorkspace.tsx` / `TaskDetailSurface.tsx` — only if needed to pass the workspace host and present one header without changing read-only detail behavior.
- `client/e2e/task-detail.spec.ts` — real browser geometry/history/focus regressions.
- Do not modify the original approved issue #19 spec to conceal deviations. The remediation plan supplements it.

### Task 1: Constrain modal drawer/backdrop to the Tasks workspace (P2)

**Files:**
- Modify: `client/src/task/TaskOverlay.tsx`
- Modify: `client/src/task/TaskSplitView.tsx`
- Modify: `client/src/task/TaskOverlay.test.tsx`
- Modify: `client/e2e/task-detail.spec.ts`

**Interfaces:**
- `TaskOverlay` must receive a Tasks workspace portal host (an `HTMLElement` supplied by `TaskSplitView`), not use `100vw` for its width.
- Keep the workspace root `position: relative`. Render `Dialog.Portal` in that host with workspace-relative **absolute** backdrop and right-aligned content: width `min(640px, 100%)`, height limited to workspace. Ensure the host is available before rendering the portal. Preserve Radix's modal semantics.
- Use measured/layout workspace bounds, not a hardcoded 256px sidebar subtraction.

- [ ] **Step 1 — Add failing regressions.** Add Playwright at viewport 800×720 with the existing mocked Tasks APIs: open a task, assert `dialog.left >= workspace.left`, `dialog.top >= workspace.top`, `dialog.right <= workspace.right`, `dialog.bottom <= workspace.bottom`; backdrop does not extend into sidebar/header; no horizontal overflow. Keep existing 1100px and 900px overlay checks. Add a component test validating the portal uses the provided workspace root.
- [ ] **Step 2 — Run red.** From `client/`, run `npm run test -- src/task/TaskOverlay.test.tsx src/task/TaskSplitView.test.tsx` and `npm run test:e2e -- task-detail.spec.ts`; at least the new geometry regression must fail against current PR head.
- [ ] **Step 3 — Implement minimum correction.** Anchor portal, backdrop and content to Tasks root, without changing global sidebar, AppShell, header or task detail data. Ensure modal layering does not cause clipping and the backdrop covers only the Tasks content area. Preserve focus-trap and dismissal behavior.
- [ ] **Step 4 — Verify green.** Re-run focused Vitest + Playwright scenarios; test keyboard focus/scroll and mouse backdrop at 800px; run `npm run typecheck`.
- [ ] **Step 5 — Commit.** `git add client/src/task/TaskOverlay.tsx client/src/task/TaskSplitView.tsx client/src/task/TaskOverlay.test.tsx client/src/task/TaskSplitView.test.tsx client/e2e/task-detail.spec.ts && git commit -m "fix(tasks): constrain detail drawer to workspace"`.

### Task 2: Preserve requested split ratio through clamping and interrupted drags (P2)

**Files:**
- Modify: `client/src/task/TaskSplitView.tsx`
- Modify: `client/src/task/TaskSplitView.test.tsx`
- Modify: `client/e2e/task-detail.spec.ts`

**Interfaces:**
- `listRatio` remains the user's **requested** ratio stored by `TasksRouteLayout`; `actualListRatio` is derived from `workspaceWidth` and minimum pane constraints and must never overwrite requested ratio merely because the viewport shrank.
- Keyboard: compute the desired request from `listRatio +/- 2` and clamp to feasible geometry; invoke `onListRatioChange` only when the **visible splitter position actually changes**. At the 845px fixed-width boundary, do not write a ratio if the separator cannot move.
- Pointer: likewise avoid writing on no-op/fully constrained positions. Cancel/clear active pointer drag when workspace enters overlay mode, on pointer cancel/release, and on component unmount. Do not process subsequent pointer events from a canceled drag.

- [ ] **Step 1 — Add failing regressions.** Controlled harness around `TaskSplitView`: at workspace 1024px request 60% → shrink to 845px (480+5+360) → press ArrowRight or ArrowLeft → expand to 1024px; verify requested ratio remains 60% and original geometry returns. Repeat with requested 67%. Start a pointer drag at width 1024px, shrink to 844px, then dispatch pointermove/pointerup and assert no further ratio updates. Verify ordinary ArrowLeft/Right at 1024px still changes by two points.
- [ ] **Step 2 — Run red.** `npm run test -- src/task/TaskSplitView.test.tsx`; expect new regressions to fail on current implementation.
- [ ] **Step 3 — Implement.** Separate desired state from clamped rendering; guard updates against unchanged physical width; clear capture/drag when mode switches to overlay and in cleanup. Keep pointer moves workspace-relative and constrained.
- [ ] **Step 4 — Verify green.** Focused Vitest + `npm run test:e2e -- task-detail.spec.ts` for keyboard/pointer geometry; run `npm run typecheck` and `npm run lint`.
- [ ] **Step 5 — Commit.** `git add client/src/task/TaskSplitView.tsx client/src/task/TaskSplitView.test.tsx client/e2e/task-detail.spec.ts && git commit -m "fix(tasks): retain requested split width across constraints"`.

### Task 3: Remove duplicate modal header and Close controls (P3)

**Files:**
- Modify: `client/src/task/TaskOverlay.tsx`
- Modify: `client/src/task/TaskOverlay.test.tsx`
- Modify: `client/src/task/TaskDetailSurface.tsx` only if necessary
- Modify: `client/e2e/task-detail.spec.ts`

**Interfaces:**
- Keep **one visible header** owned by `TaskDetailSurface` with task key, Open full page, and Close.
- Keep Radix's required accessible title via a **visually hidden** `Dialog.Title` in `TaskOverlay`; do not remove the dialog's accessible name.
- Remove `TaskOverlay`'s duplicate visible heading and extra `Dialog.Close` button. The remaining functional Close button must navigate exactly once; Escape/backdrop still dismiss through `onOpenChange`.

- [ ] **Step 1 — Add failing tests.** Assert exactly one visible `Close task details` button and one visible task-key header in overlay mode, with no duplicate visible heading; `getByRole('dialog', { name: 'Task details' })` still resolves. Test Close once, Escape once, backdrop once, and focused dismissal/restoration.
- [ ] **Step 2 — Run red.** `npm run test -- src/task/TaskOverlay.test.tsx src/task/TaskDetailSurface.test.tsx` and `npm run test:e2e -- task-detail.spec.ts`; expect duplicate-control assertion to fail.
- [ ] **Step 3 — Implement.** Remove only the duplicate visible overlay chrome and keep the semantic dialog label. Update tests using `.first()` to require a unique Close control. Ensure Radix portal and scroll behavior from Task 1 remain intact.
- [ ] **Step 4 — Verify green.** Focused tests, Playwright modal flow and `npm run typecheck`.
- [ ] **Step 5 — Commit.** `git add client/src/task/TaskOverlay.tsx client/src/task/TaskOverlay.test.tsx client/src/task/TaskDetailSurface.tsx client/e2e/task-detail.spec.ts && git commit -m "fix(tasks): show one detail drawer header"` (omit any unchanged file).

### Task 4: Full regression pass and PR update

**Files:** Only files legitimately changed by Tasks 1–3. No global formatting or unrelated refactoring.

**Interfaces:** No public API or product contract change.

- [ ] **Step 1 — Full verification** from `client/`: `npm run test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`. Report actual results, do not claim success without output. Run formatter on changed files only if required.
- [ ] **Step 2 — PR behavior smoke test.** Check desktop 1280px viewport, split threshold at 845px/844px **workspace width**, overlay at viewport 800px, panel→full-page→Back restoration, Close/Forward, deep links, 404 and account-scoped details.
- [ ] **Step 3 — Inspect diff.** Confirm no secondary header, no regression to URL/history, no new dependencies/backend changes; update browser tests to avoid using `.first()` when uniqueness is required.
- [ ] **Step 4 — Push.** Commit residual test/format fixes if any; `git push origin feat/issue-19-task-detail-panel`. Update the existing PR #44; **do not open a new PR or merge**.
- [ ] **Step 5 — Completion comment.** Reply on PR #44 with fix commit SHAs, test evidence and whether all three items are resolved; request re-review.

## Verification infrastructure note (non-blocking follow-up)

Existing GitHub CI runs Vitest, lint, formatting and build but not Playwright. The previous review suggested adding browser tests to CI; this is **not a product defect in PR #44** and should not expand this focused remediation without the owner's separate approval. Ensure Playwright is run locally as part of this plan and include its command result in the completion comment. SonarQube's reported 0% new-code coverage should be addressed separately by its coverage-report integration, not by weakening tests or adding unrelated code here.

## Execution handoff

Use the previously agreed **Superpowers executing-plans inline** workflow on the existing PR feature branch. No subagents or worktree. Re-evaluate each finding against the current code before changing it; if a finding is already fixed, demonstrate this with a regression test rather than duplicating the fix.