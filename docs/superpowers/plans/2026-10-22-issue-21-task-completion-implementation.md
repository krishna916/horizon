# Issue #21 — Task completion and reopening Implementation Plan

> **For Luna (agentic implementer): REQUIRED SUB-SKILL: use `superpowers:executing-plans` INLINE/NATIVE in your current session. Do NOT invoke `superpowers:subagent-driven-development` or dispatch implementer/reviewer subagents for each task. Follow the executing-plans task ledger, RED→GREEN per-task verification, commits, and final whole-branch review. The owner has explicitly selected inline execution. Track checkboxes (`- [ ]`) as you progress.**
>
> **Review gate:** This plan is written for owner review. Do not start implementation until the owner approves this written plan.

**Goal:** Complete or reopen owned tasks from list rows and both details surfaces, with immediate persisted lifecycle facts, easy reversal, correct list retention, and calm saving/error feedback.

**Architecture:** Add narrow owner-scoped task lifecycle commands to the existing Task aggregate/service/controller. Use one shared task-scoped optimistic command coordinator exposed through the existing Tasks route layout, and keep list-session retention inside the mounted list workspace. Extend existing row/detail components; retain TanStack Query as the server-state source of truth, not an independent global store.

**Tech Stack:** Java 25, Spring Boot 4.0.6, PostgreSQL 17/Testcontainers, React 19, TypeScript, TanStack Query v5/Router, Axios, Tailwind v4, Lucide, Vitest/React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-issue-21-task-completion-design.md` (owner approved 2026-10-22); also `docs/design/tasks-workspace/DESIGN-SPEC.md`, mockup `screenshots/08-completion.jpg`, PRD-004, and Horizon Constitution.

**Issue:** https://github.com/krishna916/horizon/issues/21

## Global Constraints

- Work only on `feat/issue-21-task-completion` in an isolated worktree per `superpowers:using-git-worktrees`; never implement on `master`. Verify the local branch matches the committed spec and plan before beginning.
- **Executing mode: inline.** Load `superpowers:executing-plans`, then its required `test-driven-development` and `verification-before-completion` skills; maintain this plan's `.superpowers/sdd/...` ledger; do not pause between implementation tasks; final whole-branch review is required.
- Read root `AGENTS.md` (if present), `client/AGENTS.md` and `server/AGENTS.md`; use the `testing-frontend` skill when creating Vitest mock route hooks and Playwright network stubs/selectors. Follow existing formatting and static checks.
- No new dependencies, database migration, task status enum, generalized workflow engine, or global state library. Reuse existing `client/src/task/` and `server/.../task/` boundaries.
- An authenticated owner may complete/reopen an archived task, but not a deleted/other-user task; inaccessible tasks respond `404`. Both commands are behaviorally idempotent and return an updated `TaskDetailResponse`.
- Completion is the server's `completedAt` timestamp, not client clock. Client renders immediately but never delays persistence. Archived and deleted lifecycle facts always take precedence over temporary list retention.
- The only in-scope visual changes are circular completion controls, subtle `Saving…`, strike-through, persistent inline failure/Retry. Use approved mockup styling, existing semantic tokens, accessible keyboard/checkbox behavior.
- Task completion and field editing are independent; do not lose unsaved title/priority/due-date drafts or bypass their navigation guard. Checklist warning/infrastructure belongs to #22. Sorting, completed history, archive UI belong to #26/#25/#23 respectively.
- A task completed in the mounted list context stays checked/struck-through in Active until exiting the list view; sort/toggles/panel changes do not release it; dedicated task page, leaving Tasks or refresh do. Do not double-render it in Completed.
- Each user/task has at most **one in-flight completion command**; clicks during a request coalesce to latest desired state. Different tasks can run in parallel. Failed/ambiguous responses reconcile and surface Retry without clobbering later intent.

## File responsibility map

| Ownership | Files | Responsibility |
| --- | --- | --- |
| Backend lifecycle | Modify `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java`, `application/TaskCommandService.java`, `web/TaskController.java` | Domain fact mutations, current-user ownership, explicit HTTP commands |
| Backend tests | Modify `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java` | Authenticated real Postgres/session-backed command contract; create a focused domain test only if necessary |
| Client API | Modify `client/src/task/api.ts` | `taskApi.complete(id)` and `taskApi.reopen(id)` |
| Shared coordinator | Create `client/src/task/TaskCompletionProvider.tsx`, `client/src/task/TaskCompletionProvider.test.tsx` | Per-(userId, taskId) desired/confirmed state, serialized commands, query reconciliation, Retry |
| Route shared lifetime | Modify `client/src/task/TasksRouteLayout.tsx` | Wrap both list and full-page route outlet with completion provider; preserve existing draft navigation guard |
| Reusable feedback | Create `client/src/task/TaskCompletionToggle.tsx` and `client/src/task/TaskCompletionFeedback.tsx` (small view components) | Consistent accessible circle and calm pending/inline failure output; no business logic |
| List row and grouping | Modify `client/src/task/TaskRow.tsx`, `TaskSection.tsx`, `TaskWorkspace.tsx`, `task-view.ts` and adjacent `*.test.tsx` | Independent checkbox vs opener; effective completion styling; ephemeral list-session retention |
| Panel/full-page | Modify `client/src/task/TaskDetailView.tsx`, `TaskDetailSurface.tsx` and adjacent tests | Parent-task checkbox by title on both surfaces; dirty draft preserved; optional callback to mounted list for retention |
| Browser | Create `client/e2e/task-completion.spec.ts` | Route-level true interaction with stubbed server; persistence/reentry and failure evidence |

Exact code signatures below define interfaces shared across tasks. Re-read the current source before writing; avoid unrelated refactoring.

## Review Focus — five likely regressions to pin with tests

1. **Ambiguous timeout:** server may have committed although Axios rejected; a fresh GET must reconcile before rollback/retry, including when later clicks changed desired state — Task 2.
2. **Stale query/field update:** a background list/detail result or simultaneous field PATCH must not undo the latest completion or erase a dirty draft — Tasks 2 and 5.
3. **User change during pending mutation:** prior owner's completion result/error must never enter a different owner's visible cache — Task 2.
4. **Retention during panel/page history:** list → panel → another panel stays retained; list → full page → browser Back ends retention, even though parent layout remains mounted — Tasks 4 and 6.
5. **Archived/deleted lifecycle precedence:** an archived completion can be changed without surfacing in Active; a deleted task cannot be toggled; `404` indistinguishable for other-user/missing — Tasks 1 and 4.

---

### Task 1: Backend lifecycle commands and authorization

**Files:** Modify `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java`, `application/TaskCommandService.java`, `web/TaskController.java`; Test `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`.

**Interfaces:**
- `Task.complete(OffsetDateTime when): void`: set `completedAt` only if currently null, else preserve previous timestamp.
- `Task.reopen(): void`: set `completedAt = null`.
- `TaskCommandService.complete(Long taskId): Task` and `reopen(Long taskId): Task`: `@Transactional`, existing `CurrentUserProvider` + `findByIdAndUserIdAndDeletedAtIsNull`, then save; archived permitted.
- `TaskController.complete(@PathVariable Long id): TaskDetailResponse`, `reopen(...)`: `@PostMapping("/{id}/complete")` and `@PostMapping("/{id}/reopen")`, HTTP 200, no request body, standard auth/error mapping.
- Existing `TaskDetailResponse` includes `completedAt`; no DTO or schema changes.

- [ ] **Step 1 — RED:** Add integration tests `completeAndReopenPersistThroughGetAndList`, `repeatedCompletePreservesOriginalTimestampAndRepeatedReopenIsNull`, `archivedCompletionPreservesArchivedAt`, `deletedAndOtherUserTasksReturn404`, and `unauthenticatedLifecycleCommandsReturn401`. Use existing create/login helpers and JdbcTemplate to stage `archived_at`/`deleted_at`. Assert DB `completed_at` and returned JSON (including unchanged title/metadata), and no side effect for denied commands.
- [ ] **Step 2 — Verify RED:** Run `cd server && ./mvnw test -Dtest=TaskControllerIntegrationTest`; expected new tests FAIL for missing lifecycle routes (`404` or `405`), with existing tests remaining green.
- [ ] **Step 3 — Implement:** Add exactly the domain/service/controller methods above; service uses existing scoped lookup helper pattern and `OffsetDateTime.now(ZoneOffset.UTC)` or the repository's established UTC clock convention. Keep `TaskController` as the single task resource controller; do not create CompleteTaskController or a `status` field.
- [ ] **Step 4 — Verify GREEN:** Run `cd server && ./mvnw test -Dtest=TaskControllerIntegrationTest`; expected all tests in that class PASS, including the new lifecycle assertions.
- [ ] **Step 5 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java && git commit -m "feat(tasks): persist owner-scoped completion and reopen commands"`.

### Task 2: Shared optimistic completion coordinator — state, ordering, reconciliation

**Files:** Modify `client/src/task/api.ts`, `TasksRouteLayout.tsx`; Create `client/src/task/TaskCompletionProvider.tsx` and `TaskCompletionProvider.test.tsx`; modify existing test wrappers that render the list/details directly if they need a provider.

**Interfaces:**
- `taskApi.complete(taskId: number): Promise<AxiosResponse<TaskDetail>>`, `taskApi.reopen(taskId: number): Promise<AxiosResponse<TaskDetail>>` via `apiClient.post<TaskDetail>(`/tasks/${taskId}/complete`)` and matching `reopen` path.
- `TaskCompletionProvider({children}: {children: ReactNode}): JSX.Element` mounted *inside* the existing `TaskDraftNavigationGuard` of `TasksRouteLayout`, surrounding `<Outlet />`.
- `useTaskCompletion(userId: number, task: TaskSummary): { completed: boolean; saving: boolean; error: string | null; toggle: () => boolean; retry: () => void }`. `toggle()` must atomically update the latest desired value and return the **new** boolean so list retention can react. `TaskDetail` extends `TaskSummary`.
- `useTaskCompletionSnapshot(userId: number): ReadonlyMap<number, boolean>` exposes the coordinator's effective completion booleans to the list classifier (do not call hooks inside array loops). This is an ephemeral view projection; the server-provided completed timestamp remains canonical.
- One shared route-layout-owned state/coordinator, keyed by `(userId, task.id)`; all list/detail consumers observe the same optimistic state. Snapshot derives from `task.completedAt` when no pending/failed coordination entry exists.

**Ordering contract:** A click updates desired state synchronously. At most one request per task; if desired flips while pending, await settlement and send only the latest necessary next command. Never parallelize two commands for the same task. A response updates **confirmed** `completedAt`, but must not change newer desired presentation. Mark `saving=false` only after latest intent is confirmed. Avoid blind replacement of all detail/list fields with an older command response; merge only applicable lifecycle values and reconcile stale query responses. Cancel/reconcile relevant in-flight queries before optimistic writes; do not mutate a different user's cache. An error triggers an authoritative GET, if possible, to determine whether a timeout committed; if desired remains unconfirmed, revert visible state and persist inline Retry, without spinning automatic retries. Retrying re-applies the user's failed intent while retaining latest-click correctness. Use `useRef`/functional updates as needed for atomic rapid clicks.

- [ ] **Step 1 — RED:** Write provider RTL/hook tests `oneClickImmediatelyUpdatesAllSurfacesAndShowsSaving`, `rapidCompleteReopenCompleteCoalescesAndSerializes`, `differentTasksSaveIndependently`, `outOfOrderQueryResponsesCannotRevertNewerIntent`, `timeoutReconcilesCommittedServerStateBeforeRetry`, `failureRollsBackAndRetryPersistsLatestIntent`, `oldUserResponseIsIgnoredAfterAccountSwitch`, and `fieldPatchResponseCannotOverwriteCompletion`. Use controlled promises and a shared QueryClient with distinct `['tasks', userId]`/`['tasks', userId, 'detail', id]` keys; assert exact HTTP call sequence, latest UI, query-cache fields and error lifetime.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test -- src/task/TaskCompletionProvider.test.tsx`; expected FAIL for missing provider/hook and API operations.
- [ ] **Step 3 — Implement:** Add narrow API methods and provider/hook. Route layout must keep the provider mounted across list↔page navigation; do not put it inside `TaskWorkspace`. Coordinate with existing `useUpdateTask.ts` cache writes so its full task response cannot regress completion (merge only field(s) being saved or derive from current authoritative lifecycle data; test concurrent PATCH). Guard stale account response and session re-verification, matching `TaskWorkspace`/detail session privacy behavior. Keep coordinator lean: no Redux/Zustand, broad event bus, offline queue, or hidden promises that swallow failures.
- [ ] **Step 4 — Verify GREEN:** `cd client && npm run test -- src/task/TaskCompletionProvider.test.tsx`; expected all coordinator tests PASS.
- [ ] **Step 5 — Commit:** `git add client/src/task/api.ts client/src/task/TaskCompletionProvider.tsx client/src/task/TaskCompletionProvider.test.tsx client/src/task/TasksRouteLayout.tsx client/src/task/useUpdateTask.ts client/src/task/*.test.tsx && git commit -m "feat(tasks): serialize optimistic completion with rollback and retry"`. Stage only genuinely changed files rather than using a blanket glob if it would include unrelated work.

### Task 3: Independent accessible checkbox and feedback in task rows

**Files:** Create `client/src/task/TaskCompletionToggle.tsx`, `TaskCompletionFeedback.tsx`; Modify `TaskRow.tsx`, `TaskSection.tsx`, `TaskRow.test.tsx`; adjust `TaskWorkspace.tsx` only to supply owner ID/retention callback when required by the row interface.

**Interfaces:**
- `TaskCompletionToggle({taskKey, completed, onToggle}: {taskKey:string; completed:boolean; onToggle:()=>void}): JSX.Element` displays 22px-class circular semantic checkbox with `role="checkbox"`, `aria-checked`, accessible action name `Complete TASK-7` / `Reopen TASK-7`, visible focus ring; no nested row button.
- `TaskCompletionFeedback({taskKey, saving, error, onRetry}: {taskKey:string; saving:boolean; error:string|null; onRetry:()=>void}): JSX.Element | null`; show `Saving…` with accessible status and persistent local `role="alert"` with Retry as appropriate; IDs/labels must not collide if list and panel show the same task.
- `TaskRowProps` adds `userId: number` and optional `onCompletionIntent?: (taskId:number, completed:boolean)=>void` (see Task 4); `TaskSection` forwards both. Each row obtains `useTaskCompletion(userId, task)`.

- [ ] **Step 1 — RED:** Update `TaskRow.test.tsx` assertions for two sibling buttons (completion and existing row opener), keyboard Space/Enter on checkbox, no unintended row open, checked/struck title in **Active** when `task.completedAt !== null` or optimistic state is checked, saving output, persistent inline Retry after failure, and unchanged two-line metadata. Existing tests that assert exactly one button must be revised only for the intended checkbox addition.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test -- src/task/TaskRow.test.tsx`; expected new behavior tests FAIL (checkbox absent).
- [ ] **Step 3 — Implement:** Use `useTaskCompletion` to drive appearance, never infer completion solely from `TaskSection.title`; keep the row-opening button separate. The checkbox must not open the panel. Reuse the two small display components for title/details later. Notify the list owner of latest completed/reopened intent through the optional callback.
- [ ] **Step 4 — Verify GREEN:** `cd client && npm run test -- src/task/TaskRow.test.tsx`; expected PASS including existing metadata and accessibility tests.
- [ ] **Step 5 — Commit:** `git add client/src/task/TaskCompletionToggle.tsx client/src/task/TaskCompletionFeedback.tsx client/src/task/TaskRow.tsx client/src/task/TaskSection.tsx client/src/task/TaskRow.test.tsx client/src/task/TaskWorkspace.tsx && git commit -m "feat(tasks): add independent completion control and inline feedback"`.

### Task 4: Ephemeral list-session retention and classification

**Files:** Modify `client/src/task/task-view.ts`, `task-view.test.ts`, `TaskWorkspace.tsx`, `TaskWorkspace.test.tsx` (and row/section props only if needed). Retention lives **inside TaskWorkspace**, not the task provider/route layout or Query cache.

**Interfaces:**
- `classifyTasks(tasks: readonly TaskSummary[], now: Date, retainedCompletedIds?: ReadonlySet<number>, effectiveCompletedById?: ReadonlyMap<number, boolean>): TaskSections` preserves current two-argument callers and returns disjoint Active/Completed arrays. Effective=false means Active immediately even when persisted timestamp is still non-null; effective=true uses retention first, then treats pending newly completed tasks as completed today for this **view only** (no fabricated persisted timestamp).
- `TaskWorkspace` owns `Set<number>` for the mounted list session; `onCompletionIntent(taskId:number, completed:boolean)` updates the set. A checkbox in an open panel must call this same callback (plumb via Task 5). Call `useTaskCompletionSnapshot(userId)` once from `TaskWorkspace` (not in a loop); pass its effective boolean projection into the classifier so reopening a Completed row enters Active synchronously while preserving canonical server timestamps.
- No retention is added for tasks already archived/deleted; archived tasks remain excluded and historical visibility is not implemented here.

- [ ] **Step 1 — RED:** Add pure classifier tests `optimisticReopenFromCompletedMovesToActiveBeforeResponse`, `optimisticCompleteUsesRetainedActiveWithoutFakePersistedTimestamp`, `retainedCompletedTaskBelongsOnlyToActive`, `archivedTaskCannotBeRetained`, `oldCompletionFollowsHistoricalVisibilityAfterReentry` and workspace tests `completedRowStaysCheckedInActiveAndReopens`, `panelSwitchAndReturnPreserveRetention`, `unmountRemountClearsRetention`, `ownerSwitchClearsRetention`, `completedTodayAfterFreshMountBelongsInCompleted`, and `noDuplicateRowsOrCounts`. Simulate list↔dedicated-page lifecycle with explicit unmount/remount or router tests; sorting/toggle controls belong to future issues—verify any currently present controls do not clear state, but do not introduce them.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test -- src/task/task-view.test.ts src/task/TaskWorkspace.test.tsx`; expected new tests FAIL for missing retention and optimistic placement.
- [ ] **Step 3 — Implement:** Apply retention overlay only to eligible list-visible tasks. Retain on completion intent (including panel-based completion), release on reopening, reset on list unmount/reentry/account switch. Do not rely on provider lifetime for retention; Task route layout deliberately survives list↔page navigation. Ensure section count is based on rendered row arrays, never double count. Recheck `completedAt` local-day semantics in existing `useLocalDay`.
- [ ] **Step 4 — Verify GREEN:** `cd client && npm run test -- src/task/task-view.test.ts src/task/TaskWorkspace.test.tsx`; expected all tests PASS, including prior local-day and session-loading cases.
- [ ] **Step 5 — Commit:** `git add client/src/task/task-view.ts client/src/task/task-view.test.ts client/src/task/TaskWorkspace.tsx client/src/task/TaskWorkspace.test.tsx && git commit -m "feat(tasks): retain optimistic completions for the mounted list session"`.

### Task 5: Side-panel and dedicated-page checkbox; dirty-edit safety

**Files:** Modify `client/src/task/TaskDetailView.tsx`, `TaskDetailSurface.tsx`, `TaskDetailView.test.tsx`, `TaskDetailSurface.test.tsx`, `TasksListPage.tsx` or `TaskWorkspace.tsx` only if callback plumbing requires it; add focused integration test to `client/src/task/TaskFieldEdit.test.tsx` if existing test layout provides better guard coverage.

**Interfaces:**
- `TaskDetailViewProps` gains `onCompletionIntent?: (taskId: number, completed: boolean) => void`; `TaskDetailSurfaceProps` forwards it when surface is `panel`; full-page passes no callback.
- `TaskDetailView` uses `useTaskCompletion(userId, task)` and `TaskCompletionToggle`/`TaskCompletionFeedback` from Tasks 2–3. Add a checkbox directly beside the existing H1/title field editor; preserve exact heading semantics and typography (including title edit mode).

- [ ] **Step 1 — RED:** Tests `panelAndPageBothShowParentTaskCheckboxBesideTitle`, `detailCompletionImmediatelyUpdatesOpenListRow`, `archivedTaskTogglesWithoutChangingArchive`, `dirtyTitleDraftSurvivesCompleteReopenAndBackgroundRefetch`, `dirtyPriorityOrDueDateDraftSurvivesCompletionFailure`, `completionNeverTriggersDirtyNavigationGuard`, `detailSavingAndPersistentRetryMatchRow`, and `titleHeadingSemanticsStayAccessibleInReadAndEditModes`. Preserve existing draft-navigation guard tests for real close/navigation.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test -- src/task/TaskDetailView.test.tsx src/task/TaskDetailSurface.test.tsx`; expected new tests FAIL for absent completion affordance and feedback.
- [ ] **Step 3 — Implement:** Wrap existing editable title with sibling checkbox/feedback in both surfaces via shared `TaskDetailView`; do not clone details UI or add another completion toolbar. Use the approved field-edit navigation logic unchanged; do not invoke guard for completion. When panel is mounted from list, send completion intent to TaskWorkspace retention callback; when page is open standalone, the list is unmounted and retention should not be created.
- [ ] **Step 4 — Verify GREEN:** `cd client && npm run test -- src/task/TaskDetailView.test.tsx src/task/TaskDetailSurface.test.tsx src/task/TaskWorkspace.test.tsx`; expected PASS including dirty-edit and field-update regressions.
- [ ] **Step 5 — Commit:** `git add client/src/task/TaskDetailView.tsx client/src/task/TaskDetailSurface.tsx client/src/task/TaskDetailView.test.tsx client/src/task/TaskDetailSurface.test.tsx client/src/task/TaskWorkspace.tsx && git commit -m "feat(tasks): support task completion in details without losing drafts"`.

### Task 6: Browser acceptance, cross-surface regressions, final verification

**Files:** Create `client/e2e/task-completion.spec.ts`; update existing `client/e2e/task-detail.spec.ts`/`client/e2e/task-edit.spec.ts` only for expected completion-control additions. No production file modifications unless a RED browser test reveals a genuine defect.

**Interfaces:** Use `**/api/v1/users/me`, `**/api/v1/tasks`, `**/api/v1/tasks/:id` and explicit `**/api/v1/tasks/:id/complete|reopen` mock routes in priority order (watch Playwright's most-recent route matching behavior); maintain stateful mock `completedAt` across GET/list/POST and use blocked/deferred promises for pending feedback.

- [ ] **Step 1 — RED:** Author browser scenarios `completeThenReopenInActiveWhilePending`, `panelAndDedicatedPageCompletionUsesSameControl`, `navigateToPageAndBackEndsListRetention`, `reloadDisplaysTodayCompletionInCompleted`, `serverFailureRestoresStateAndShowsPersistentRetry`, and `dirtyFieldDraftRemainsEditableOnCompletion`. Verify keyboard access and no accidental panel navigation. Keep frozen test time/local-day fixtures deterministic; history and sorting feature controls are not created here.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test:e2e -- task-completion.spec.ts`; expected newly added scenarios FAIL before final route/UI corrections if any; if they pass directly because Tasks 1–5 already cover the behavior, record this truth in the executing-plans ledger rather than introducing an artificial defect.
- [ ] **Step 3 — Implement minimal cross-layer fixes required by reproducible failures** only; preserve approved mockup density, existing routes and no-checklist-warning boundary.
- [ ] **Step 4 — Verify GREEN:** `cd client && npm run test:e2e -- task-completion.spec.ts`; expected all new browser scenarios PASS.
- [ ] **Step 5 — Full checks:** `cd server && ./mvnw test`; `cd client && npm run test`; `cd client && npm run typecheck`; `cd client && npm run lint`; `cd client && npm run format:check`; `cd client && npm run build`; `cd client && npm run test:e2e`. Also run repository-required backend formatting/static checks from `AGENTS.md`/build configuration. Expected all exit 0. Log any environment blockers with actual output; do not claim unrun checks pass.
- [ ] **Step 6 — Commit:** `git add client/e2e/task-completion.spec.ts && git add -u && git commit -m "test(tasks): cover completion lifecycle across browser views"` (stage only issue #21 files, no unrelated work).
- [ ] **Step 7 — Whole-branch review:** Under `superpowers:executing-plans`, generate its `review-package` against the branch merge-base, obtain an independent whole-branch review when a reviewer tool is available, regrade/fix Important/Critical findings with RED→GREEN tests, ledger rulings/deferred minors, then follow `superpowers:finishing-a-development-branch`. Do not merge without the normal owner/repository approval.

## Final acceptance matrix

| Approved requirement | Implemented/tested by |
| --- | --- |
| Persistence, idempotency, no status enum, own-user `404` | Task 1 |
| Archived completion allowed, deleted excluded | Tasks 1, 4, 5 |
| Optimistic immediate click and latest-click-wins serial writes | Task 2 |
| Ambiguous failure reconciliation, rollback, persistent Retry | Tasks 2, 3, 5, 6 |
| Saving indicator but still-clickable checkbox in all views | Tasks 2, 3, 5 |
| Independent accessible list-row checkbox, unchanged row opener | Tasks 3, 6 |
| List-session retention, reset on page/reentry/refresh | Tasks 4, 6 |
| Checkbox beside editable detail title, clean draft retention | Tasks 5, 6 |
| Checklist items unchanged; warning deferred to #22 | Tasks 1, 5 + scope gate |
| Tests, formatting/static checks, whole-branch review | Tasks 1–6 |

## Luna — inline execution handoff

1. Read and obey this plan, its approved spec, `AGENTS.md` files, and `docs/design/tasks-workspace/DESIGN-SPEC.md`.
2. **Mandatory:** use `superpowers:executing-plans` **INLINE/NATIVE** (same implementation session) with its ledger, task-start/task-done scripts, and test-driven-development. **No subagent-driven development and no per-task implementer delegation.**
3. Use the issue's dedicated branch/worktree; start from **Task 1**; work every step, watch RED before GREEN, commit per task, and do not ask for approval between tasks. Preserve approved decisions even when older PRD/mockup internals disagree.
4. If a local plan detail is wrong, resolve against the approved spec and record a `Ruling:` in the ledger, including cost if wrong. Stop only on executing-plans' explicit safety/security/external-side-effect gates.
5. At completion: whole-branch review, verified tests and checks, list rulings/deferred minors, and a concise implementation/verification summary with branch/PR link. Do not mark issue done based on unverified output.

**Status:** Awaiting owner approval of this written plan before Luna executes product changes.
