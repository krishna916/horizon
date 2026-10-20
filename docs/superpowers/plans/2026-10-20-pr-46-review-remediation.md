# PR #46 — Task Creation Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the verified PR #46 review findings without widening Horizon issue #18 or changing an owner-approved interaction silently.

**Architecture:** Keep user-scoped task creation in `client/src/task`. Make the creation form's lifecycle track authenticated ownership, decouple successful POST completion from best-effort task-list revalidation, and make the browser retry fixture model *commit then response loss*. The in-flight Cancel concern is a **product-contract decision gate**: distinguish already-submitted server work from an unsubmitted draft before altering behavior.

**Tech Stack:** React 19, TypeScript 6, React Hook Form 7, TanStack Router 1.x, TanStack Query 5, Axios, Vitest/React Testing Library, Playwright, existing Java 25/Spring Boot 4/PostgreSQL 17 backend. No additional packages or new backend API.

**Spec:** `docs/superpowers/plans/2026-10-20-issue-18-task-creation.md`, `docs/design/tasks-workspace/DESIGN-SPEC.md`, PRD-004 Tasks and the six approved issue #18 decisions. Review target: [PR #46](https://github.com/krishna916/horizon/pull/46), originally examined at `efb604264bd98fa8592f33f698a338a5c0ec72f5`.

## Global Constraints

- Work **on existing PR branch** `feat/issue-18-task-creation`; don't create a second implementation branch or modify `master`.
- Confirm PR HEAD and rerun the affected tests before each code change. Fix **only still-valid issues**; note any resolved or disproven finding in the PR.
- Retain `/tasks?create=true`, create → `/tasks?task={id}` history replacement, the account-scoped query keys `['tasks', userId]` and `['tasks', userId, 'detail', task.id]`, and existing form/API contracts.
- Preserve **explicit Cancel immediately discards** for an unsubmitted draft and confirmed dirty-dismissal behavior. Existing plan says Cancel discards regardless of dirtiness; changing how Cancel behaves during an in-flight POST **requires owner approval** (Task 4).
- Preserve the request body and UUID on uncertain outcomes. Retrying the same submission must remain safe through the existing backend idempotency mechanism; no new backend code unless a concrete failed integration test proves it's necessary.
- Reuse existing test infrastructure, no global auth state store or cross-feature refactor. Test red → minimal fix → green → commit per independent task.
- Preserve existing privacy behavior when session state changes; never expose A's draft to B, but do not destroy A's draft simply because a background `/me` revalidation eventually confirms the *same* user.

## Review Focus

1. **Same-user revalidation:** a temporary `/me` fetch must not expose private form content while identity is unverified or gratuitously lose a draft after it confirms the same owner (Task 1).
2. **Owner A → B:** B must never see A's title, description, server errors or immutable recovery payload; B starts a clean form and can't submit with A's key (Task 1).
3. **POST succeeds, list GET stalls/fails:** Create resolves to detail immediately with the new `TASK-N`; background refetch errors cannot misclassify a successful create as an uncertain POST (Task 2).
4. **POST commits, HTTP response is lost:** retry uses identical key/body, returns original ID, and browser fixture has exactly one persisted task (Task 3).
5. **Cancel after POST started:** browser navigation cannot undo committed server work; any new restriction or warning must be explicitly approved and tested, never presented as server-side cancellation (Task 4).

---

## File map

| Task | Files | Responsibility |
|---|---|---|
| 1 | `client/src/task/TaskWorkspace.tsx`, `TaskCreateForm.tsx`, `TaskCreateSurface.tsx`, `TasksListPage.tsx` **only if guard ownership requires it**; existing matching `*.test.tsx` | Account-scoped draft lifetime, verification state, route dirty flag |
| 2 | `client/src/task/useCreateTask.ts`, `useCreateTask.test.tsx`; `TasksListPage.test.tsx` if needed | Successful mutation completion vs independent list revalidation |
| 3 | `client/e2e/task-create.spec.ts` | Realistic committed-but-response-lost simulated server |
| 4 | `client/src/task/TaskCreateForm.tsx` and `TaskCreateForm.test.tsx`; overlay/route tests **only if owner-selected behavior needs it** | Pending-POST Cancel UX decision and its test |

### Task 1: Isolate and preserve creation drafts correctly across session changes

**Files:** Modify `client/src/task/TaskWorkspace.tsx`; `TaskCreateForm.tsx` or `TaskCreateSurface.tsx` as needed for owner-keyed lifetime; `TasksListPage.tsx` only if dirty-blocker state cannot be cleared at the existing callback boundary. Test in `client/src/task/TaskWorkspace.test.tsx`, `TaskCreateForm.test.tsx` and/or `TasksListPage.test.tsx`.

**Interfaces:** Keep `TaskCreateSurface` props `{userId, onCreated, onDirtyChange, onCancel, onDismiss}`. The creation draft and `TaskCreateRecovery.ownerId` are owned by **one verified authenticated user**. Parent dirty state is reset when a draft is discarded due to an identity change, without permitting a canceled/late response to navigate.

- [ ] **Step 1 — Write failing tests:** render create mode as A, fill title + description, optionally enter uncertain-retry mode. Change current-user query to B without leaving `?create=true`. Assert B sees none of A's title, errors, key or disabled recovery state; B can create with a *new* key and the old A request cannot navigate/cache under B. Assert route dirty blocker no longer acts on A's vanished draft.
- [ ] **Step 2 — Write revalidation tests:** enter dirty draft as A, set `/me` query to `isFetching=true` with stale A data; don't expose or allow interactions with the private form while identity is pending. After it confirms A, restore the **same** draft; if it fails or resolves to B, no draft is displayed to another user. Include a late POST response test.
- [ ] **Step 3 — Confirm RED:** from `client/`, `npm run test -- TaskWorkspace TaskCreateForm TasksListPage`; new assertions must fail on the existing behavior.
- [ ] **Step 4 — Minimal change:** scope the mounted form by authenticated `userId` (React `key`/owner-scoped subtree); guard against stale `useCurrentUser` data during `isPending`, `isFetching`, or `isError`. Keep the component **mounted but non-visible/inert** during ordinary revalidation if needed to preserve same-user drafts; re-key/reset only on a *confirmed different owner* or invalid session. Clear its parent dirty state on owner invalidation/discard. Do not rely only on `send()`'s owner comparison: that protects writes but not what B can read on screen.
- [ ] **Step 5 — GREEN + commit:** run `npm run test -- TaskWorkspace TaskCreateForm TasksListPage` and `npm run typecheck`; expect PASS. Commit `fix(tasks): isolate creation drafts across account changes`.

### Task 2: Make successful creation independent of list-refetch availability

**Files:** Modify `client/src/task/useCreateTask.ts`; test in `client/src/task/useCreateTask.test.tsx`, and relevant route integration test if needed.

**Interfaces:** Preserve `useCreateTask(userId: number)` and `createTask(payload: CreateTaskPayload, requestKey: string): Promise<TaskDetail>`. A resolved `taskApi.create` establishes creation success. Query cache reconciliation stays owner-scoped; refetch is fire-and-forget, not awaited by `mutateAsync`.

- [ ] **Step 1 — Write failing test:** resolve POST with `TaskDetail{id: 41, key:'TASK-41', inbox:false, ...}`, while mock `taskApi.list()` refetch returns a never-settling promise; call `createTask` and assert it resolves promptly to ID 41, caches one list summary and the detail, and schedules invalidation. Include a refetch-error variation that does not put the creation form into ambiguous-result recovery.
- [ ] **Step 2 — Confirm RED:** `npm run test -- useCreateTask`; expected failing assertion is mutation resolution waiting on `invalidateQueries`.
- [ ] **Step 3 — Minimal change:** retain synchronous `setQueryData` list/detail updates and user-ID guard. Start `void queryClient.invalidateQueries({queryKey:listKey, exact:true})` without `await`/returning that Promise from `onSuccess`. Do not manually fake success before the POST resolves. Keep invalidation errors observable through the list query's existing error handling, not as a create-POST failure.
- [ ] **Step 4 — GREEN + commit:** `npm run test -- useCreateTask TasksListPage` and `npm run typecheck`; expect PASS. Commit `fix(tasks): finish creation without awaiting list refresh`.

### Task 3: Test the actual lost-response-after-commit scenario

**Files:** Modify `client/e2e/task-create.spec.ts` only.

**Interfaces:** Existing `installStatefulTaskApi(page, {initialTasks, failFirstPost})` stays the browser fixture entry. Make `failFirstPost` model **persist then abort reply** rather than abort-before-save; index created resources by `Idempotency-Key` so subsequent same-key requests replay the stored `TaskDetail` without another insert.

- [ ] **Step 1 — Strengthen browser assertion:** for the existing ambiguous-failure scenario, assert the fixture stores one task *after the first response is aborted*, and after retry still has exactly one matching ID/key. Assert two POST attempts have byte-equivalent body and identical UUID; success opens `/tasks?task=41` and shows the original details.
- [ ] **Step 2 — Confirm RED:** `npm run test:e2e -- task-create.spec.ts`; test should fail because current fixture aborts before state is updated.
- [ ] **Step 3 — Minimal fixture change:** on first keyed POST, record payload, allocate ID 41, add one summary/detail and map `key -> original response`; only *after* persisting, `route.abort('failed')`. On the second POST, return the recorded original result and do not append another summary. Preserve separate tests for ordinary title-only creation.
- [ ] **Step 4 — GREEN + commit:** `npm run test:e2e -- task-create.spec.ts` (Playwright browser installed); expect PASS. Commit `test(tasks): cover committed creation with lost response`.

### Task 4: Resolve pending-POST Cancel semantics — **owner decision required**

**Files if approved:** `client/src/task/TaskCreateForm.tsx`, `TaskCreateForm.test.tsx`; `TaskCreateSurface.tsx` / route and overlay tests only if the selected interaction affects other dismissal paths.

**Verified contract conflict:** The original approved plan says **explicit Cancel immediately discards** even when dirty. The reviewer suggested disabling Cancel during an in-flight POST; that would alter the owner-approved interaction. Once a POST is sent, the browser cannot guarantee that abandoning it prevents its server-side commit. **Do not implement either alternative without the owner's selection.**

- **Option A (recommended):** Unsubmitted form retains immediate Cancel. During `isSubmitting`, block Cancel and other intentional panel dismissals until the POST settles; after an *uncertain* response, allow the existing read-only Retry state and a deliberate discard path as approved. Avoid claiming cancellation of an already-sent request. This revises the broad Cancel rule specifically for the in-flight window.
- **Option B (preserve existing behavior):** Cancel remains immediate even while a request is in flight. Treat it explicitly as **abandoning the local UI only**, never as canceling server creation; communicate that distinction appropriately, and plan best-effort owner-scoped list reconciliation even if success resolves after form unmount. A lost response can still leave uncertain server state; do not promise otherwise.

Once approved:
- [ ] **Step 1 — Add failing `TaskCreateForm`/navigation test:** initiate a deferred POST, attempt Cancel and X/Back, and assert **exactly the owner-selected behavior**, including whether a task can appear after an abandoned request.
- [ ] **Step 2 — Confirm RED:** `npm run test -- TaskCreateForm TasksListPage`; new assertions fail for the behavior being changed.
- [ ] **Step 3 — Implement only approved change:** do not invent request-abort or backend-rollback semantics. Preserve same-key retries, owner guarding and unsaved-navigation logic.
- [ ] **Step 4 — GREEN + commit:** run `npm run test -- TaskCreateForm TasksListPage` and `npm run test:e2e -- task-create.spec.ts`; commit `fix(tasks): clarify cancellation during active creation`.

### Task 5: Full verification and PR handoff

**Files:** No production file required. Update the PR description or add an evidence comment.

**Interfaces:** PR #46 remains open until approval and tests. No database migration or new backend dependency is expected for this review remediation.

- [ ] **Step 1:** Review the diff and original plan; verify all four findings are addressed, or document why a finding was not applicable. Verify that Task 4 has owner approval before implementation.
- [ ] **Step 2:** From `client/`, run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test:e2e`. Expected PASS; do not substitute unit tests for browser tests.
- [ ] **Step 3:** Since backend behavior is unchanged, validate existing PR backend CI remains green (`server/./mvnw verify -Duser.timezone=UTC` when relevant), particularly its concurrent same-key test. Do not claim local backend results not executed.
- [ ] **Step 4:** Put test outputs, each finding's resolution and any remaining limitations in PR #46. Request an independent review; keep issue #18 open until PR merge.

## Acceptance gate

- [ ] No Account A draft, retry key, server error or cache state appears in Account B's creation view.
- [ ] Same-account session revalidation does not needlessly erase dirty input.
- [ ] Created task immediately opens detail after a successful POST regardless of slow/unavailable list refresh.
- [ ] Browser fixture proves **committed POST + lost response + idempotent replay** with exactly one task.
- [ ] In-flight Cancel behavior is explicitly approved, covered in tests, and does not claim to undo a committed POST.
- [ ] All affected unit/router/browser tests and PR-required quality checks pass.

## Luna handoff

Work directly on `feat/issue-18-task-creation`, then follow **superpowers:executing-plans** or **superpowers:subagent-driven-development**, and **superpowers:test-driven-development** for each task. First verify the live code and review comments; don't blindly implement an invalid finding. Tasks 1–3 may proceed independently; **stop before Task 4's product change** until the owner decides between A and B. Commit each fix separately and summarize verification in PR #46.

**Planning only:** This file contains remediation instructions; it does not change application code or assert new tests have passed.
