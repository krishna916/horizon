# Task Field Editing and Dirty Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users explicitly edit a task's title, priority, or due date on both detail surfaces, save one field at a time, and resolve unsaved changes before leaving.

**Architecture:** Keep field editors, mutations, and draft behavior inside `client/src/task`. Extend the existing account-scoped TanStack Query contracts and presence-aware PATCH API. Host one draft-navigation coordinator in the existing Tasks route layout so panel, canonical page, and creation mode use one route blocker without moving Task behavior into shared application code.

**Tech Stack:** React 19, TypeScript, TanStack Router and Query, Axios, React Hook Form/Zod where useful, Radix dialog, Vitest/React Testing Library, Playwright; existing Spring Boot 4.0.6/Java 25/PostgreSQL 17 API.

**Spec:** [Issue #20](https://github.com/krishna916/horizon/issues/20), [approved Tasks design](https://github.com/krishna916/horizon/blob/99d60685a4b9922e6fee00eea140113ec6880636/docs/design/tasks-workspace/DESIGN-SPEC.md), attached `PRD-004 Tasks`, `HORIZON_CONSTITUTION`, `HORIZON_STATUS`, `ENG-002 Frontend Engineering Guide`, and `HORIZON_IMPLEMENTATION_WORKFLOW`; owner decisions in this planning conversation on 2026-10-20.

## Global Constraints

- Work on `feat/issue-20-task-field-editing`, created from verified `master` revision `99d60685a4b9922e6fee00eea140113ec6880636`. Recheck changed files if the base advances. No issue-20 branch or plan existed at the initial inspection.
- Epic [#2](https://github.com/krishna916/horizon/issues/2) and its approved design comment serve as epic-level context. No distinct Epic Overview or story implementation specification was found; do not invent one. The issue and this plan define this story's scope.
- Keep the modular monolith and Task feature ownership. Reuse the existing `/api/v1/tasks/{id}` PATCH, repository-enforced user ownership, RFC 9457 field errors, and `['tasks', userId, 'detail', taskId]` / `['tasks', userId]` query keys. Do not add a migration or another update API for this story.
- Do not edit description as rich text (#24), checklist (#22), completion (#21), lifecycle actions (#23), tags (#27), or mockup-only sections. Do not build generic app-wide editing infrastructure.
- Approved interaction: pointer double-click; focused read control opens with Enter or Space. One field editor at a time. Field-level Save and Cancel; blur does nothing. Only a **changed** draft triggers the navigation guard. A pristine editor can close on navigation.
- Approved blocked navigation: **Save and continue**, **Discard and continue**, **Keep editing**. After save/discard succeeds, resume the original destination once; a save failure stays on the task with the draft intact. Field-level Cancel discards locally without navigation.
- On browser reload/tab close, use the browser's native before-unload confirmation for a changed draft or pending save; a custom three-action prompt cannot run there. No silent commit/discard.
- Use the existing theme and semantic controls; current Task panel/page must show the same editing content. Current authenticated user owns all cached data; do not display or write cross-account task data.
- Use red → green → focused verification → commit for each task. The executable repo is the authority for exact implementation details if it changes after this snapshot.

## Review Focus

1. Rapid task selection or Back/Forward while an edit is dirty must retain the correct draft and intended destination (Task 4 route tests, Task 5 browser flow).
2. A save request still in flight must not allow an edit, second save, discard, or navigation that loses its outcome (Tasks 2 and 4 tests).
3. A lost PATCH response can mean the field was saved; retrying the same single-field value must remain safe and keep the draft visible until confirmed (Tasks 1 and 2 tests).
4. A session change or 404 during save must neither reveal previous-account data nor silently continue navigation (Tasks 1 and 4 tests).
5. Clearing priority/due date and editing a task absent from the current Active list must preserve unrelated server fields and update the available detail/list state (Tasks 1 and 3 tests).

---

## Pre-plan assessment and decision record

**Issue:** [#20 — Add per-field Save/Cancel editing and unsaved-change navigation guard](https://github.com/krishna916/horizon/issues/20), open, no comments at inspection. Dependencies #16, #17, #18, and #19 are closed; their code is on `master`. No issue-20 branch, PR, or plan was found.

**Sources:** Issue #20 and epic #2, approved `docs/design/tasks-workspace/DESIGN-SPEC.md` and issue #19's approved detail design, attached PRD-004, SPEC-001, Constitution, Status, ENG-002, implementation workflow, `docs/ai/INDEX.md` plus its product/architecture/engineering guides, root `Agents.md`, `client/AGENTS.md`, `server/AGENTS.md`, and the live Task client/backend files and tests at the revision above. The attached Status predates the current implementation; the observed code and issue/PR states establish what exists now. The PRD describes a different detail section order from the later approved design and implemented #19 view; this story follows the later approved visual baseline without reordering sections.

| Issue acceptance criterion | Product/design rule | Existing surface | Coverage |
| --- | --- | --- | --- |
| One editor, double-click and keyboard | Approved Tasks design; 2026-10-20 Enter/Space decision | `TaskDetailView`, shared `TaskDetailSurface` | Tasks 2–3 |
| Save just one field; Cancel restores | PRD-004 FR-003, FR-005, FR-008, FR-011/012; existing presence-aware PATCH | `taskApi`, `useTaskDetail`, `useTaskList`; backend `TaskController` | Tasks 1–3 |
| No implicit save/discard | Approved Tasks design; changed-draft decision | `TaskDetailView`, route transitions | Tasks 2 and 4 |
| Guard switch, close, route | Approved Tasks design; continue-destination decision | `TasksListPage` creation blocker, `TasksRouteLayout`, `TaskOverlay`, canonical route | Tasks 4–5 |
| Failed save retains draft/retry | Issue #20; Problem Details errors | Existing `TaskCreateForm` error parsing as a local precedent | Tasks 1–3 |
| Component and browser verification | Issue #20 | Vitest/RTL and Playwright suites | Tasks 1–5 |

**Owner-approved decisions:** (1) resolving a blocked edit continues the original destination after Save or Discard; Keep editing stays; (2) Enter or Space activates focused field controls; (3) only changed drafts block navigation. The issue/design already fixes one editor at a time, per-field Save/Cancel and no autosave. Keep current creation behavior: its explicit Cancel discards; its dirty dismissal offers Keep editing/Discard and continues; active creation requests block dismissal. The shared coordinator may present Save only for field edits.

**Scope boundary:** Save for changed title/priority/due date sends exactly one property. Clearing optional priority or due date sends `null`. Completed and archived tasks can be edited when their detail is available, per PRD-004, even if those sections are not yet surfaced by the current list. No optimistic overwrite of other fields, version field, new concurrency policy, or server idempotency change. Repeating the same PATCH value after an uncertain response is acceptable; concurrent edits to the *same* field remain last-write-wins under the current API.

## File map

**Verified existing, likely modify:** `client/src/task/api.ts`, `types.ts`, `TaskDetailView.tsx`, `TaskDetailSurface.tsx`, `TasksRouteLayout.tsx`, `TasksListPage.tsx`, `TaskWorkspace.tsx`, `TaskDetailPage.tsx`, `TaskOverlay.tsx`, `useTaskDetail.ts`, `useTaskList.ts`, `TaskCreateSurface.tsx`, `TaskCreateForm.tsx`, `client/src/routes/_authenticated/tasks.$id.tsx`, and their adjacent tests. Current backend `TaskController`, `TaskRequestMapper`, `TaskCommandService`, `TaskExceptionHandler` and `TaskControllerIntegrationTest` should be read and verified; change them only for a reproduced contract gap.

**Proposed new, confirm names before coding:** `client/src/task/useUpdateTask.ts` and test (PATCH and cache), `client/src/task/TaskFieldEditor.tsx` and test (single field editing), `client/src/task/TaskDraftNavigationGuard.tsx` and test (feature-owned draft registration, route blocker and prompt), `client/e2e/task-edit.spec.ts` (real routing flow). Keep actual responsibilities small; if a tested helper belongs beside an existing file, use that file rather than scaffolding an extra abstraction.

### Task 1: Typed single-field update and account-scoped cache

**Files:** Modify verified `client/src/task/api.ts`, `types.ts`; create proposed `client/src/task/useUpdateTask.ts`, `useUpdateTask.test.tsx`.

**Interfaces:** `UpdateTaskPayload = {title: string} | {priority: TaskPriority | null} | {dueDate: string | null}`; `taskApi.update(id: number, patch: UpdateTaskPayload): Promise<AxiosResponse<TaskDetail>>`; `useUpdateTask(userId: number)` exposes `updateTask(taskId: number, patch: UpdateTaskPayload): Promise<TaskDetail>`. Exact shape may be refined to forbid multi-property payloads at the TypeScript boundary.

- [ ] Write failing tests: one-key PATCH body for each field, `null` clearing, untouched description/key/id, same-user detail/list cache update and list invalidation, no stale cross-user cache write, no data replacement on 400/404/network failure; absent list entries stay absent while detail updates.
- [ ] Run `cd client && npm run test -- src/task/useUpdateTask.test.tsx`; verify the new behavior fails for the missing mutation/API.
- [ ] Implement the typed API and mutation, following `useCreateTask` account guards and existing exact query keys. Merge the returned server detail into its exact cache and update only a present list summary; invalidate the list without awaiting a refetch before reporting save success. Do not optimistically overwrite server state on failure.
- [ ] Run the focused test to green and `cd client && npm run typecheck`; commit the Task API/mutation/tests.

### Task 2: Single field editor behavior and validation

**Files:** Create proposed `client/src/task/useTaskFieldEdit.ts`, `useTaskFieldEdit.test.tsx`, `TaskFieldEditor.tsx`, `TaskFieldEditor.test.tsx`; reuse verified `TaskCreateForm.tsx` validation/error patterns without moving them to global code.

**Interfaces:** `useTaskFieldEdit(task: TaskDetail, userId: number)` owns `activeField: 'title' | 'priority' | 'dueDate' | null`, normalized string draft, `dirty`, `pending`, `activate(field)`, `setDraft(value)`, `save(): Promise<boolean>`, and `cancel(): void`. `save` returns false on any failure and true only after the response/cache update; the same callback serves the field Save button and Task 4's blocked-navigation action. `TaskFieldEditor` renders one field's read control or active input from that controller. Task 4 registers its live dirty/pending/save/cancel state.

- [ ] Write failing tests for double-click and Enter/Space activation, focus/labels, exactly one editor, no pointer single-click edit, blank/whitespace-only title and >255 characters, priority choices and clearing, ISO date input and clearing, Save/Cancel, pristine navigation release, blur without mutation, attempted second-field activation while changed, double-submit/pending protection, server field error and retry preserving input, and ambiguous network failure followed by retrying the same field value.
- [ ] Run the focused Vitest file and observe failures for missing editor behavior.
- [ ] Implement read-first control and field-specific inputs/Save/Cancel. Preserve the original value for Cancel; trim title in line with backend validation. Show a field-level server 400 `errors[field]`, and a retryable general error for other failures. Do not drop the draft on a failed save or let a second field replace a changed draft. Do not autosave on blur, Enter in an input, or selection change.
- [ ] Run the focused tests to green, typecheck, and commit the editor/tests.

### Task 3: Same editing content in panel and canonical page

**Files:** Modify verified `client/src/task/TaskDetailView.tsx`, `TaskDetailSurface.tsx`, `TaskDetailPage.tsx`, their tests, and `TaskWorkspace.tsx` only to pass the active draft contract. Avoid a second editor instance for panel/page at once.

**Interfaces:** `TaskDetailView` receives `task: TaskDetail` and `userId: number`, uses the Task 2 controller, and renders title, priority, and due-date read/edit controls. `TaskDetailSurface` obtains authenticated `userId` and the current task; only a valid, visible owned task mounts editors. Task 4 consumes its draft state via the feature-owned registration interface.

- [ ] Write failing component tests: panel and page both edit all three fields; unset optional fields have a discoverable read-first edit target; successful save changes detail and list metadata; cancel restores; completed/archived task detail still edits; rapid task switch does not render the prior task's draft; 404/session failure never renders stale task data or active controls.
- [ ] Run `cd client && npm run test -- src/task/TaskDetailView.test.tsx src/task/TaskDetailSurface.test.tsx src/task/TaskDetailPage.test.tsx`; observe relevant failures.
- [ ] Integrate the editor with the common detail view and mutation. Keep the approved title → description → priority → due-date order and existing safe description rendering. Treat the editor as local state keyed by authenticated owner and task identity.
- [ ] Run focused tests and typecheck to green; commit surface integration/tests.

### Task 4: One Task-owned dirty navigation guard for create and edit

**Files:** Create proposed `client/src/task/TaskDraftNavigationGuard.tsx` and test; modify verified `TasksRouteLayout.tsx`, `TasksListPage.tsx`, `TaskWorkspace.tsx`, `TaskDetailSurface.tsx`, `TaskDetailPage.tsx`, `TaskCreateForm.tsx` / `TaskCreateSurface.tsx` as needed, plus adjacent route/overlay/session tests. Existing `TaskOverlay.tsx` dismissal must route through the same guard.

**Interfaces:** The route-level Task guard registers at most one live draft owner with `{ id: string; kind: 'create' | 'field'; dirty: boolean; pending: boolean; save?: () => Promise<boolean>; discard: () => void }`. `id` identifies the account/task/field or account/create form. The feature-owned context provides `setDraft(registration | null)`; its sole TanStack `useBlocker` handles internal `navigate`, Back/Forward, panel Close, drawer backdrop/Escape, full-page control, and canonical Back. A successful `save` clears its dirty ref before `blocker.proceed()`. Keep creation's no-auto-submit behavior and existing `cancelPendingLogoutNavigations` integration. Verify any necessary history-restoration details against the live router before coding.

- [ ] Write failing router/component tests for task switch, create entry during dirty edit, panel close, full-page open/back, sidebar route, Back/Forward, overlay backdrop/Escape, and direct-link close. Assert the URL/content stay put while blocked; Keep editing resets the pending transition; Discard and continue resumes exactly that destination; Save and continue patches once then resumes; failed save stays and retries; pending save disallows departure; pristine editor does not prompt.
- [ ] Include creation regression tests: dirty create still offers Keep editing/Discard (no Save), explicit Cancel discards, in-flight create cannot be dismissed, blocked logout Keep editing cancels pending logout, session/user change does not expose or reuse an old draft. Include native `beforeunload` enablement for changed/pending state; no custom dialog promise for page unload.
- [ ] Run `cd client && npm run test -- src/task/TasksListPage.test.tsx src/task/TasksRouteLayout.test.tsx src/task/TaskOverlay.test.tsx src/task/TaskSessionBoundary.test.tsx`; add/run the new guard test. Confirm red where the old create-only guard lacks edit coverage.
- [ ] Move/extend the blocker into the persistent Tasks route layout, register each form's active draft with the Task-owned coordinator, and use one accessible dialog with clearly distinct Save and continue / Discard and continue / Keep editing actions. On save rejection, preserve the blocked destination and editor draft, show retryable feedback, and never call `proceed`. Preserve #19's trusted origin/history rules, including create's Back/Forward draft restoration behavior; avoid parallel blockers for the same route.
- [ ] Run focused route/guard tests and typecheck to green; commit navigation integration/tests.

### Task 5: Browser flow and final verification

**Files:** Create proposed `client/e2e/task-edit.spec.ts`; extend verified `client/e2e/task-detail.spec.ts` or `task-create.spec.ts` only for necessary shared-guard regressions. No production-only refactor to satisfy test fixtures.

- [ ] Write Playwright flow with two persisted tasks: open first task, double-click title, change it, attempt second-task selection, assert blocked URL and draft; Keep editing; retry and Save and continue; assert second task selected and first title updated on list/reopen. Repeat Discard and continue, then verify no PATCH for discarded value. Exercise keyboard Enter/Space and a due-date/priority clear. Include a save-failure response followed by retry and a narrow drawer Escape/Close guard.
- [ ] Run `cd client && npm run test:e2e -- task-edit.spec.ts`; resolve a concrete uncovered integration defect if red, then record green. Do not force a failure after the component/route tasks have already delivered the behavior.
- [ ] Run from `client/`: `npm run test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`. These script names are verified in `client/package.json`; record actual results. Run the existing backend `TaskControllerIntegrationTest` on PostgreSQL/Testcontainers if backend code changes or the PATCH contract is in doubt, under `-Duser.timezone=UTC` per `Agents.md`; do not claim it ran until it does.
- [ ] Review all six issue acceptance criteria against the table above; inspect the actual diff for out-of-scope changes, accessibility, draft races and owner-scoped cache behavior. Commit final tests/fixes, report the base/head revisions and verification results to the owner. Do not publish a PR or close the issue without a separate instruction.

## Luna execution handoff

```text
Horizon — Luna handoff
Issue: https://github.com/krishna916/horizon/issues/20
Approved specification/design: docs/design/tasks-workspace/DESIGN-SPEC.md;
  issue #20 and owner decisions recorded in this plan (2026-10-20)
Implementation plan: 2026-10-20-issue-20-task-field-editing.md (this file)
Base revision / branch: feat/issue-20-task-field-editing, created from
  master at 99d60685a4b9922e6fee00eea140113ec6880636

Read the issue, plan, approved decisions, Agents.md, client/AGENTS.md,
server/AGENTS.md, and referenced documents. Check the current base before
using paths or signatures. Use superpowers:subagent-driven-development
(preferred) or superpowers:executing-plans to execute task by task.
Follow red → green → review → commit. Honor scope and agreed decisions;
stop and ask if new product/architecture ambiguity appears. Run the listed
checks and report actual results. Do not claim tests passed without running.
```
