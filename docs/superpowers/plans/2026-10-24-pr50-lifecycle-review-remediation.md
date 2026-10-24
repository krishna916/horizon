# PR #50 — Task lifecycle review remediation implementation plan

> **For Luna:** REQUIRED SUB-SKILL: `superpowers:executing-plans` **INLINE in the current session**. Do not use `superpowers:subagent-driven-development`, implementer/reviewer subagents, or `superpowers:using-git-worktrees`. The owner explicitly approved **working on the existing feature branch without a worktree**, task-by-task TDD, final self-review, and pushing fixes to the existing PR. Track each checkbox and the skill's ledger. Do not pause between tasks. **Do not merge.**

**Goal:** Fix all four findings in the review of [PR #50](https://github.com/krishna916/horizon/pull/50#pullrequestreview-5637523420), restore the originally approved issue #23 behavior in failure/concurrency/session edge cases, and get the existing PR ready to merge after review.

**Architecture:** Keep the existing Task domain/API unchanged. Fix frontend lifecycle notices, row-to-route callback propagation, the draft guard's action dispatch scope, and authenticated notice presentation inside `client/src/task/`. Use per-user/per-task TanStack Query keys and the existing route-local `TaskLifecycleProvider`; do not add a global store, new API, library, task status enum, or broad rewrite.

**Tech Stack:** React 19, TypeScript, TanStack Query/Router, Axios, Radix, Vitest/RTL, Playwright. Existing Java 25/Spring Boot/PostgreSQL backend must remain regression-green.

**Spec / source of truth:** `docs/superpowers/specs/2026-10-24-issue-23-task-archive-trash-design.md`; original `docs/superpowers/plans/2026-10-24-issue-23-task-archive-trash-implementation.md`; review [#5637523420](https://github.com/krishna916/horizon/pull/50#pullrequestreview-5637523420) and its four inline comments; issue #23, PRD-004, SPEC-001, Constitution.

**Branch / PR:** Existing `feat/issue-23-task-archive-trash` → existing [PR #50](https://github.com/krishna916/horizon/pull/50), targeting `master`. The findings were identified on commit `c2953af1a345c6fef678f2282da828a63e9aa934`; inspect the current head before editing, and do not clobber subsequent changes.

## Global constraints

- This remediation is **approved to implement**. No new user confirmation is required for these documented fixes. If an unforeseen product conflict arises, raise it; for ordinary technical implementation decisions, use current Horizon patterns and ledgered rulings.
- Do not create a new branch, worktree or PR. No subagent-driven development or subagent review; use inline execution and a distinct final self-review pass.
- `Archive` remains immediate after unsaved-change resolution; `Delete` requires confirmation; Archive leaves detail open; Delete of the *selected* task returns to the list; both confirmed actions provide persistent Undo. Do not add auto-dismiss timers.
- **Never display an Undo-as-if-deleted notice for an unconfirmed DELETE.** A transport failure may happen after the server commits. The Retry path must remain accessible even after the row disappears due to a refetch, and it must be safe to reissue DELETE (server `TaskCommandService.softDelete` already tolerates repeated same-owner deletes).
- During session revalidation, hide prior user's task data **including task keys in lifecycle notices** and disable Undo/Retry. Retain notices if verification succeeds for the same owner; discard them on confirmed owner change or invalid session.
- Preserve timestamps, checklist state, owner isolation, task completion coordinator, draft protection, and derived lifecycle precedence. No server migration or new REST endpoint.
- No speculative refactor or new dependency. Read `client/AGENTS.md`, `server/AGENTS.md`, and the approved original design before editing.
- For every task: RED test → witness expected failure → minimal GREEN fix → targeted verification → scoped commit → ledger entry. Report failures rather than claiming green.

## File responsibility map

| Task | Files | Responsibility |
| --- | --- | --- |
| 1 — durable retry for uncertain Delete | Modify `client/src/task/TaskLifecycleProvider.tsx`, `TaskLifecycleNoticeList.tsx`, `TaskLifecycleProvider.test.tsx`, `TaskLifecycleNoticeList.test.tsx`; extend `client/e2e/task-lifecycle.spec.ts` | Task-specific non-expiring "delete not confirmed" Retry notice; transition to successful Undo only after confirmed DELETE; restore/reconcile on retry |
| 2 — selected row delete navigation | Modify `client/src/task/TaskRow.tsx`, `TaskSection.tsx`, `TaskWorkspace.tsx`; extend `TaskRow.test.tsx`, `TaskWorkspace.test.tsx` and/or `TasksListPage.test.tsx`, `client/e2e/task-lifecycle.spec.ts` | Route the row's successful Delete through existing `onDeleted` only when selected |
| 3 — independent lifecycle commands | Modify `client/src/task/TaskDraftNavigationGuard.tsx`; extend `TasksListPage.test.tsx`, `TaskLifecycleProvider.test.tsx` and relevant E2E only if needed | No global network-duration lock; preserve exactly-once dispatch of pending draft actions |
| 4 — session privacy | Modify `client/src/task/TasksRouteLayout.tsx`, optionally `TaskLifecycleNoticeList.tsx`; extend `TasksRouteLayout.test.tsx` and/or `TaskSessionBoundary.test.tsx` | Hide/disable prior-user notices while auth is unverified and clear them on owner change/error |
| 5 — final validation | No feature changes unless tests expose defects | Verify everything and update PR #50 |

## Review focus: regressions that must be proven, not assumed

1. **Committed DELETE, lost response, list refetch:** original task row is gone but a truthful, task-specific Retry remains; successful idempotent retry yields Undo; no fabricated success state — Task 1.
2. **Definitively failed or still-unconfirmed DELETE:** other tasks remain usable; notice remains until dismiss/navigation; no automatic Undo claim; repeated retry is safe — Task 1.
3. **Selected versus different row:** deleting the task whose panel is open returns to `/tasks`, but deleting another row does *not* close or navigate away from the selected detail — Task 2.
4. **Task A pending and task B clicked:** task B's Archive/Delete request starts promptly rather than being dropped; repeated action for A remains deduped; unsaved-draft action still runs exactly once after Save/Discard — Task 3.
5. **Session revalidation with existing notice:** prior task keys and controls disappear while verifying, reappear on same-owner success, never appear under a different owner or after verification error — Task 4.

---

### Task 1: Keep uncertain Delete recovery available after the row disappears

**Finding:** [LifecycleProvider inline review](https://github.com/krishna916/horizon/pull/50#discussion_r4366532166).

**Files:**
- Modify: `client/src/task/TaskLifecycleProvider.tsx`, `TaskLifecycleNoticeList.tsx`
- Test: `client/src/task/TaskLifecycleProvider.test.tsx`, `TaskLifecycleNoticeList.test.tsx`, `client/e2e/task-lifecycle.spec.ts`

**Interfaces / behavior:**
- Extend the existing `LifecycleNotice` model with a small discriminated `kind: 'undo' | 'delete-unconfirmed'` (or an equivalently explicit discriminant). Existing successful archive/delete notices use `kind: 'undo'` and existing Undo/Retry-on-Undo behavior remains unchanged.
- For any unsuccessful DELETE request without authoritative confirmation, publish/retain exactly one persistent `delete-unconfirmed` notice for the owner/task. Text states **"Couldn't confirm moving TASK-N to Trash"**, never "TASK-N moved to Trash"; offer **Retry** and **Dismiss**, not Undo. Keep retry intent (`TaskSummary` snapshot/id) inside the Tasks lifecycle provider, not on the row component.
- Introduce `retryDelete(noticeId: string): Promise<boolean>` on `TaskLifecycleApi` (or a named method with identical semantics). It uses the saved owner/task intent and reissues the same already-idempotent `taskApi.softDelete(id)`. If confirmed, remove task from ordinary Query caches and replace the unconfirmed notice with the existing `kind: 'undo'` Delete notice; Undo still invokes `restoreDeleted`. If the retry remains unsuccessful, retain the unconfirmed notice with a usable Retry.
- The existing row-level failure message/Retry may stay for convenience, but **must not be the only way back**. Keep notices persistent across list/panel/full-page routes and subsequent list invalidation. Do not create a global Trash screen or expose deleted tasks through ordinary GET.
- Preserve current successful Archive, Undo-Archive, successful Delete, Undo-Delete, and failed-Undo paths. Avoid duplicate notices and concurrent double retries on the same task. A same-task subsequent confirmed action supersedes obsolete notices.
- Use the existing `TaskCommandService.softDelete` repeat-delete behavior; no backend mutation is needed unless verification reveals a real gap.

- [ ] **Step 1 — RED provider:** In `TaskLifecycleProvider.test.tsx`, add `timedOutDeleteRetainsRecoverableNoticeAfterServerSideDeletionAndRefetch`: model DELETE request rejected after mock server state becomes deleted; trigger/list refetch so row is absent; assert task-specific **unconfirmed** notice and Retry still exist independently of the row, with no Undo-success wording; let retry return HTTP 204; assert list remains absent, notice becomes confirmed Delete/Undo, then `restoreDeleted` returns it to the list.
- [ ] **Step 2 — RED distinct failure modes:** Add `unconfirmedDeleteRetryCanFailTwiceWithoutLosingNotice`, `unconfirmedDeleteDismissDoesNotMisreportSuccess`, and `confirmedArchiveAndDeleteUndoAreUnaffected`. Assert only one notice per affected task and unrelated task notices coexist.
- [ ] **Step 3 — RED component/browser:** In `TaskLifecycleNoticeList.test.tsx`, assert correct roles/text/buttons for `delete-unconfirmed` versus `undo`. In `client/e2e/task-lifecycle.spec.ts`, update the route stub so it can commit DELETE to mock state then abort the transport response; trigger a later list fetch via an unrelated task action; assert Retry/Undo flow remains reachable without the deleted row.
- [ ] **Step 4 — Verify RED:** Run `cd client && npm run test -- src/task/TaskLifecycleProvider.test.tsx src/task/TaskLifecycleNoticeList.test.tsx`. Expected: new assertions fail because no independent uncertain-Delete notice/Retry exists. Run targeted E2E once to witness failing new browser scenario if environment permits.
- [ ] **Step 5 — GREEN:** Implement the narrow notice discriminant + provider Retry operation and UI; keep the retry intent until confirmed or dismissed, protect same-task operation dedup, and keep Query cache reconciliation honest.
- [ ] **Step 6 — Verify GREEN:** Repeat targeted Vitest and `cd client && npm run test:e2e -- task-lifecycle.spec.ts`. Expected: new and pre-existing lifecycle tests pass.
- [ ] **Step 7 — Commit:** `git add client/src/task/TaskLifecycleProvider.tsx client/src/task/TaskLifecycleNoticeList.tsx client/src/task/TaskLifecycleProvider.test.tsx client/src/task/TaskLifecycleNoticeList.test.tsx client/e2e/task-lifecycle.spec.ts && git commit -m "fix(tasks): retain recovery retry after uncertain soft delete"`

### Task 2: Return to Tasks list when the selected task is deleted via its row menu

**Finding:** [TaskRow inline review](https://github.com/krishna916/horizon/pull/50#discussion_r4366532171).

**Files:** Modify `client/src/task/TaskRow.tsx`, `TaskSection.tsx`, `TaskWorkspace.tsx`; test adjacent `*.test.tsx` and `client/e2e/task-lifecycle.spec.ts`.

**Interface:** Carry `onDeleted?: (taskId: number) => void` from `TaskWorkspace` through `TaskSection` to `TaskRow`; pass `onDeleted={() => onDeleted?.(task.id)}` to its `TaskLifecycleActions`. In `TaskWorkspace`, call its existing outer `onDeleted?.()` route navigation callback **only if** `selection.kind === 'valid' && selection.id === taskId`. For non-selected row deletion, do not navigate. Keep header Delete as-is and invoke onDeleted only after confirmed server success.

- [ ] **Step 1 — RED:** Add React tests `deletingSelectedTaskFromRowClosesItsDetailSelection` and `deletingDifferentRowKeepsCurrentDetailOpen`. Assert that canceled/failed Delete does not navigate. In Playwright add `selectedPanelRowMenuDeleteReturnsToListAndUndoRemains`: navigate to `/tasks?task=1`, delete via `More actions for TASK-1`, accept confirmation, assert `/tasks` URL, closed panel, persistent Undo, and eventual recovery. The separate-task case keeps `?task=1` when deleting TASK-2.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test -- src/task/TaskRow.test.tsx src/task/TaskWorkspace.test.tsx src/task/TasksListPage.test.tsx`. Expected: new selected-row behavior fails; optionally run targeted E2E for browser red evidence.
- [ ] **Step 3 — GREEN:** Wire only the callbacks described above through the existing `TaskSection` / `TaskRow` boundary. Avoid modifying `TaskLifecycleProvider` for routing and avoid a global navigation effect.
- [ ] **Step 4 — Verify GREEN:** Repeat the targeted Vitest and `cd client && npm run test:e2e -- task-lifecycle.spec.ts`. Expected: selected deletion navigates, other deletion does not, Undo remains.
- [ ] **Step 5 — Commit:** `git add client/src/task/TaskRow.tsx client/src/task/TaskSection.tsx client/src/task/TaskWorkspace.tsx client/src/task/*.test.tsx client/e2e/task-lifecycle.spec.ts && git commit -m "fix(tasks): close selected detail after row soft delete"`

### Task 3: Remove the global network-duration mutex from the draft action guard

**Finding:** [DraftNavigationGuard inline review](https://github.com/krishna916/horizon/pull/50#discussion_r4366532174).

**Files:** Modify `client/src/task/TaskDraftNavigationGuard.tsx`; test `client/src/task/TasksListPage.test.tsx`, `TaskLifecycleProvider.test.tsx`, and `client/e2e/task-lifecycle.spec.ts` only where needed.

**Interface / guard invariants:**
- `requestAction(action, context)` still checks the **matching** active draft registration; dirty or pending affected task goes through the existing Save / Discard / Keep editing dialog; unrelated tasks do not discard that draft.
- The existing `actionInProgressRef` + `runAction()` must **not** remain held for the entire Promise returned by a lifecycle network command. Remove the global network-duration lock or confine the lock strictly to synchronous *queued dialog resolution*; it is not a per-task request coordinator.
- Keep `queuedActionRef` single-dispatch protection for Save/Discard, and `saveInProgressRef` double-submit protection. Do not break TanStack Router's normal navigation blocker or its logout special case.
- Let `TaskLifecycleProvider.runningRef` deduplicate **same user/task** requests; independent task requests must overlap safely. Never allow repeated Save to invoke the same queued action twice.

- [ ] **Step 1 — RED:** In `TasksListPage.test.tsx`, add `archiveTaskBWhileArchiveTaskAIsPendingIsNotDropped`: defer `taskApi.archive(1)` indefinitely while requesting archive(2); assert archive(2) was called and can complete before archive(1). Confirm task(1) sees no duplicate in-flight command. Add `queuedDirtyActionRunsExactlyOnceAfterSaveAndDoesNotBlockOtherTask`.
- [ ] **Step 2 — Verify RED:** `cd client && npm run test -- src/task/TasksListPage.test.tsx src/task/TaskLifecycleProvider.test.tsx`. Expected: task B call is missing under the current guard, while old navigation/dirty tests still pass.
- [ ] **Step 3 — GREEN:** Make guard scope transactional around pending draft decision rather than awaiting the lifecycle network request. Remove unnecessary global action-busy state if the existing queued-action + lifecycle dedup already guarantee single execution. Keep the smallest change; do not introduce another provider.
- [ ] **Step 4 — Verify GREEN:** Repeat targeted Vitest and `cd client && npm run test:e2e -- task-lifecycle.spec.ts`. Expected: independent actions overlap, queued dirty actions remain exactly once.
- [ ] **Step 5 — Commit:** `git add client/src/task/TaskDraftNavigationGuard.tsx client/src/task/TasksListPage.test.tsx client/src/task/TaskLifecycleProvider.test.tsx client/e2e/task-lifecycle.spec.ts && git commit -m "fix(tasks): allow independent lifecycle actions during pending requests"`

### Task 4: Do not expose old lifecycle notices during session verification

**Finding:** [TasksRouteLayout inline review](https://github.com/krishna916/horizon/pull/50#discussion_r4366532178).

**Files:** Modify `client/src/task/TasksRouteLayout.tsx` and, only if needed, `TaskLifecycleNoticeList.tsx`; test `TasksRouteLayout.test.tsx` / `TaskSessionBoundary.test.tsx`.

**Interface:** Derive a `verifiedUserId`/visibility boolean from the existing `useCurrentUser()` result: authenticated data exists and `!isPending && !isFetching && !isError`. While unverified, **do not render** `TaskLifecycleNoticeList` and thereby remove Undo/Retry buttons from the DOM. During a background same-user verification, preserve provider/notices in memory but hide them; when the same user is confirmed, show them again. When the owner ID actually changes, the existing `TaskLifecycleProvider` key must replace prior-owner state. For session error, no old notices should reappear accidentally; clear/replace provider state when auth is invalid, without exposing user ID/key in UI.

- [ ] **Step 1 — RED:** In `TasksRouteLayout.test.tsx` or `TaskSessionBoundary.test.tsx`, construct real Tasks route + lifecycle notice via provider. Add `noticeIsHiddenAndNotActionableWhileCurrentUserIsFetching`: while a prior-user notice exists, trigger `useCurrentUser` refetch with unresolved promise; assert old task key/Undo/Retry absent and no recovery network request possible; then resolve same owner and assert original notice still present.
- [ ] **Step 2 — RED owner swap:** Add `noticeNeverAppearsUnderDifferentAccountOrFailedVerification`: resolve revalidation with a different user ID; assert old key absent permanently, even after navigation; repeat with session verification error and subsequent recover. Ensure list/details session hiding from existing code remains unchanged.
- [ ] **Step 3 — Verify RED:** `cd client && npm run test -- src/task/TasksRouteLayout.test.tsx src/task/TaskSessionBoundary.test.tsx`. Expected: unverified cached notices remain rendered in current implementation, causing the new test to fail.
- [ ] **Step 4 — GREEN:** Adjust the route layout's notice rendering and verified user lifecycle minimally. Avoid discarding a valid same-owner Undo notice on every ordinary refetch. Do not broaden to app-wide login/logout logic.
- [ ] **Step 5 — Verify GREEN:** Repeat targeted Vitest and existing session boundary/navigation/Undo tests; expected all pass.
- [ ] **Step 6 — Commit:** `git add client/src/task/TasksRouteLayout.tsx client/src/task/TaskLifecycleNoticeList.tsx client/src/task/TasksRouteLayout.test.tsx client/src/task/TaskSessionBoundary.test.tsx && git commit -m "fix(tasks): hide recovery notices until session is verified"`

### Task 5: Full regression, final review and update the existing PR

- [ ] **Step 1 — Frontend tests:** `cd client && npm run test`; expected PASS, including all new regressions and previous completion/checklist/navigation tests.
- [ ] **Step 2 — Frontend static/build:** `cd client && npm run typecheck && npm run lint && npm run format:check && npm run build`; expected PASS.
- [ ] **Step 3 — Browser:** `cd client && npm run test:e2e`; expected PASS; ensure browser E2E specifically covers all four findings where practical.
- [ ] **Step 4 — Backend regression:** `cd server && ./mvnw test && ./mvnw verify`; expected PASS. These are regression checks; do not alter server code without evidence of a backend defect.
- [ ] **Step 5 — Review:** Review complete PR branch diff against `master` and all four PR comments. Check timestamp preservation, owner scoping, no hard delete, correct Retry vs Undo truthfulness, row navigation scope, independent tasks, and account isolation. Do the required **inline self-review** (no reviewer subagent); document remaining legitimate minor risks and rulings. If a critical/important regression is found, add failing test → fix → re-run full checks.
- [ ] **Step 6 — Update PR #50:** Push commits to `feat/issue-23-task-archive-trash` (existing PR updates automatically); add concise PR comment or append PR description reporting each finding addressed and tests added, linking this plan and original review. Reply to four inline threads where appropriate; don't claim resolution without the assertions. **Do not create a new PR and do not merge.**
- [ ] **Step 7 — GitHub CI:** Wait for CI/checks on the **new** PR head SHA, inspect backend/frontend/Sonar checks, fix failures, push, rerun; expected required checks all green. Separate CI coverage-reporting limitations from test execution results; no unrelated Sonar rewrite.
- [ ] **Step 8 — Final report:** Send owner PR URL, commits, finding→fix→test mapping, all actual command outputs/results, CI status tied to final SHA, and any unresolved/deferred issues. Never claim tests or CI succeeded without checking.

## Explicitly deferred / non-goals

- Epic #9 Global Trash listing or permanent delete; issue #25 Archived list/history controls.
- New backend lifecycle endpoint/schema, status enum, new global notification store, notification expiry, Redux/Zustand, generic concurrency framework.
- A zero-loss recovery mechanism **after** the owner explicitly dismisses the notice, navigates away, or refreshes (known accepted behavior until Global Trash exists).

## Definition of done

Four original inline review comments are covered by **new reproducible regression tests**, the actual code is fixed with minimal changes, no regressions in task completion/editor/list/session behavior, full applicable local validation green, and GitHub CI green at the *updated* PR head. Existing PR #50 remains open for owner approval.
