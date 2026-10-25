# Issue #26 — In-section task sorting design

**Date:** 2026-10-25  
**Issue:** https://github.com/krishna916/horizon/issues/26  
**Status:** Product semantics approved by owner in planning conversation; implementation design prepared for Luna.  
**Owner:** Horizon  
**Parent epic:** #2  
**Visual baseline:** [Approved Tasks design](../../design/tasks-workspace/DESIGN-SPEC.md) at commit `05fa90d`.  
**Related implementation:** [Issue #25 visibility design](2026-10-25-issue-25-task-history-visibility-design.md), [Issue #21 completion design](2026-10-22-issue-21-task-completion-design.md), [Issue #17 Task list design](2026-10-18-issue-17-task-list-design.md).  
**Product references:** HORIZON_CONSTITUTION; PRD-004 Tasks; SPEC-001 Shared Concepts; ENG-002 Frontend Engineering Guide; `client/AGENTS.md`.

## 1. Goal

Allow a user to select one of six approved sort orders for rows **within** the Active, Completed and Archived sections of the Tasks workspace. Section order and visibility remain controlled by existing lifecycle and issue #25 rules. Sorting changes presentation only, never persisted Task facts.

**Scope:** A single accessible Sort selector in the approved list-controls area, a deterministic pure client-side comparator, and ephemeral Tasks-route sort state. The same sort mode applies simultaneously to every eligible section; it is not a separate selection per section.

**Out of scope:** Per-section selectors, title sorting, custom sorts, filtering/status controls, user preferences, backend sorting parameters, saved views, migrations, additional task statuses, storage, and new dependencies.

## 2. Explicitly approved business rules

### Sort modes

| Selection label | Primary field / direction | Secondary / final ordering |
| --- | --- | --- |
| **Newest first** (default) | `createdAt` DESC | `id` DESC |
| **Oldest first** | `createdAt` ASC | `id` ASC |
| **Due date: earliest first** | `dueDate` ASC | `createdAt` DESC, then `id` DESC |
| **Due date: latest first** | `dueDate` DESC | `createdAt` DESC, then `id` DESC |
| **Priority: highest first** | CRITICAL, HIGH, MEDIUM, LOW | `createdAt` DESC, then `id` DESC |
| **Priority: lowest first** | LOW, MEDIUM, HIGH, CRITICAL | `createdAt` DESC, then `id` DESC |

- For **both due-date sorts**, tasks with `dueDate = null` always come **after** all dated tasks, in both directions. When both are undated, use `createdAt DESC`, then `id DESC`.
- For **both priority sorts**, tasks with `priority = null` always come **after** all prioritized tasks, in both directions. When both are unprioritized, use `createdAt DESC`, then `id DESC`.
- `createdAt` is the creation **instant**, not `updatedAt`, `completedAt`, `archivedAt` or a derived local date. Completion, editing, archiving and restoration must not affect the creation-sort order. Use chronological instant comparison (including offset-aware timestamps); equal instants use the ID tie-break.
- `dueDate` is already an ISO civil date `YYYY-MM-DD`; order by the date value without conversion to an instant, so local/UTC timezone differences cannot shift it.
- No title sort. Do not copy the mockup's comparator: its sort mechanics and null policy were explicitly illustrative and unapproved.

### Scope and state lifetime

- Sort **each** section's eligible rows independently, without interleaving sections or changing fixed section order: **Active → Completed → Archived**. Default is **Newest first**.
- Sorting is **one workspace-local choice** shared across all three sections, including collapsed/hidden ones; newly revealed sections use the current choice.
- Reuse exactly the **Issue #25 UI-state lifetime**: preserve selection while opening/closing/switching task panels, entering the creation panel, toggling Completed history and Archived tasks, collapsing sections, and visiting a canonical task page and returning. Reset to Newest first when navigating outside Tasks and returning, on full reload, or on authenticated account change.
- The sort selection is not encoded in the URL and is not saved in localStorage, sessionStorage, backend preferences, or TanStack Query's server data.
- Sort selection must remain usable with zero rows or a loading/error list, and changing it must not trigger a network request.

### Preserve existing lifecycle presentation

- The Task API excludes deleted records and scopes results to the user. `classifyTasks()` already enforces Archived precedence, today's completion/history visibility and the temporarily retained checked row in Active.
- Keep that classifier's membership behavior and output contract. Sorting runs **after** classification; do not mutate the Task summaries, the original cached array, or the classifier's bucket arrays.
- Sorting, collapsing, visibility switches and panel changes **must not terminate** the #21 temporary Active-row completion retention; going to a canonical full page still ends it per #25.
- The sort does not modify `createdAt`, `updatedAt`, `completedAt`, `archivedAt`, `dueDate`, `priority`, `inbox`, section counts or Task ownership, and must not fire any command endpoint.

## 3. Design alternatives and choice

**Chosen: pure client-side sorting of existing fetched `TaskSummary` items**, applied to the section buckets after `classifyTasks()`. A small task-owned pure utility owns mode definitions and comparator; the existing `TasksRouteLayout` context owns the selection; `TaskWorkspace` wires the selector and sorted rows. No backend changes. This fits the existing unpaginated `GET /api/v1/tasks` contract and avoids duplicated lifecycle logic.

**Rejected: backend sort parameters and dedicated API variants.** Unnecessary round trips, larger backend contract, repeated logic for the current client-only view and additional invalidation complexity.

**Rejected: filtering/reclassifying tasks in the sorter or keeping sort state only in TaskWorkspace.** The former risks lifecycle regressions; the latter loses selection on the canonical page round trip.

**Deferred:** Server-supported sorting/pagination if task collection size later requires it; this is not part of #26.

## 4. Concrete file responsibilities

- `client/src/task/task-sort.ts` (new): exported `TaskSortMode` union and pure `sortTaskSections(sections: TaskSections, mode: TaskSortMode): TaskSections`. Make defensive copies and apply the same comparator independently to Active, Completed and Archived. Keep sort options' labels near the UI instead of introducing a generic global sort framework.
- `client/src/task/task-sort.test.ts` (new): exact order cases for all six modes, both null directions, duplicate priority/date timestamps, ID final ties, offsets, immutability, and cross-section isolation.
- `client/src/task/TasksRouteLayout.tsx`: extend existing `TaskViewState` with `sortMode: TaskSortMode`; default `'newest'`. Existing owner-keyed session and route unmount already supply reset semantics.
- `client/src/task/TasksRouteLayout.test.tsx`: adjust any full-state fixture, assert default, round trip persistence, leave/reenter, hard reload at browser level, and account reset.
- `client/src/task/TaskWorkspace.tsx`: accessible Sort control in approved list-controls area (six exact options), owned by `viewState.sortMode`; apply pure sort before handing arrays to `TaskSection`. Reuse existing control/style conventions and view-state setter; do not add an independent persistent preference.
- `client/src/task/TaskWorkspace.test.tsx`: user-driven selection, all sections, history toggles, collapsed sections, no mutation/API writes, no old-user data leakage, loading/error.
- `client/e2e/task-section-sorting.spec.ts` (new): real browser sort control, visible row ordering for all modes, collapse/visibility, panel/page navigation and reset.

Follow `client/AGENTS.md`; use existing native/shadcn patterns without adding a component dependency. The approved static prototype specifies the **layout and labels**, not implementation logic.

## 5. Requirements reconciliation

| Source | Statement | Agreed #26 interpretation |
| --- | --- | --- |
| PRD-004 FR-019 | Default Due Date ASC → Updated Date DESC | **Superseded for this Tasks UI:** default Newest first by `createdAt DESC, id DESC`. |
| PRD-004 FR-020 | Undated last | Consistent for both ascending and descending due-date sorting; never fall back to `updatedAt`. |
| PRD-004 FR-017 / FR-027 | Status filter | Separate deferred filtering capability. No `status` enum is introduced by sorting; lifecycle sections remain timestamp-derived. |
| HORIZON_CONSTITUTION / SPEC-001 | Facts over states; module-owned facts | Fully preserved. |
| Approved design mockup | Demo comparator and null behavior | Illustration only; the explicit owner decisions above override it. |

**Documentation follow-up:** update the authoritative PRD-004 in the knowledge repository through the normal documentation process to describe the approved sort default and options. Do not silently modify PRD prose as part of this frontend code task unless owner authorizes that repository change.

## 6. Acceptance and edge cases

1. All six options present with the exact labels and deterministic orders above; Newest is initially selected.
2. Null due dates and null priorities sort last both ways; tied equal values use `createdAt DESC, id DESC`. Creation timestamp ties use `id DESC/ASC` in Newest/Oldest.
3. Every eligible section uses one selection; sort never changes section membership/order/count, and hidden/collapsed sections render correctly when revealed.
4. Sorting is in-memory only: cached items, persisted data, and task lifecycle remain unchanged; no new GET/POST/PATCH/DELETE request solely from switching sort.
5. Sort selection matches #25 route lifetime, account isolation and reset behavior.
6. Active-row completion retention and optimistic completion/reopen remain correct while sorting.
7. Unit, RTL, browser and full frontend quality checks pass. No backend regression testing required for this frontend-only scope.

## 7. Handoff boundary

Product semantics were explicitly approved by the owner in the Issue #26 planning conversation, including navigation persistence. Luna should follow the companion implementation plan for code changes, raise **new** product conflicts rather than inventing rules, and open a PR for review; do not merge automatically.
