# Issue #21 — Task completion and reopening: approved design specification

**Date:** 2026-10-22
**Status:** Written design for owner review; implementation has not started
**Owner:** Horizon
**Intended implementer:** Luna
**Story:** [krishna916/horizon#21](https://github.com/krishna916/horizon/issues/21)
**Base:** Existing Tasks workspace and its approved 2026-10-10 mockups

This document records the product/UI decisions approved in the planning conversation for issue #21 and proposes the smallest fitting technical design. It supplements, rather than replaces, the Horizon Constitution, `PRD-004 Tasks`, `SPEC-001 Shared Concepts`, the frontend engineering guide, and [the approved workspace design](../../design/tasks-workspace/DESIGN-SPEC.md). The original [mockup bundle](../../design/tasks-workspace/README.md), particularly `screenshots/08-completion.jpg` and `screenshots/02-details.jpg`, is the visual baseline. The mockup is illustrative JavaScript, not production code.

## 1. Purpose and boundaries

Allow a signed-in task owner to **complete or reopen** a task from its list row, side panel, or full-page detail view, with instant, reversible visual feedback and immediate server persistence. Completion is a fact recorded by `completed_at`, not a workflow status. Do not overwrite checklist items, unsaved field drafts, other lifecycle facts, or other users' data.

Issue #21 focuses only on complete/reopen and UI feedback. No new task status enum, lifecycle state machine, migration, global client store, notification infrastructure, optimistic offline queue, recurring-task logic, or generalized task action framework.

Related work remains in its own issues: checklist behavior and incomplete-item warning (#22); general archive/restore/delete UI (#23); completed history controls (#25); sort controls (#26). Their absence must not cause speculative implementation here.

## 2. Approved decisions — source of truth for issue #21

| # | Decision | Contract |
| --- | --- | --- |
| 1 | **List-session retention** | A task completed while in the Tasks list stays visually in Active, checked and struck through, until leaving the list context. Sorting, visibility toggles, opening/closing/switching side panels do **not** release it. Going to the dedicated task page, leaving Tasks, or browser refresh ends retention. |
| 2 | **Independent edits** | A complete/reopen click works even when an unrelated task field has an unsaved draft. Preserve its draft, editor state, and navigation guard. Do not save, discard, or navigate automatically. |
| 3 | **Immediate reversal** | Further checkbox clicks are accepted while earlier completion requests are in flight. The visible state reflects the latest click immediately; per-task persistence is serialized. |
| 4 | **Failure handling** | On failed persistence, reconcile with authoritative server state and roll back unconfirmed changes. Show persistent, local error feedback with Retry, not a silent mismatch. Earlier responses must not clobber newer intent. |
| 5 | **Archived tasks** | An archived task may be completed or reopened, preserving `archived_at`. On future restore, completion still determines whether it is Active or Completed (subject to history visibility). |
| 6 | **Checklist warning deferred** | Implement the warning for incomplete checklist items in #22 when checklists exist; #21 must not prebuild speculative checklist infrastructure. Completion must never modify checklist items. |
| 7 | **Checkbox placement** | Reuse the approved circular leading row control, and add a matching parent-task checkbox **beside the title** in both the side panel and dedicated task page. It is distinct from checklist-item controls. |
| 8 | **Pending feedback** | While the latest requested state is being persisted, show a subtle spinner and **“Saving…”** near the task title in all visible surfaces. The checkbox remains usable. No routine success toast. |
| 9 | **Error presentation** | Failed completion/reopening shows **persistent inline error + Retry near the affected task**. Error is not automatically dismissed by a timer. The visible checkbox/title reflect confirmed, reconciled state. |

These decisions supersede prototype-only mechanics and older conflicting examples for the specific issue. Do not interpret the mockup's current field-edit guard on checkbox clicks as the approved product behavior.

## 3. UI contract and interaction

### 3.1 List rows

Maintain the approved two-line row density, typography, metadata order, muted completion styling, circular 22px-class completion affordance, trailing task menu, selected-row behavior, and existing light/dark tokens.

- **Incomplete:** hollow circular checkbox, normal title.
- **Immediately after Complete:** checked circle; muted, struck-through title; **same row remains in Active** if the task was completed in the current list context. Show “Saving…” while requests are outstanding.
- **Reopen from retained Active row:** uncheck and remove strike immediately; remain in Active.
- **Completed section:** a completed row is checked and struck through; reopening moves it to Active immediately.
- **Saving:** unobtrusive spinner and “Saving…” adjacent to the title/row content; do not disable checkbox.
- **Failed latest action:** reconcile/rollback; show compact, persistent inline failure message and usable Retry next to that task. Successful reconciliation or a later successful action clears the stale error. Do not add global success toasts.
- **Interaction separation:** checkbox activation never triggers row open; clicking the title, row, or task key retains existing side-panel navigation; the more-menu remains independent.
- **Section counts:** count rendered rows, including temporarily retained completed rows in Active; never show/count a task in Active **and** Completed simultaneously.

### 3.2 Detail views

In `TaskDetailView`, position a parent-task circular checkbox **to the left of the title** in both the side panel and full-page detail layout. Match the approved checkbox style rather than adding a new toolbar or text-heavy action bar.

- The title uses the same completed/normal presentation as the list.
- A pending spinner/“Saving…” and any inline Retry error sit near the title and are consistent with the list-row feedback.
- The checkbox is independent of double-click/keyboard title editing and independent of checklist checkboxes to be implemented later.
- The existing edit draft and Save/Cancel controls remain intact during task completion, including query updates. The dirty-edit navigation guard still applies to actual navigation, not completion.
- If list and detail are visible together, both reflect a single effective completion state, including pending, rollback, and Retry; do not create separate conflicting mutations per surface.
- Archived tasks remain Archived while their completion fact changes; do not implement the full Archived list as part of #21.

### 3.3 Temporary list retention

Retention is **ephemeral presentation state scoped to one mounted Tasks list session**, not a stored status, database field, or cross-session preference.

- Add a task to the retention set only when this list-session interaction completes a currently Active task. Retained rows use the effective completion state for their checkmark/strike but remain under Active for placement.
- Sorting, list visibility toggles, list section expansion, and opening/closing/changing a details **panel** keep retention.
- Entering the **dedicated full-page task route**, leaving the Tasks workspace, refresh, or rebuilding the list session resets retention. On later entry use persisted timestamps to classify.
- A task that is reopened is no longer retained as completed. If it is completed again in the Active list session, it may be retained again.
- Archived or deleted tasks cannot be displayed in Active solely because an ID remains in a retention set; lifecycle precedence must always win.
- The server classifies no list-placement state. Once retention ends, a non-archived task with `completed_at` on the user's browser-local current date appears in Completed; older completions follow completed-history visibility rules (being implemented in #25).

### 3.4 Accessibility and feedback

Provide semantic, keyboard-operable completion controls with accessible name identifying task and action, and a programmatic checked/pressed state. Preserve visible focus treatment, text alongside the spinner (not spinner only), accessible live status where appropriate, and accessible association between inline failure/Retry and the task. Honor existing theme/reduced-motion conventions. Avoid nested interactive controls.

The existing mockup uses in-memory completion and a dialog guard in some paths; use its **rendered appearance** as the reference, not its event architecture.

## 4. Lifecycle/domain contract

`Task.completedAt: OffsetDateTime | null` already exists and is returned in both summary and detail DTOs. `archivedAt` and `deletedAt` also exist. No DB migration or additional status enum is required.

| Operation | Pre-existing completion | Result | Other lifecycle facts |
| --- | --- | --- | --- |
| Complete | null | Assign current UTC instant to `completed_at` | Unchanged |
| Complete | non-null | Preserve existing timestamp (behaviorally idempotent) | Unchanged |
| Reopen | non-null | Set `completed_at = NULL` | Unchanged |
| Reopen | null | Remains null (behaviorally idempotent) | Unchanged |
| Complete/reopen archived task | Either | Apply completion change | Preserve `archived_at` |
| Restore completed archived task (future #23) | non-null | Preserve completion | Clear `archived_at`; route to Completed/history |
| Restore incomplete archived task (future #23) | null | Remains null | Clear `archived_at`; route to Active |

The aggregate owns the mutation methods/invariants; the application layer performs owner-scoped transactional lookup and coordinates persistence. These commands cannot operate on deleted tasks. Only an authenticated owner may access a task; inaccessible or deleted task ID returns `404`, not a distinguishable cross-user error.

**Classification precedence:** deleted > archived > completed > active. List retention only changes client presentation for eligible non-archived, non-deleted tasks.

Checklist data, when introduced in #22, is immutable with respect to parent completion/reopening. Completing with incomplete items remains allowed; #22 adds the nonblocking warning.

## 5. Proposed API and backend organization

Extend existing Task module boundaries rather than creating one controller per action:

- `POST /api/v1/tasks/{id}/complete`
- `POST /api/v1/tasks/{id}/reopen`

Each endpoint is an explicit owner-scoped command with no request body, responds with the canonical updated **TaskDetailResponse** on success, and uses the existing task API error format and authentication/CSRF conventions. A repeated Complete does **not** change the first completion timestamp; a repeated Reopen remains successful with null completion. Use the clock strategy compatible with the existing domain/infrastructure conventions; timestamps are actual instants, not browser-local date strings.

Extend `Task` with narrow completion/reopening behavior; `TaskCommandService` uses the current user's ID and existing deleted-filtered repository lookup; `TaskController` exposes the commands and reuses `TaskResponseMapper`. No alternate ownership mechanism, new controller for each command, or migration.

This endpoint choice is the proposed implementation design for owner review, not a retroactive claim that a prior PRD specifies these URLs.

## 6. Client-side state and concurrency design

Build on `client/src/task/` and existing owner-scoped TanStack Query keys (`['tasks', userId]`, `['tasks', userId, 'detail', taskId]`). Use one task-scoped completion coordinator/hook shared by list and detail surfaces; no global store.

For each `(userId, taskId)`:

1. Maintain **latest desired completion boolean**, **last confirmed server state**, pending status, and failure/retry information. Optimistically render the desired state synchronously after each click.
2. Run **at most one completion/reopen command in flight per task**. If clicks occur during an in-flight request, coalesce intermediate intent and send the latest required command only after the earlier command settles. Independent tasks may save concurrently.
3. Do not permit an older response, background refetch, or another surface's stale closure to overwrite the user's newer desired value. Reflect the latest intent in both list and detail, and update owner-scoped list/detail caches carefully.
4. When a response is confirmed, incorporate its authoritative `completedAt` (including server timestamp); if desired state now differs, issue the next serialized command without treating the intermediate response as final UI success.
5. If an action fails, avoid portraying an unconfirmed optimistic state as persisted. Reconcile with a fresh authoritative fetch when server outcome is ambiguous (e.g. request timeout after possible commit), restore confirmed state as appropriate, and surface Retry for an unresolved latest intent. A stale earlier failure must not overwrite a newer confirmed intent. No automatic background/offline retries or endless loops.
6. Clearing/invalidating task queries must preserve task owner scope and active field drafts. Do not let identity switches leak pending state, task data, or failure UI between accounts.
7. Loading/session-verification guards remain authoritative; completion UI must not use potentially stale cached data when session identity is unverified.

**Example rapid sequence:** user clicks Complete → Reopen → Complete before the first network response. The screen immediately ends in checked/struck-through state. Network commands for that task are ordered, intermediate intentions may be coalesced, and eventual saved `completed_at` matches the latest click. Do not send concurrent conflicting requests for one task.

The coordinator's exact internal shape is deliberately left to Luna's implementation plan/code review; the ordering, correctness, owner scope, and feedback semantics above are required.

## 7. Integration with existing features

- `TaskRow.tsx` currently opens details from one wide button; restructure semantically so the new checkbox is an **independent** clickable target, without nested buttons.
- `TaskSection.tsx` currently decides strike-through from section name. Instead render the **effective task completion state**, since a retained completed task is in Active.
- `task-view.ts` currently classifies using persisted `completedAt`. Add list-session retention as a separate presentation overlay, preserving existing local-day calculation in `useLocalDay.ts`.
- `TaskWorkspace.tsx` and `TaskDetailView.tsx` share the same completion state/coordinator and visual feedback. Retention lifetime follows actual list-route mount/reentry boundaries, not side-panel selection.
- `TaskDetailSurface.tsx` continues to handle panel/page, loading, session check, and unavailable-task UI without remounting/erasing a dirty editor on lifecycle updates.
- Reuse `useUpdateTask.ts` patterns as appropriate, but field updates and completion commands are separate operations. Query invalidation after one must not erase an unsaved draft or overwrite newer completion intent.

## 8. Testing and acceptance

### Backend (service + Postgres Testcontainers integration)

1. Complete persists non-null `completed_at`; GET and list reflect timestamp after reload/refetch.
2. Reopen persists null; repeated Complete preserves the original timestamp; repeated Reopen remains null.
3. Completing/reopening archived task preserves `archived_at`; deleted task cannot be mutated.
4. Different user cannot complete/reopen task; inaccessible ID has same `404` behavior as nonexistent ID.
5. Existing attributes and any checklist records (when present) remain untouched; no checklist support is fabricated in #21.

### Frontend (Vitest/RTL)

1. Circle/button and title appearance in list, panel, and dedicated page; checkbox does not open details.
2. Instant Complete and Reopen before deferred network promises resolve; pending “Saving…” remains while latest intent is unconfirmed.
3. Same task row/detail stay consistent; different task mutations proceed independently.
4. Rapid Complete → Reopen → Complete persists latest intent; out-of-order/stale responses cannot regress UI.
5. Failure reverts to confirmed/reconciled state and shows persistent inline Retry; retry succeeds and clears feedback; timeout with uncertain server result performs reconciliation.
6. Dirty title/priority/due-date draft remains intact during and after toggle, refetch, and failure. Navigation guard still protects leaving the page/panel.
7. Completed-in-Active retention survives sort/toggle/panel changes; page navigation, leaving workspace, and reload clear it.
8. Archived/deleted precedence, completed-today local-day rule, historical completion visibility, owner switch and session verification.

### Browser acceptance (Playwright)

- Complete from Active row → still checked/struck-through in Active → click again to reopen.
- Complete in side panel and dedicated page; title and list presentation remain in sync.
- Leave and reenter list/reload → classification uses actual persisted timestamp, not transient retention.
- Simulate a failed completion to verify inline error and Retry, where fixture/network harness supports it.
- Verify keyboard operation, focus, no unwanted panel navigation, and preservation of draft-edit UX.

Run standard frontend/backend format, static checks, unit/integration and browser checks according to local AGENTS/engineering guides. Do not treat the illustrative mockup's own browser verification as proof of product behavior.

## 9. Reconciliation with existing documentation

- **PRD status wording:** PRD-004's section headings and “Status” filter language describe **derived views**, not a persisted enum. Horizon Constitution and task schema remain authoritative.
- **PRD ordering vs approved mockup:** Old PRD default due-date sort conflicts with approved mockup's Newest first. Sorting behavior is owned by #26; issue #21 must not change sorting rules.
- **PRD restoration example vs approved lifecycle:** PRD-004 says an archived task returns to Active; the approved mockup and decision #5 clarify that a completed archived task remains completed and returns to Completed/history after restore. Implement restore itself in #23, not #21.
- **PRD checklist warning vs issue split:** PRD-004 calls for a warning before completing with unfinished checklist items. The owner approved delivering that warning with #22, once checklist support exists; the task completion command still never changes checklist items.
- **Mockup edit guard vs decision #2:** Mockup's `guard(...completeTask)` blocks completion during editing. The approved interaction **does not** block and must preserve the draft.
- **Mockup list UX vs persistence:** Mockup stores data in memory. Real implementation uses server timestamps plus ephemeral retention, not fake dates or delayed persistence.
- **Archived completion:** Issue #21 supports lifecycle mutation even for archived tasks; their visibility and archive/restore controls follow #23.

Update authoritative PRDs/issue acceptance language separately if the project documentation process requires it; this story spec records the approved feature-specific exceptions without silently rewriting broader contracts.

## 10. Delivery boundary and review gate

**Deliver issue #21** when APIs persist lifecycle facts safely, the existing Tasks UI exposes independent completion controls with optimistic/reversible/pending/error behavior, list-session retention obeys the agreed boundary, and the specified tests pass.

**Do not deliver** completed-history controls, sort controls, checklist models/warning UI, archive/delete implementation, offline synchronization, general toast system, or a status enum under this ticket.

This document is submitted for **owner review**. Only after its content is approved should the Superpowers **writing-plans** step create a test-first, task-by-task implementation plan for Luna, including exact files, commands, commits, and a GitHub issue handoff.
