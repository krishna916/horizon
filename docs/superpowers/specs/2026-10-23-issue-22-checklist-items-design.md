# Issue #22 — Lightweight task checklist: design specification

**Date:** 2026-10-23
**Status:** Approved by owner on 2026-10-23; ready for native/inline Luna implementation
**Owner:** Horizon
**Intended implementer:** Luna
**Story:** [krishna916/horizon#22](https://github.com/krishna916/horizon/issues/22)
**Epic:** [Tasks #2](https://github.com/krishna916/horizon/issues/2)

This specification records decisions expressly approved during issue #22 brainstorming. It supplements the Horizon Constitution, `PRD-004 Tasks`, `PRD-002 Today`, `SPEC-001 Shared Concepts`, `ENG-002 Frontend Engineering Guide`, and the [approved Tasks workspace design](../../design/tasks-workspace/DESIGN-SPEC.md). The approved [issue #21 completion design](./2026-10-22-issue-21-task-completion-design.md) remains authoritative for ordinary task complete/reopen behavior; this story adds only the checklist-related warning. Mockup JavaScript is illustrative, not a product contract.

## 1. Goal and scope

Enable the owner of a task to create, view, rename, complete/reopen, date, reorder, and remove lightweight checklist items within task details and optionally as part of initial task creation. A checklist item is a child of Task, not an independent Task, workspace, or lifecycle.

**Success:** An owner creates two items, reloads and sees them in stable order; edits, completion, dates, removal/Undo, and reorder survive reload; task completion never modifies checklist facts; another user's data remains inaccessible.

**In scope:** PostgreSQL/Flyway child persistence; task-owned service and REST endpoints; ordered checklist in task detail/create responses; initial checklist on task creation; checklist UI in both task detail surfaces and task creation; parent-completion warning in all existing completion entry points; automated tests.

**Out of scope:** True/nested subtasks; reminders or notifications; Today/Inbox/Search/Trash UI; independent checklist pages, task keys, tags, priority, descriptions, or workflow status; generic undo/history infrastructure; background deletion cleanup; unrelated Tasks redesign or broad refactors.

## 2. Approved interaction contract

| Action | Behavior |
| --- | --- |
| Quick add (existing task) | Enter a nonblank title, press Enter, persist immediately, and display the new item. No Save button for quick add. |
| Add due date | Compact calendar icon on each item; selecting a date saves immediately. Clearing an existing date also saves immediately. Due dates are optional and independent of the parent. |
| Rename | Open a per-item title editor with explicit Save and Cancel; no autosave. |
| Complete/reopen checklist item | Checkbox saves immediately; completing sets `completed_at`, reopening clears it. No parent completion side effect. |
| Reorder | Drag-and-drop plus accessible keyboard movement; order changes are a draft until explicit Save or Cancel. The draft participates in Horizon's unsaved-navigation guard. |
| Reorder lock | During an unsaved reorder session, block **all other checklist writes**: add, rename, delete, item completion/reopening and due-date changes. Also prevent opening a parent-task field editor until the reorder is saved/cancelled. |
| Editing-session limit | One editable draft/session at a time within task details. Reuse existing single-registration navigation guard rather than creating concurrent-draft infrastructure. |
| Remove | Immediately persist removal, hide item, and offer Undo for **8 seconds**; leaving task detail dismisses Undo. Do not put items in global Trash. |
| Undo | Restore original database identity, title, date, completion timestamp, and original relative position. If intervening changes affected ordering, insert at the prior position and shift other active items deterministically. |
| Parent completion | If unfinished checklist items exist, show a warning with **Complete Anyway** and **Cancel**, before issuing the completion request. If all are complete or no items exist, complete without dialog. Cancelling makes no change. Confirmation never completes child items. |
| Parent reopening | Immediate per issue #21; checklist items unchanged. |
| Parent completion with unsaved edits | Continue respecting issue #21's independent parent completion behavior. In particular, a parent completion/reopen action is not itself a checklist write or another field editor. |
| Archived or deleted parent | Archived tasks remain editable according to existing task rules. Deleted/inaccessible parent tasks and their items are unavailable through task-scoped APIs. |

**Product clarification:** Unlike the original issue's blanket suggestion that non-checkbox edits use Save/Cancel, the explicitly approved **calendar due-date change** and **quick add** are immediate. Rename and reorder keep Save/Cancel.

## 3. Domain, schema, and invariants

`Task` remains the aggregate root; `ChecklistItem` is a task-owned child, persisted in a separate PostgreSQL table with a foreign key to `tasks`. Required item fields:

- `id`: BIGINT identity, stable across delete/restore.
- `task_id`: required parent foreign key; authorization inherited exclusively through the parent task's owner.
- `title`: required, trimmed nonblank text (same maximum of 255 characters as task titles).
- `due_date`: nullable PostgreSQL DATE / Java `LocalDate`, independent of parent due date.
- `completed_at`: nullable timezone-aware timestamp; UTC, set on completion, cleared on reopen.
- `position`: integer ordering key for active siblings, initial order from input, stable on reload.
- `deleted_at`: nullable timestamp used for item removal and restoration, not global Trash.

Use a Flyway SQL migration and Hibernate schema validation, not runtime schema generation. Index active item lookups by parent/order. Return only active (`deleted_at IS NULL`) children in task details. The design uses one ordered list per parent, not nested task identities or an additional item `status` enum.

An item belongs to exactly one task and cannot move between parents. All writes and item lookups first enforce parent ownership and non-deleted parent scope, returning `404` for missing/non-owned task or child ID, including a child ID from a different task. An archived (but not deleted) task is still accessible/editable. Parent task completion/archival facts never overwrite child completion/date/order. Child writes never toggle the parent's completion state.

**Ordering and Undo:** Normalize visible positions to contiguous zero-based indices after add, removal, restore, or reorder. Store deletion-time position with the soft-deleted record. Restore inserts at that previous position (clamped if the list is shorter), shifting active peers as necessary. Updates that modify sibling structure run atomically for the parent. Avoid a PostgreSQL uniqueness rule on transiently rewritten positions unless update strategy makes it safe. A reorder submission must contain **exactly all currently active child IDs**, once each; reject stale/missing/duplicate/foreign IDs rather than silently dropping siblings. Serialize competing structure edits at the parent aggregate boundary.

**Soft deletion:** `deleted_at` is the only undo mechanism; after the 8-second UI window the record remains stored but is inaccessible as an active item. The server does not implement an 8-second expiry; only the frontend exposes the action within the window. No retention job or Trash integration in V1.

**Today contract for future epic:** Checklist eligibility uses its own due date and `completed_at`. An unfinished child remains eligible when its parent is completed, provided the parent is not archived/deleted. A parent and child due on the same day may appear independently. This story supplies the durable facts; **no Today UI/query endpoint is added here**.

## 4. API contract

All paths below begin with `/api/v1/tasks/{taskId}`; responses are JSON using the existing error standard (RFC 9457 Problem Details). Reuse the existing Task controller/module conventions rather than one controller per operation.

| Method/path suffix | Input | Success |
| --- | --- | --- |
| `POST /checklist-items` | `{ "title": "..." }` | `201` with created checklist item |
| `PATCH /checklist-items/{itemId}` | One edit field: `{ "title": "..." }` or `{ "dueDate": "YYYY-MM-DD" }` or `{ "dueDate": null }` | `200` updated item |
| `POST /checklist-items/{itemId}/complete` | no body | `200` updated item, non-null completion timestamp |
| `POST /checklist-items/{itemId}/reopen` | no body | `200` updated item, null completion timestamp |
| `PUT /checklist-items/order` | `{ "itemIds": [id1, id2, ...] }` | `200` ordered list |
| `DELETE /checklist-items/{itemId}` | no body | `204`, soft-delete |
| `POST /checklist-items/{itemId}/restore` | no body | `200` restored item |

Each item representation: `{ id, title, dueDate, completedAt, position }`. No `taskKey`, independent owner ID, or deleted child in the public detail collection. Keep date-only values in `YYYY-MM-DD`, timestamps in existing ISO/UTC conventions.

**Task integration:** Add an ordered `checklist` array to existing task detail representations (GET detail, creation result, existing detail-producing updates). Keep list summaries lean; do not join checklist rows into all task list responses. Extend task creation with optional ordered `checklist: [{ title, dueDate? }]`. Task creation and its initial items persist atomically; in the creation form these are **local drafts until Create**, unlike quick-add on an existing task. Preserve the existing idempotency key behavior by including normalized, ordered initial checklist content in the creation-request fingerprint; same request/key replays the same task without duplicate children, different content/key reuse conflicts as before.

**Validation/errors:** Nonblank trimmed item title at most 255 characters; valid calendar date or null; reject unsupported fields, malformed payloads and invalid IDs with the project's existing `400` behavior. Return `404` for inaccessible task/child. Return `409 Conflict` for a reorder submitted against a changed live set or an invalid concurrent restoration conflict; client refreshes and allows a fresh attempt. Completion/reopen should remain idempotent. Preserve current API auth/session and Problem Details patterns.

**Important approved tradeoff:** Parent `POST /api/v1/tasks/{id}/complete` stays **unconditional**. The incomplete-checklist warning is **frontend-only**, with no extra confirmation flag, backend `409` policy, or server change to existing parent completion behavior. A stale-data race or direct API client can complete a task without seeing the warning; this is intentionally accepted.

## 5. Frontend composition and state flow

Extend existing `client/src/task/TaskDetailView.tsx` with a focused `ChecklistSection` and item presentation/editing subcomponents, shared automatically by task detail side panel and dedicated page. Place it between the task description and metadata, consistent with the approved workspace visual baseline. Use Horizon's existing theme tokens, shadcn/Radix conventions and Lucide icons. Avoid redesigning the parent Tasks workspace.

- **Read model:** Extend `types.ts`, task API and detail query to include ordered checklist. TanStack Query remains the server-state owner. Prefer narrow mutation hooks/handlers with clear invalidation of the affected task detail and any relevant task creation result. No global checklist store.
- **Quick add:** An always-available single-line input for active task details, Enter submit, reject blank or whitespace-only input, preserve typed text/error on failure, and support repeated entry without requiring a save session. During a reorder draft, disable add.
- **Title editing:** Single active per-item draft with Save/Cancel, keyboard accessibility, and the existing `TaskDraftNavigationGuard` registration. Prevent competing field editors while an item title or reorder draft is active; extend the guard's registration kind/UI copy narrowly if needed.
- **Due-date picker:** Small calendar icon and popover per item; immediate PATCH when choosing or clearing, visually reflect saving, retain/reconcile previous confirmed date and show a recoverable local error on failure. No separate Save/Cancel. Disabled during reorder.
- **Completion:** Immediate checkbox intent; update `completedAt` independently using the existing task-completion feedback philosophy (in-flight state, reconcile and retry on failure); avoid leaking child completion into parent-task completion state. Disabled during reorder.
- **Reorder:** Explicit reorder session with drag handles and keyboard move up/down alternatives plus announcements/focus handling. Show Save/Cancel while active. The reordering view is a local draft until one PUT succeeds; on failure retain the draft and offer retry/cancel. Use the existing navigation blocker for dirty/pending reorder. While a reorder session is unsaved, disable all other checklist mutations and opening parent field editors; do not silently discard another active draft to enter reorder mode. Library selection can be settled during detailed technical planning; any choice must meet drag, keyboard, and testability requirements without unnecessary infrastructure.
- **Remove/Undo:** DELETE immediately; show an 8-second Undo action in a small accessible notification. Restoration calls POST restore and puts the item back with the same identity/contents/position. Leaving the task-detail surface dismisses Undo. A pending removal/Undo failure must not silently lose data or misrepresent confirmed state. No global Trash entry. No simultaneous delete or add during unsaved reorder.

**Task creation:** Include optional lightweight checklist rows in the existing `TaskCreateForm`, using the same title/due-date concepts and local state. These drafts participate in the **existing creation form's dirty/pending navigation guard**, and are sent with the single idempotent task creation request. Do not call checklist-item endpoints before the parent task exists. Empty items must not be persisted.

### Parent task warning in list, panel, and page

Issue #21 already centralizes completion state and optimistic serialization in `TaskCompletionProvider`. Add a shared **completion-intent gate** in front of its existing toggle action, not inside backend `TaskCommandService.complete`, and do not duplicate separate completion implementations per surface.

- On an intent to **complete** an incomplete parent, obtain current checklist details (for list rows, fetch the task's details **on demand**, not eagerly for every row). Show a confirmation dialog only when at least one active checklist item is unfinished.
- Dialog actions: **Complete Anyway** issues the normal provider completion toggle; **Cancel** performs no mutation. Do not optimistically mark the parent complete before the user confirms.
- No incomplete children -> call provider immediately after the check. Already completed -> reopening continues through issue #21's existing immediate path, with no warning.
- If the checklist read fails, don't silently skip the warning: keep task unchanged and provide an actionable retry. While checking/confirming, prevent accidental duplicate completion intents. The frontend-only nature accepts ordinary races after the check.
- Preserve issue #21's list-session retention, fast reversal, archived task completion, unsaved-field-draft independence, spinner, error feedback and retry behavior. The checkbox gate is about completing the **parent**, not a child.

## 6. Testing and verification

**Backend — Spring integration with PostgreSQL Testcontainers:** migration and task ownership; two-item creation/reload/order; item title and date update/clear independent of parent; completion timestamps set/clear; soft-delete exclusion, restore ID/state/position; reorder exact-set validation, duplicate/missing/foreign IDs, stable order; archived vs deleted parent access; cross-user/cross-task 404; creation with initial items is atomic and idempotent under retry; parent completion doesn't touch children; errors use project Problem Details. Test date-only serialization and UTC timestamp behavior.

**Frontend — Vitest/RTL:** quick Enter add, title Save/Cancel, calendar selection/clear immediate mutation, checkbox complete/reopen and failure recovery, reorder drag and keyboard movement, save/cancel and guard, edit locks during reorder, remove and 8-second Undo with timer cleanup, creation-form drafts and idempotent retry, list/detail/page parent-completion confirmation and cancellation, failure to load checklist, completed-parent reopen path, parent completion independence from unsaved drafts. Verify accessibility labels, focus and keyboard interactions.

**Playwright as appropriate:** representative full-path flow from task creation through item additions, reorder, reload, due-date edit, checkbox toggle, removal/Undo, and parent warning across at least one list entry and the detail surface.

Run repository-prescribed backend and frontend format/lint/typecheck/tests plus relevant integration/E2E suites. Use the repo's existing testing skills/conventions. No unrelated framework upgrade or general architectural refactor.

## 7. Risks, constraints, and decisions deliberately deferred

1. **Frontend-only parent warning** is advisory, not an invariant. This is an approved tradeoff; document it in tests rather than adding covert backend enforcement.
2. **Multi-surface and async behavior** must reuse issue #21's completion provider without breaking optimistic serialized toggles or list-session retention.
3. **One draft guard** favors exclusive checklist reorder/title edit sessions; do not introduce broad concurrent draft management.
4. **Soft-delete rows persist** after UI Undo expires. No cleanup mechanism is required for V1; future retention policy is a separate decision.
5. **Order concurrency** requires atomic sibling-set validation so reordered/removed/added siblings do not disappear during stale writes.
6. **Today remains a future epic**. Store child due date/completion and respect the agreed parent visibility semantics without implementing that workspace now.

## 8. Planning handoff gate

Owner approved this written design on 2026-10-23, and subsequently approved the [written implementation plan](../plans/2026-10-23-issue-22-checklist-items.md). Luna's selected execution method is native/inline `superpowers:executing-plans`, following the issue #22 handoff comment. Planning approval does not imply that implementation code has already been changed.
