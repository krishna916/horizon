# Issue #22 / PR #49 — Review Remediation Implementation Plan

> **For Luna:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` in **NATIVE/INLINE** mode. Execute the tasks in order, RED → GREEN → verification → focused commit. Do not use per-task subagents. This is a targeted review follow-up, not a repeat of the original 11 implementation tasks.

**Goal:** Fix three correctness findings and one accessibility issue from the review of [PR #49](https://github.com/krishna916/horizon/pull/49), preserving the approved behavior.

**Architecture:** Keep the existing Task/ChecklistItem model, parent-level write lock, Spring task APIs, TanStack Query, and issue #21 TaskCompletionProvider. Fix the frontend completion *gate* instead of changing the completion API; distinguish stale deleted children during reorder; retain failed Undo recovery; use already installed Radix primitives for the date picker.

**Tech Stack:** Java 25, Spring Boot 4.0.6, PostgreSQL 17, Testcontainers, Maven; React 19, TypeScript, TanStack Query v5, Radix UI, Vitest/RTL, Playwright.

**Spec:** [Owner-approved issue #22 design](../specs/2026-10-23-issue-22-checklist-items-design.md) and [original implementation plan](./2026-10-23-issue-22-checklist-items.md), plus [issue #21 completion design](../specs/2026-10-22-issue-21-task-completion-design.md). Review is based on PR head `ef77c40b4d6ab8a9aa4fa4b9c49a64b504f993bc` as inspected on 2026-10-23; **check the latest head before editing**.

## Global Constraints

- Work on existing branch `feat/issue-22-task-checklist` and **existing PR #49 only**. Never code on `master` or open another PR. Use a local isolated worktree if appropriate.
- Read root `Agents.md`, `client/AGENTS.md`, `server/AGENTS.md`, `docs/ai/INDEX.md` and local `align-context` / `testing-frontend` / `testing-spring-integration` instructions. Apply `superpowers:receiving-code-review`: verify each comment against current code, fix only valid issues, and give a technical explanation if a finding is invalidated by newer commits.
- Preserve approved issue #22 contract: frontend-only parent completion warning (backend completion stays unconditional); parent and checklist completion independent; 8-second Undo; 409 for stale owned reorder vs 404 for inaccessible items; immediate checklist date save.
- Preserve issue #21 provider's optimistic desired-state serialization, fast reversal, list retention, error/Retry, and unsaved parent field editing.
- No new database schema, endpoints, generalized undo infrastructure, task status enum, broad refactor or extra client package. The direct client dependency `radix-ui` already exists.
- Run real PostgreSQL backend tests with JVM UTC; keep RTL fake-timer cleanup guaranteed; preserve all existing tests. Do not report CI passing until new commits have been verified.

## Review Focus

1. Completed parent: Reopen still pending → click Complete → GET returns old server completedAt; newest user intent must eventually complete (Task 1).
2. Duplicate/stale completion attempts: while checking, after Cancel, or after switching task/user, no extra write/dialog or wrong task mutation (Task 1).
3. Same-parent deleted child in stale reorder returns 409; nonexistent/other-task child returns 404, with no writes (Task 2).
4. Undo initiated at 7.9 s and failing after 8 s still exposes Retry; unused Undo expires exactly at 8 s (Task 3).
5. Date-picker Escape/outside dismisses without PATCH and restores focus; date/clear still PATCH immediately (Task 4).

---

### Task 1 — Correct the completion-intent race (P1)

**Files**
- Modify: `client/src/task/TaskCompletionGate.tsx` (current lines 83–150).
- Test: `client/src/task/TaskCompletionGate.test.tsx`, `client/src/task/TaskCompletionProvider.test.tsx`.
- Inspect: `client/src/task/TaskCompletionProvider.tsx`, `TaskCompletionToggle.tsx`, `TaskRow.tsx`, `TaskDetailView.tsx`.
- Optional E2E regression: `client/e2e/task-completion.spec.ts`.

**Interfaces**
- Keep `useTaskCompletionGate(userId: number, task: TaskSummary, completed: boolean, proceed: () => void): TaskCompletionGateState`.
- Keep `useTaskCompletion(...).toggle()` and the shared provider's latest desired/confirmed state. Do **not** modify backend `POST /api/v1/tasks/{id}/complete`.

- [ ] **Step 1 RED:** Add a test that uses the **real** TaskCompletionProvider, not only a mocked `proceed`. Start with completed parent; request Reopen and hold `taskApi.reopen` unresolved; request Complete while UI is optimistically incomplete; resolve `taskApi.get` with old parent `completedAt` and empty checklist; settle reopen POST. Assert the newest intent issues exactly one eventual `taskApi.complete` and UI is completed. Repeat with unfinished child: dialog must precede completing.
- [ ] **Step 2 RED:** Test a stale GET/confirmation after task or owner changes and a Cancel; assert no mutation. Test repeated input while checklist check is pending: coalesce/disable to avoid duplicate completion requests. A previously requested check must not overwrite a newer task detail or field update.
- [ ] **Step 3 Verify RED:** From `client/` run `npm run test -- TaskCompletionGate.test.tsx TaskCompletionProvider.test.tsx`. The race regression must fail against unmodified code.
- [ ] **Step 4 GREEN:** Remove the gate's veto based only on stale GET `data.completedAt` and the cached-detail timestamp when current provider desired state still requires completion. Use fetched detail to examine **child checklist** only; use latest user/task identity and provider-visible completion state to validate intent. Avoid unconditionally replacing the full detail cache with an old GET response. Gate repeat clicks while the check is in progress; preserve provider's in-flight serialization.
- [ ] **Step 5 Verify GREEN:** Focused tests and `npm run typecheck` pass; parent reopening and existing list-session retention remain unchanged. Commit `fix(task): preserve latest completion intent during checklist check`.

### Task 2 — Map stale deleted-child reorder to 409 (P2)

**Files**
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/application/TaskChecklistCommandService.java` (reorder, current lines 77–99).
- Test: `server/src/test/java/com/krishnamurti/horizon/task/web/TaskChecklistControllerIntegrationTest.java`.
- Inspect: `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/ChecklistItemRepository.java` and `.../task/web/TaskExceptionHandler.java`.

**Interfaces**
- Preserve `reorder(Long taskId, List<Long> itemIds): List<ChecklistItem>` and the owner-scoped pessimistic parent lock.
- Existing `ChecklistItemRepository.findByIdAndTaskId(Long itemId, Long taskId)` reads rows including `deleted_at`; `ChecklistOrderConflictException` maps to 409.

- [ ] **Step 1 RED:** Integration test `staleReorderAfterDeletingOwnedItemReturns409WithoutWrites`: add items [a,b,c], DELETE b, submit former list [a,b,c], expect `409` Problem Details and still-live [a,c] in original relative order. Assert another parent's item ID and nonexistent ID return `404`. Test omitted/duplicate/added sibling returns `409`.
- [ ] **Step 2 Verify RED:** `./mvnw test -Duser.timezone=UTC -Dtest=TaskChecklistControllerIntegrationTest` (from `server/`); stale-deleted test should currently fail with 404.
- [ ] **Step 3 GREEN:** Under existing parent lock, distinguish an ID that **belongs to this parent but is soft-deleted** → 409, versus missing/foreign → 404. Validate exact active set before any position write. No schema or security changes.
- [ ] **Step 4 Verify GREEN:** Focused integration suite passes and conflict leaves positions unchanged. Commit `fix(task): distinguish stale checklist order from missing item`.

### Task 3 — Keep failed Undo retry after 8 seconds (P2)

**Files**
- Modify: `client/src/task/ChecklistUndo.tsx` (current timer lines 21–34).
- Test: `client/src/task/ChecklistSection.test.tsx`.
- Modify `client/src/task/ChecklistSection.tsx` only if required for item identity/recovery wiring.

**Interfaces**
- Keep `ChecklistUndo({removedItem:ChecklistItem|null, onUndo:()=>Promise<void>, onDismiss:()=>void})`. No backend expiry or global notification infrastructure.

- [ ] **Step 1 RED:** Fake timer with `afterEach(() => vi.useRealTimers())`: item removed at t=0; advance to t=7900; click Undo; let restore remain pending past t=8000, then reject; assert Retry still displayed; Retry restores **same ID** once and dismisses. Double click must not send duplicate restores. Separately assert unattempted Undo disappears at t=8000 and unmount cancels timers.
- [ ] **Step 2 Verify RED:** `npm run test -- ChecklistSection.test.tsx`; new pending/failure boundary test must fail on current implementation.
- [ ] **Step 3 GREEN:** Treat Undo as local phases: idle with 8s timer, restoring with timer stopped, failed with persistent Retry, then resolved/dismissed. Cancel timer **at first Undo attempt**, not after success. Prevent concurrent restore requests and stale Retry for a newer removal. Unmount still removes recovery.
- [ ] **Step 4 Verify GREEN:** Focused tests pass and fake timers do not leak to later suites. Commit `fix(client): preserve checklist undo recovery after timer expiry`.

### Task 4 — Dismiss accessible due-date picker (P3)

**Files**
- Modify: `client/src/task/ChecklistDueDatePicker.tsx`.
- Test: `client/src/task/ChecklistSection.test.tsx` or create focused `client/src/task/ChecklistDueDatePicker.test.tsx` if smaller.
- Check existing `client/package.json`: `radix-ui` is already installed.

**Interfaces**
- Preserve picker props (`itemTitle`, `itemId`, `value`, `disabled`, `onChange(next: string|null)`) and immediate due-date mutation on select/clear.

- [ ] **Step 1 RED:** Test keyboard open, Escape close + focus restoration, outside click close, unchanged due date/zero `onChange` on both dismissals, selected date `'2026-11-02'` calls one `onChange` and closes, Clear calls one `onChange(null)` and closes, disabled trigger doesn't open. Add a small Playwright scenario if jsdom event simulation is insufficient.
- [ ] **Step 2 Verify RED:** `npm run test -- ChecklistSection.test.tsx` (also picker test if added); expect dismissal/focus failure in current code.
- [ ] **Step 3 GREEN:** Use existing `radix-ui` Popover primitive (or a preexisting approved shadcn wrapper) with accessible trigger/content/focus handling. Keep native `type="date"` and existing styling; no new dependency, Save/Cancel, or component-library overhaul.
- [ ] **Step 4 Verify GREEN:** Focused tests and accessible browser behavior pass. Commit `fix(client): make checklist due date popover dismissible`.

### Task 5 — Full regression and PR closure report

**Files:** Reuse `client/e2e/task-completion.spec.ts` / `client/e2e/task-checklist.spec.ts` for necessary integration regressions; no unrelated production change.

- [ ] **Step 1:** Confirm all four findings have executable regression coverage and no skipped tests. Re-run targeted test suites.
- [ ] **Step 2:** From `server/` run `./mvnw test -Duser.timezone=UTC`; check integration/ownership tests pass against PostgreSQL Testcontainers.
- [ ] **Step 3:** From `client/` run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e`; report exactly what passed/failed.
- [ ] **Step 4:** Push commits on **same** `feat/issue-22-task-checklist` branch. Respond to each of the four **existing inline PR review threads** with a short fix/test/commit summary. Don't mark unresolved threads resolved on the owner's behalf unless normal repo practice explicitly allows it. Don't merge.
- [ ] **Step 5:** Post final PR summary with targeted tests, full checks, remaining risks and request re-review. SonarCloud's reported 0% new-code coverage is a separate CI-metric question, **not** a reason to add broad coverage tooling changes here without approval.

## Acceptance Checklist

| Review finding | Required proof |
| --- | --- |
| P1 latest intent lost | Reopen → Complete during pending API settles completed; warning still before write for unfinished children |
| P2 stale deleted child | 409 owned deleted; 404 foreign/unknown; no partial order writes |
| P2 Undo retry expires | Recovery survives timer after attempted Undo; unattempted Undo expires at 8 seconds |
| P3 picker UX | Escape/outside dismissal and focus return, unchanged due date; immediate select/clear |

**Execution handoff:** Read approved spec/plan, recheck current PR head, then run this plan Tasks 1→5 using `superpowers:executing-plans` **native/inline**. Verify comments against current code before editing. Use small TDD commits, push to existing PR #49, reply to review threads and request another review. **Do not merge the PR.**
