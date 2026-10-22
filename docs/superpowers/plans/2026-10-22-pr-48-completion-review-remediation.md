# PR #48 — Task Completion Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` **INLINE/NATIVE**, task by task. Do **not** use `superpowers:subagent-driven-development` or delegate individual implementation/review tasks to subagents. Steps use `- [ ]` checkboxes. This execution method is the owner's explicit preference.

**Goal:** Resolve the two verified completion/reopening correctness findings in [PR #48](https://github.com/krishna916/horizon/pull/48) without changing the approved issue #21 UX or introducing new infrastructure.

**Architecture:** Keep the existing global `TaskCompletionProvider`, owner-scoped TanStack Query cache, and list-local retention set. Give the coordinator an explicit *unverified/unknown server outcome* distinction instead of treating failed reconciliation as an authoritative state; have the list retain an in-session completed row through an optimistic Reopen until its successful persistence is confirmed. Tests must prove the two failure sequences rather than relying on the existing happy-path suite.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, Axios, Vitest/React Testing Library, Playwright. Existing Java 25/Spring Boot 4/PostgreSQL 17 API is unchanged.

**Spec:** `docs/superpowers/specs/2026-10-22-issue-21-task-completion-design.md` (approved), `docs/superpowers/plans/2026-10-22-issue-21-task-completion-implementation.md` (original approved plan); PR #48 review at head `c4d7a2c2ae2df8efabaeb6bc12cced0a6f1fc4f6`.

## Global Constraints

- Work on **the existing PR branch** `feat/issue-21-task-completion` (base: `master`). Use an isolated worktree according to `superpowers:using-git-worktrees`. Do not create another branch, change `master`, or merge the PR.
- Before coding, read this plan, the approved spec, PR's latest diff, `client/AGENTS.md`, and the repo's testing guidance. **Confirm the two findings still reproduce on current HEAD.** If a finding has already been fixed, demonstrate that with a regression test, note the resolution, and do not make a redundant edit.
- Run `superpowers:executing-plans` **inline** with its task ledger, TDD and verification sub-skills. Write each failing regression test before changing production code; watch RED, fix minimally, watch GREEN, then commit per task. Continue through tasks without additional approval prompts.
- Do not change backend completion/reopen endpoints, DTOs, DB schema, navigation boundaries, styling, checklist behavior, or any other task feature. Do not add a state-management library, general queue, offline persistence, or global error/toast framework.
- The approved list UX is authoritative: a completed row initiated from Active remains temporarily checked/struck-through in Active until the Tasks **list context** ends; side-panel changes do not reset it. Reopen is optimistic; failure rolls back to the last confirmed completed state and **must not move the row out of Active**.
- Unknown result is **not** `completedAt = null` or any other confirmed fact. If a POST's outcome is ambiguous and its authoritative GET also fails, keep a persistent inline error/Retry and never quietly declare the latest intent saved, even when it equals the stale last-known boolean.
- Preserve latest-intent-wins when multiple clicks occur during pending requests and owner scope for cache writes. No duplicate concurrent commands for the same task; no loss of unsaved field drafts. Maintain the existing routine `Saving…` and inline Retry visual presentation.
- Update only still-valid findings. Keep changes small and test-driven. Avoid preemptively fixing unrelated SonarQube issues or broad refactors under this PR.

## Review Focus

Five scenarios are especially easy to miss in a narrow fix; each belongs in the indicated task's tests.

1. **POST may have committed, GET unavailable, later click reverses intent:** unknown outcome must remain actionable, never silently succeed (Task 1).
2. **Retry after unknown outcome:** do not short-circuit on stale `confirmedAt`; recover by authoritative GET and/or a successful idempotent command, retaining error when recovery fails (Task 1).
3. **Reconciliation GET succeeds:** if server already matches latest intent, settle without unnecessary command; otherwise serialize the next required command (Task 1).
4. **Completed-in-Active → optimistic Reopen → API failure:** checked task remains in Active with inline error/Retry and no duplicate Completed row (Task 2).
5. **Completed-in-Active → successful Reopen, or list-session exit:** completed-only retention is released after success; later Complete in same list session may retain again; leaving/reentering uses timestamps (Task 2).

---

## File map

| Task | Modify | Responsibility |
| --- | --- | --- |
| 1 | `client/src/task/TaskCompletionProvider.tsx`; `client/src/task/TaskCompletionProvider.test.tsx` | Represent unknown server outcome; correct settlement/reconciliation and Retry |
| 2 | `client/src/task/TaskWorkspace.tsx`; `client/src/task/TaskWorkspace.test.tsx`; `client/e2e/task-completion.spec.ts`; `client/src/task/TaskSection.tsx` **only if test-driven interface needs it** | Preserve/release temporary retention based on confirmed Reopen rather than optimistic intent; browser proof |

Existing `client/src/task/task-view.ts` should remain unchanged unless a specific failing classifier test proves a deficiency. Other files may change only to repair a confirmed regression and must be recorded in the execution ledger.

### Task 1: Never mistake an uncertain completion outcome for confirmed state

**Files:**
- Modify: `client/src/task/TaskCompletionProvider.tsx` (current `run` error path around lines 101–151 and `retry`/settlement logic).
- Test: `client/src/task/TaskCompletionProvider.test.tsx`.

**Interfaces:**
- Existing public hook contract stays `useTaskCompletion(userId: number, task: TaskSummary)` returning `completed`, `saving`, `error`, `toggle`, `retry`; existing `useTaskCompletionSnapshot(userId)` remains compatible.
- Extend internal `CompletionEntry` with a narrow explicit uncertainty marker such as `outcomeUnknown: boolean` (or equally clear discriminated state); **do not** infer server confirmation from the nullable `confirmedAt` alone.
- A completed API response or successful authoritative `taskApi.get(taskId)` makes the state *known*; if both fail, it is *unknown*. Unknown state must disable the current `desired === confirmed` early-exit assumption until recovery is actually verified.

- [ ] **Step 1 — Write RED tests** with controlled promises and existing `Probe`/QueryClient setup. Add:
  - `failedPostAndFailedGetAfterRapidReopenShowsPersistentRetry`: initial `completedAt=null`; Complete starts; user clicks Reopen before POST settles; POST rejects as timeout *after hypothetical server commit*; GET rejects. After settling, assert checkbox shows **last confirmed** incomplete state, `Saving…` stops, an inline alert/Retry persists, and no false success or silent entry deletion happens. Retry must remain operative even though last known and latest desired are both incomplete.
  - `unknownOutcomeRetryStillFailsGetKeepsError`: click Retry while GET remains unavailable; alert remains actionable, no unverified success.
  - `unknownOutcomeRetryReconcilesAndPersistsLatestIntent`: server GET now reports completed timestamp; invoke Retry; serialize one Reopen; assert final server/cache `completedAt=null`, no lingering error, correct call order, no duplicate overlapping requests.
  - `knownReconciliationMatchingLatestIntentFinishesCleanly`: POST rejects, authoritative GET succeeds with the latest desired completion fact; no extra command or error; verify last-click precedence.
  - `unknownFailureDoesNotLeakAcrossUsers`: switch `userId` while unresolved; no cross-user cache/UI update or retry action on new owner.
- [ ] **Step 2 — Run RED:** `cd client && npm run test -- src/task/TaskCompletionProvider.test.tsx`. **Expected:** the newly added unknown-outcome cases fail on current PR code (at least the same-as-stale-confirmed scenario), existing tests remain green.
- [ ] **Step 3 — Implement minimal fix:** In `run`, distinguish **POST failed + GET succeeded** from **POST failed + GET failed**. For unknown outcome, do not enter the normal confirmed-state equality short circuit, including when `latest.version > requestedVersion`; end pending feedback, restore the **last actually confirmed** visible state, persist inline error and the **latest** retry intent. On Retry/new intent, first re-establish authoritative state (or complete a fresh idempotent command that conclusively persists the latest intent); if recovery remains unverified, keep the error. In the known case, continue existing serialized coalescing and settle against real server fact. Keep `running` and `entriesRef` bookkeeping atomic for rapid clicks; avoid creating a second mutation coordinator.
- [ ] **Step 4 — Run GREEN:** `cd client && npm run test -- src/task/TaskCompletionProvider.test.tsx`. **Expected:** all provider cases pass; original rapid-toggle, timeout-GET-success, query race and owner-switch tests stay green.
- [ ] **Step 5 — Commit:** `git add client/src/task/TaskCompletionProvider.tsx client/src/task/TaskCompletionProvider.test.tsx && git commit -m "fix(tasks): retain retry on unverified completion outcomes"`.

### Task 2: Keep in-session completed rows retained after failed Reopen

**Files:**
- Modify: `client/src/task/TaskWorkspace.tsx` (current `onCompletionIntent` clears retained ID immediately for `!completed`, lines ~88–98).
- Test: `client/src/task/TaskWorkspace.test.tsx`, `client/e2e/task-completion.spec.ts`.
- Modify only if required: `client/src/task/TaskSection.tsx` (completion intent callback), `client/src/task/TaskCompletionProvider.tsx` (expose existing settlement fact narrowly; reuse Task 1 state, do not duplicate mutation tracking).

**Interfaces:**
- Preserve `TaskWorkspace`'s local `{ ownerId, completedIds }` retention and `classifyTasks(tasks, now, retainedCompletedIds, completionSnapshot)` call.
- `onCompletionIntent(taskId, completed)` still adds to retention when completing a task from Active. A *tentative* Reopen must not irreversibly release retention; release only after Reopen has been **confirmed by the backend**, or at the usual list-session boundary.
- The same row is shown once; when optimistic Reopen is in flight, it is unchecked in Active. If Reopen fails and the server remains completed, return to **checked/struck-through in Active**, preserving inline error and Retry. A successful Reopen leaves it incomplete in Active and removes its completed-only retention marker. Recomplete may retain again.
- Distinguish the outcome for already-completed tasks that were in Completed before the current list session: those were **not** previously retained and must return to Completed after failed Reopen; do not globally pin all completed tasks into Active.
- If a confirmed `completedAt = null` is used to clear retention, make sure pending optimistic cache snapshots, canceled GETs, and still-running mutations do **not** cause premature release. Prefer a narrow existing coordinator/cache confirmation signal over another independent network request.

- [ ] **Step 1 — Write RED RTL tests**:
  - `failedReopenKeepsPreviouslyRetainedCompletedTaskInActive`: start incomplete, Complete and await server confirmation; click Reopen, assert immediate unchecked Active; make Reopen reject and authoritative GET return completed timestamp; assert checked row **still in Active**, alert and Retry visible, no duplicate in Completed.
  - `retryFailedReopenEventuallyClearsRetentionOnConfirmedSuccess`: from preceding failure state, Retry, successful Reopen, verify incomplete Active, saving/error cleared; subsequent Complete is again retained until list-session exit.
  - `failedReopenOfPreexistingCompletedTaskReturnsToCompleted`: initially in Completed (no session-retention), optimistic Reopen enters Active; Reopen fails, GET confirms completed; row returns to Completed with local alert.
  - `listUnmountAfterFailedReopenReclassifiesFromPersistedTimestamp`: verify retention ends on list unmount/page transition and today's saved completed timestamp yields Completed.
- [ ] **Step 2 — Run RED:** `cd client && npm run test -- src/task/TaskWorkspace.test.tsx`. **Expected:** first scenario fails on current PR; other tests expose any stale-marker/double-render defect.
- [ ] **Step 3 — Implement minimal fix:** Keep the existing list-local presentation state but change its release condition to **confirmed successful reopening**, not the checkbox click itself. Reuse the task-scoped coordinator's confirmation state (and owner-scoped list cache if appropriate) rather than creating a second async queue. Preserve archived/deleted precedence, previously approved list/page boundary and draft editing. Do not make completion checks wait for server.
- [ ] **Step 4 — Run GREEN:** `cd client && npm run test -- src/task/TaskWorkspace.test.tsx src/task/task-view.test.ts src/task/TaskCompletionProvider.test.tsx`. **Expected:** all retention, classifier, coordinator, owner and rapid-click tests pass.
- [ ] **Step 5 — Add Playwright regression** to `client/e2e/task-completion.spec.ts`: stateful route fixture with initial incomplete task; successful Complete; failed Reopen returning e.g. 503; GET confirms completed; assert inline Retry + task still in Active without duplicate Completed row. Retry Reopen successfully, then navigate to full page/back and confirm normal reentry classification. Extend mock fixtures minimally to fail the next **Reopen** (existing fixture currently only fails next Complete).
- [ ] **Step 6 — Verify browser GREEN:** `cd client && npm run test:e2e -- task-completion.spec.ts`. **Expected:** new failed-Reopen/retry scenario and existing completion/page/reload/draft scenarios pass.
- [ ] **Step 7 — Commit:** `git add client/src/task/TaskWorkspace.tsx client/src/task/TaskWorkspace.test.tsx client/e2e/task-completion.spec.ts` plus only files actually needed, then `git commit -m "fix(tasks): preserve active-list retention through reopen rollback"`.

## Final verification and existing-PR delivery

- [ ] Re-run `cd client && npm run test`; `cd client && npm run typecheck`; `cd client && npm run lint`; `cd client && npm run format:check`; `cd client && npm run build`; `cd client && npm run test:e2e`. **Expected:** all exit 0. If backend files remain untouched, existing backend CI result is context rather than claiming to have rerun it; run `cd server && ./mvnw test` if the project's full verification gate requires it.
- [ ] `git diff --check` and `git status --short`. **Expected:** no whitespace errors; no unexpected tracked/untracked artifacts.
- [ ] Perform the **one final whole-branch review** required by `superpowers:executing-plans` (review the PR against `master` with the ledger and original spec). Fix Critical/Important findings with tests, record any scoped rulings and minor deferrals. Do not self-claim a fresh independent review if no reviewer is available.
- [ ] Push commits to the **same remote feature branch**: `git push origin feat/issue-21-task-completion`. If shell credentials are unavailable, use an authorized GitHub connector/API route only if it can faithfully publish the **entire verified tree**; explicitly report any blocker rather than claiming success.
- [ ] Verify **PR #48** reflects the new head and remains **open targeting `master`**; do **not** open a duplicate PR. Add a short PR comment summarizing both resolved findings, regression-test names, passing commands, and any limitations. Do not merge.
- [ ] Final response to owner: link [PR #48](https://github.com/krishna916/horizon/pull/48), commit(s), evidence for both fixes, checks run, and deferred risks.

## Acceptance checklist

- [ ] No known/unknown server state confusion; POST timeout + failed GET + later Reopen cannot silently settle.
- [ ] Error/Retry survives uncertain outcome, even if latest user intent equals stale last-known state.
- [ ] Successful reconciliation either confirms the latest intent or sends the correct serialized command; no redundant writes.
- [ ] Failure of Reopen restores checked row **in Active** if it was completed there this list session.
- [ ] Original Completed-row rollback still returns to Completed.
- [ ] Confirmed Reopen ends completed-only retention; successful Recomplete can be retained anew.
- [ ] Other Task #21 functionality, dirty draft behavior, archived precedence, owner isolation, and test suites remain intact.
- [ ] PR #48 has updated commits, green required checks and review report; no merge.

**No server/database/API changes are expected. No additional user-facing product decisions are required.**
