# Issue #23 — Task Archive, Restore and Soft Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Luna is the intended implementer. First read this plan, the design spec, and `AGENTS.md` files. **This plan is for owner review; do not begin implementation until the owner approves it.**
>
> **Agent handoff:** Execute in `feat/issue-23-task-archive-trash` using `superpowers:using-git-worktrees` as applicable, then `test-driven-development` and `verification-before-completion`. Keep implementation inline unless the owner explicitly chooses subagent execution; do not create per-method controllers, new global stores or status enums.

**Goal:** Let signed-in users archive, restore, and send Tasks to recoverable Trash from list/panel/page actions, with dirty-edit protection, Delete confirmation, persistent Undo, correct lifecycle preservation, and owner-safe APIs.

**Architecture:** Extend the existing Task aggregate/service/controller with timestamp commands, including a deleted-task recovery exception to ordinary filtered reads. Extend the existing Tasks route layout with a feature-local lifecycle action/notification coordinator, reuse draft navigation guard for action-triggered unsaved-edit protection, and add row/header controls. Keep Task list/history visibility for #25 and common Trash UI for #9.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Maven, PostgreSQL 17/Flyway/Testcontainers, React 19/TypeScript, TanStack Query + Router, Axios, Tailwind v4/shadcn/Radix/Lucide, Vitest/RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-issue-23-task-archive-trash-design.md` (the approved decisions transcribed for owner review). Also `docs/design/tasks-workspace/DESIGN-SPEC.md`, PRD-004 Tasks, SPEC-001 Shared Concepts, Horizon Constitution, and issue #21 completion design.

**Issue:** https://github.com/krishna916/horizon/issues/23

## Global Constraints

- **Branch:** `feat/issue-23-task-archive-trash`; implement there, not `master`. No product code was changed during plan creation.
- Honor owner decisions: #23 is narrow; no Archived list/toggles (#25), no Trash screen/permanent delete (#9); Save/Discard/Keep editing guard; Archive immediate with persistent Undo; Delete confirmation with persistent Undo; Archive keeps panel/page open; Delete returns list.
- Preserve `completed_at` on Archive, archive Restore, Delete, and deleted Restore; preserve `archived_at` across Delete/Undo; no `status` enum. Precedence: deleted > archived > completed > active.
- `Task` already has `completed_at`, `archived_at`, `deleted_at`; no Flyway migration for lifecycle fields. Checklist item data is never changed by these commands. `inbox` is preserved on archive/deletion.
- Use current-user ownership, `404` for missing/other-user, `401` unauthenticated, and RFC 9457; only dedicated deleted recovery can resolve an owned deleted resource. All normal queries continue to filter deleted records.
- Preserve existing completion coordinator (#21), checklist warning (#22), field edits (#20), canonical routes, light/dark semantic tokens and accessible feedback. No new dependency/global notification store.
- Do not copy the mockup's event code. Use the approved rendered design only.
- Follow `server/AGENTS.md`, `client/AGENTS.md`, relevant codebase engineering guides and the `testing-frontend` skill if available. Keep code changes minimal and test behavior, not implementation details.
- **Owner review gate:** Endpoint spellings, precise neutral notification copy, idempotence and coordinator file structure are explicit engineering proposals in the design doc; the owner can change them before Luna starts. Never silently override a product-level conflict uncovered while coding.

## File responsibility map

| Unit | Modify/create exact paths | Responsibility |
| --- | --- | --- |
| Task lifecycle domain | `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java` | Archive, restore, soft-delete, deleted restore without modifying other facts |
| Task owner commands | `server/src/main/java/com/krishnamurti/horizon/task/application/TaskCommandService.java`; `.../infrastructure/TaskRepository.java` | Transactional commands; filtered vs deleted-aware owner lookup |
| HTTP contract | `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java` | Four REST operations; existing response/error contract |
| Future module recovery API | Create `server/src/main/java/com/krishnamurti/horizon/task/api/TaskRecoveryApi.java`, `TaskRecoverySnapshot.java` | Safe Task-owned restore operation accessible to Epic #9 without domain/repository leakage |
| Backend tests | `server/src/test/java/com/krishnamurti/horizon/task/domain/TaskTest.java`, `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`, optional narrow `task/api` integration test | Fact preservation, PostgreSQL lifecycle and owner isolation |
| Client API/types | `client/src/task/api.ts`, existing `types.ts` only if response shape requires | Typed Task lifecycle commands; no new `status` field |
| Client coordinator | Create `client/src/task/TaskLifecycleProvider.tsx`, `TaskLifecycleProvider.test.tsx` | Owner/task-scoped mutations, Query reconciliation, error/Retry and persistent Undo queue |
| Existing draft guard | `client/src/task/TaskDraftNavigationGuard.tsx` plus corresponding tests | Guard an explicit lifecycle action using existing save/discard/keep UX |
| Task action controls | Create `client/src/task/TaskLifecycleActions.tsx`, `TaskLifecycleNoticeList.tsx`; modify `TaskRow.tsx`, `TaskDetailSurface.tsx`, `TaskSection.tsx` if needed | Menu/header actions, Delete confirmation, persistent notices |
| Route and list behavior | `client/src/task/TasksRouteLayout.tsx`, `TasksListPage.tsx`, `TaskDetailPage.tsx`, `TaskWorkspace.tsx`, `task-view.ts`, `client/src/routes/_authenticated/tasks.$id.tsx` only as needed | Route lifetime, delete navigation, archive precedence, preserve open detail |
| Frontend tests | Existing `TaskRow.test.tsx`, `TaskDetailSurface.test.tsx`, `TaskWorkspace.test.tsx`, `task-view.test.ts`; create `client/e2e/task-lifecycle.spec.ts` | Interaction, cache, routing and browser acceptance |
| Documentation | This plan/spec; authoritative PRD-004 via separate knowledge-store workflow | Record restored completed-task rule; do not invent a PRD path |

Use existing constructor signatures and test helpers rather than redesigning their modules. Where file names differ after another merge, identify and record actual replacements before coding.

## Review Focus — five high-risk cases to pin in owning task tests

1. **Archive while completion request is in flight:** stale completion/query response must never reclassify an archived task into Active/Completed, overwrite archive time, or drop unsaved edit — Tasks 2, 4.
2. **Delete acknowledged ambiguously after network timeout:** task must not falsely appear lost without Undo; retry safely, and do not expose deleted content via ordinary GET — Tasks 1, 2.
3. **Undo after an archived-completed task is deleted:** restore `deleted_at` only; preserve *both* `archived_at` and `completed_at` plus child checklist facts — Task 1.
4. **Dirty checklist/field editor action:** Save failures prevent Archive/Delete; Keep editing prevents action; Discard only applies to affected draft; then Delete still requires confirmation — Tasks 3, 4.
5. **Session/route change with several notifications:** notices remain independent per different task, persist across page→Tasks navigation, clear on leaving Tasks/account switch, and never act using another user's context — Tasks 2, 5.

---

### Task 1: Backend lifecycle operations, recovery interface and owner-safe persistence

**Files:** Modify `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java`, `application/TaskCommandService.java`, `infrastructure/TaskRepository.java`, `web/TaskController.java`; create `task/api/TaskRecoveryApi.java`, `task/api/TaskRecoverySnapshot.java`; test `server/src/test/java/com/krishnamurti/horizon/task/domain/TaskTest.java`, `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`.

**Interfaces:**
- `Task.archive(OffsetDateTime when): void`; set archive timestamp once, do not alter completion.
- `Task.restoreArchived(): void`; clear `archivedAt` only.
- `Task.softDelete(OffsetDateTime when): void`; set delete timestamp once, preserve prior lifecycle.
- `Task.restoreDeleted(): void`; clear `deletedAt` only.
- `TaskCommandService.archive(Long taskId): Task`; `restoreArchived(Long taskId): Task`; `softDelete(Long taskId): void`; `restoreDeleted(Long taskId): Task`; all transactional.
- `TaskRepository.findByIdAndUserId(Long id, Long userId): Optional<Task>` supports only owner-scoped delete/recovery paths; ordinary reads still use `...AndDeletedAtIsNull`.
- `TaskRecoveryApi.restoreDeletedTask(Long taskId): TaskRecoverySnapshot`, with a minimal immutable `TaskRecoverySnapshot(Long id, String key, boolean completed, boolean archived)`. Implement via Task command layer so #9 can request recovery through `task.api` without reaching into repository/domain.
- `TaskController`: `POST /{id}/archive` and `POST /{id}/restore` -> 200 `TaskDetailResponse`; `DELETE /{id}` -> 204; `POST /{id}/restore-deleted` -> 200 `TaskDetailResponse`. Map existing `TaskResponseMapper` and `TaskChecklistQueryService` only after deleted restore.

- [ ] **Step 1 — RED domain:** Add `TaskTest` tests asserting archive of completed task preserves the original completed instant, restore clears archive only, delete/restore preserve both timestamps and other fields, repeat operations don't change timestamps, and checklist data remains untouched by aggregate commands.
- [ ] **Step 2 — RED integration:** Extend `TaskControllerIntegrationTest` with `archiveAndRestoreUnfinishedTask`, `restoreArchivedCompletedTaskRetainsCompletion`, `softDeleteHidesFromOrdinaryGetListAndUpdates`, `undoDeleteRestoresArchivedCompletedChecklist`, `repeatDeleteAndRestoreAreSafeForOwner`, `otherUserAndMissingLifecycleCommandsReturn404`, and `unauthenticatedLifecycleCommandsReturn401`. Stage real Postgres task+checklist via existing helpers. Assert DB columns and normal GET/list exclusion.
- [ ] **Step 3 — Verify RED:** `cd server && ./mvnw test -Dtest=TaskTest,TaskControllerIntegrationTest`; newly added tests must fail for missing methods/routes, not test setup defects.
- [ ] **Step 4 — GREEN:** Implement the exact methods and endpoints above. Use server UTC timestamps; existing owner repository checks; prevent already-deleted tasks from being archived/restored/edited. Deleted-aware lookup is used **only** by soft-delete and restore-deleted. No new migration, status type or hard-delete code.
- [ ] **Step 5 — Verify GREEN:** Run the same Maven command and inspect DB assertions; existing complete/reopen/checklist tests must still pass.
- [ ] **Step 6 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task server/src/test/java/com/krishnamurti/horizon/task && git commit -m "feat(task): add owner-scoped archive and soft-delete recovery"`

### Task 2: Feature-local lifecycle state, query reconciliation and persistent Undo

**Files:** Modify `client/src/task/api.ts`, `TasksRouteLayout.tsx`; create `TaskLifecycleProvider.tsx`, `TaskLifecycleProvider.test.tsx`.

**Interfaces:**
- `taskApi.archive(id: number): Promise<AxiosResponse<TaskDetail>>`, `restoreArchive(id)`, `softDelete(id): Promise<AxiosResponse<void>>`, `restoreDeleted(id): Promise<AxiosResponse<TaskDetail>>`.
- Define `type LifecycleOperation = 'archive' | 'restore' | 'delete'`; `type LifecycleNotice = { id: string; userId: number; taskId: number; taskKey: string; action: 'archive' | 'delete'; error: string | null; retrying: boolean }`.
- `useTaskLifecycle()` exposes `run(userId: number, task: TaskSummary, operation: LifecycleOperation): Promise<boolean>`, `undo(noticeId: string): Promise<boolean>`, `dismiss(noticeId: string): void`, `notices: readonly LifecycleNotice[]`, and `stateFor(userId: number, taskId: number): { pending: boolean; error: string | null; retry: () => void }`. The provider retains retry intent per task to make the no-argument retry meaningful.
- Coordinator lives within `TasksRouteLayout` so notifications survive panel close / full-page→list navigation but clear on leaving Tasks. All Query keys owner-scoped. `run` returns `true` **only after confirmed successful server response**; caller decides where to navigate.
- Confirmed Archive/Restore updates `archivedAt` and `updatedAt` in list/detail cache, invalidating as necessary. Confirmed delete removes task from ordinary list caches and invalidates detail; Undo-delete repopulates/refreshes using returned task facts. Preserve completion/field changes from other in-flight mutations.
- Multiple distinct tasks keep independent notices. A newer successful operation on the **same** task supersedes obsolete inverse notices for that task; never overwrite notices for a different task.

- [ ] **Step 1 — RED:** Add coordinator tests: archive/restore updates list+detail, delete removes from list only after confirmed 204 and retains Undo; notification persists without fake timers; two tasks both remain undoable; failure preserves confirmed state + retry; Undo failure shows Retry and retains notice; archived+completed Undo restores both facts; owner switch clears pending/notices.
- [ ] **Step 2 — RED race:** Add tests for task completion request finishing after an Archive/Delete mutation, background list refetch during a lifecycle command, and uncertain Delete timeout followed by retry. Assert no deleted-item resurrection or false success and no cross-user cache leakage.
- [ ] **Step 3 — Verify RED:** `cd client && npm run test -- src/task/TaskLifecycleProvider.test.tsx`; tests fail due to missing implementation.
- [ ] **Step 4 — GREEN:** Implement client API and provider. Reuse TanStack Query and existing completion coordinator; serialize/reconcile lifecycle writes for the **same task** when an earlier completion write is unresolved rather than blindly racing. Keep network failure feedback local/persistent and owner scoped. Do not add Redux/Zustand or a global toast library.
- [ ] **Step 5 — Verify GREEN:** Same Vitest command; ensure existing `TaskCompletionProvider.test.tsx` still passes.
- [ ] **Step 6 — Commit:** `git add client/src/task && git commit -m "feat(task): coordinate lifecycle actions and persistent undo"`

### Task 3: Reuse the draft guard for explicit Archive/Delete actions

**Files:** Modify `client/src/task/TaskDraftNavigationGuard.tsx`; add adjacent `TaskDraftNavigationGuard.test.tsx` if not already present (or extend existing guard tests).

**Interfaces:**
- Extend `DraftGuardApi` with `requestAction(action: () => void | Promise<void>): void`. When a dirty/pending registration exists, it queues one explicit action and uses the **same** Save and continue / Discard and continue / Keep editing dialog. When no guarded draft is active, it invokes the action immediately.
- Save and continue: require `save(): Promise<boolean>` to resolve `true` before dispatch. Discard and continue: invoke registered `discard()` before action. Keep editing: cancel pending action. Preserve the existing router blocker code path and before-unload behavior.
- Do not begin an action if a draft save is still pending; prevent duplicate action dispatch or a stale queued action after task/owner navigation. Scope the gate to editing context actually impacted by the lifecycle operation; unrelated task rows must not silently discard the selected task's draft.

- [ ] **Step 1 — RED:** Extend guard tests: Archive with dirty field offers three choices; Save success dispatches exactly once, Save failure never dispatches; Discard dispatches only after discard; Keep editing never dispatches; pending save does not double dispatch; field and checklist registrations work; normal navigation guard still works.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test -- src/task/TaskDraftNavigationGuard.test.tsx`; expected new tests FAIL.
- [ ] **Step 3 — GREEN:** Extend existing guard component and dialog minimally; do not introduce another competing unsaved-changes provider/modal.
- [ ] **Step 4 — Verify GREEN:** Run the targeted guard test plus `npm run test -- src/task/TaskSessionBoundary.test.tsx`.
- [ ] **Step 5 — Commit:** `git add client/src/task && git commit -m "feat(task): guard lifecycle actions against unsaved drafts"`

### Task 4: Row menu, shared detail header actions and Delete confirmation

**Files:** Create `client/src/task/TaskLifecycleActions.tsx`; modify `TaskRow.tsx`, `TaskDetailSurface.tsx`, `TaskSection.tsx` (only if action wiring needs it); test `TaskRow.test.tsx`, `TaskDetailSurface.test.tsx`, `TaskDetailView.test.tsx` where applicable.

**Interfaces:**
- `TaskLifecycleActions` accepts `{ task: TaskSummary; userId: number; placement: 'row' | 'header'; onDeleted?: () => void }`; it obtains lifecycle coordinator and draft guard via hooks. Present Archive for unarchived; Restore for archived; Delete for both.
- `TaskRow` renders a trailing accessible menu trigger **sibling** to its existing row-open button and completion control. Menu selection never opens detail; keyboard Escape closes menu and restores focus.
- `TaskDetailSurface` renders matching Archive/Restore and Delete icons in **both panel and full-page** headers; use `taskQuery.data` as source for title/key and lifecycle. On successful Archive, panel/page remains open and header switches to Restore. After confirmed Delete, call `onDeleted` to route to list; do not navigate on error/cancel.
- The Delete confirmation is a controlled Radix dialog with accessible title/description and explicit Cancel / Move to Trash actions. For dirty draft, draft guard completes **before** this confirmation; Archive has no extra confirmation.
- While pending show a calm accessible progress indication; errors are local and retryable. A stale panel/detail cache must not make archived task reappear in Active.

- [ ] **Step 1 — RED rows:** Tests verify three-dot menu opens independently from row/title and completion, Escape/focus works, Archive action has no extra confirmation, and archived task is classified out of Active.
- [ ] **Step 2 — RED detail:** Tests verify panel & page have visible Archive/Restore and Delete controls, Archive leaves detail open, header changes to Restore, Delete confirmation cancel is non-mutating, and confirmed Delete fires onDeleted once. A dirty title/checklist draft is guarded.
- [ ] **Step 3 — Verify RED:** `cd client && npm run test -- src/task/TaskRow.test.tsx src/task/TaskDetailSurface.test.tsx`; expected new behavior fails.
- [ ] **Step 4 — GREEN:** Add menu/header/dialog using existing Radix/shadcn primitives, Lucide and theme tokens; keep controls separate from row navigation; never add one controller/component per backend use case or a global UI store.
- [ ] **Step 5 — Verify GREEN:** Re-run targeted tests, `npm run typecheck` and `npm run lint`.
- [ ] **Step 6 — Commit:** `git add client/src/task && git commit -m "feat(task): expose archive restore and trash actions in task UI"`

### Task 5: Notices, route continuity, list classification and browser acceptance

**Files:** Create `client/src/task/TaskLifecycleNoticeList.tsx`, `client/e2e/task-lifecycle.spec.ts`; modify `TasksRouteLayout.tsx`, `TasksListPage.tsx`, `TaskDetailPage.tsx`, `TaskWorkspace.tsx`, `client/src/routes/_authenticated/tasks.$id.tsx` and `task-view.ts` only if necessary; extend associated tests.

**Interfaces:**
- `TaskLifecycleNoticeList` consumes `useTaskLifecycle().notices`; renders one task-specific row per active notice with text, Undo, Dismiss; failed Undo displays error and Retry in place. No timers. A notice remains for task deleted from the list.
- Host it **inside the mounted Tasks route layout** so panel→list and page→list navigation preserve Undo; route layout unmount or verified user change clears it. **Existing `TaskCompletionProvider` lives in `client/src/App.tsx` above the router; leave it there.** Preserve existing `TaskDraftNavigationGuard` placement/order.
- `TasksListPage` supplies `onDeleted` for panel/detail and navigates to `/tasks` with `replace: true` after successful soft-delete; `TaskDetailPage` / route wiring provides equivalent for full-page deletion. Do not use browser Back to revisit a now-deleted canonical detail URL.
- Keep `classifyTasks` archived precedence unchanged; only add archive-specific assertions as required. Do not expose Archived section or completed history (owned by #25).

- [ ] **Step 1 — RED component:** Test notices do not auto-expire, multiple task notices coexist, Archive Undo restores task to Active or Completed depending on `completedAt`, Delete Undo restores prior archived/completed facts, Undo failure keeps Retry, and notices clear on leaving Tasks / account switch.
- [ ] **Step 2 — RED browser:** Create Playwright route stubs for `POST archive`, `POST restore`, `DELETE task`, `POST restore-deleted`, owner-scoped GET/list. Cover row Archive→Undo, panel Archive→Restore without closing, completed Archive→restore history precedence, dedicated Delete confirmation→list→Undo, dirty edit save/discard/keep gating, and keyboard controls.
- [ ] **Step 3 — Verify RED:** `cd client && npm run test -- src/task/TaskWorkspace.test.tsx` and `npm run test:e2e -- task-lifecycle.spec.ts` with existing Playwright setup; newly added assertions fail before full integration.
- [ ] **Step 4 — GREEN:** Wire layout, notice list and routing; update Query cache carefully so deleted tasks never reappear from stale queries. Keep archived task **details** accessible by ID and open; the list still excludes archived. Maintain list-session completion retention from #21 for non-archived only.
- [ ] **Step 5 — Verify GREEN:** Run targeted Vitest plus `npm run test:e2e -- task-lifecycle.spec.ts`; inspect browser flows in both theme modes if feasible.
- [ ] **Step 6 — Commit:** `git add client/src/task client/e2e && git commit -m "feat(task): complete lifecycle undo and navigation flows"`

### Task 6: Cross-feature verification and documentation reconciliation

**Files:** No speculative product modules. Update this plan/spec only for observed deviations approved during implementation. Apply PRD correction **in its authoritative knowledge store**, not by creating a fictional repo path.

- [ ] **Step 1 — API/integration:** `cd server && ./mvnw test`; expected PASS, including current Task completion, checklist, creation and ownership tests.
- [ ] **Step 2 — Backend checks:** `cd server && ./mvnw verify` (use existing `server/AGENTS.md`/CI conventions for Spotless, Error Prone, SpotBugs); expected PASS.
- [ ] **Step 3 — Client unit/static:** `cd client && npm run test && npm run typecheck && npm run lint && npm run format:check && npm run build`; expected PASS.
- [ ] **Step 4 — E2E:** `cd client && npm run test:e2e`; expected PASS with project test environment available. If Docker/Playwright prerequisites absent, report not run rather than claiming PASS.
- [ ] **Step 5 — Document PRD reconciliation:** Update authoritative PRD-004 FR-009, restore transition and Edge Case 5 through the knowledge-store workflow: *Restoring clears archived_at only; a completed task remains Completed and respects history visibility.* If not editable from implementation workspace, link this design spec and note that upstream docs remain pending. No rewrite to another format without authorization.
- [ ] **Step 6 — Review:** Verify no database status enum/migration; no accidental hard delete or orphan checklist changes; cross-owner and deleted route 404; state preservation; #25 and #9 boundaries. Use `superpowers:verification-before-completion` and request whole-branch review prior to claiming done.
- [ ] **Step 7 — Commit docs only if changed:** `git add docs/superpowers && git commit -m "docs: reconcile task restore lifecycle semantics"` (skip when no change). Report test evidence and current remaining dependency (#25/#9).

## Acceptance / delivery handoff

Done when: Archive/Restore/Delete work from row, panel and page; Delete requires confirmation; dirty editing is explicitly resolved; Archive keeps detail open; Delete returns to list; persistent non-expiring task-specific Undo works across Tasks list/page navigation with error Retry; backend preserves lifecycle and checklist facts, never physical-deletes tasks, and enforces ownership; relevant tests/CI pass.

**Intentionally not delivered:** Archived list visibility and history controls (#25), common Trash UI/permanent delete (#9), saved filters, new notification framework, status enum.

**PRD correction:** PRD-004's generic “Restore → Active” is superseded for completed tasks by the owner's explicit confirmation. Update the authoritative knowledge source separately if not stored in this codebase.

**Review gate:** Owner reviews this written plan. Luna must not implement until approval; then proceed sequentially without reopening already settled product decisions. If implementation reveals a *new* meaningful product conflict, surface it instead of choosing silently.
