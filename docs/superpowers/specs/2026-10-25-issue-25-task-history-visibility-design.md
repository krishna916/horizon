# Issue #25 — Completed-history and Archived visibility design

**Date:** 2026-10-25
**Status:** Approved by owner on 2026-10-25; ready for implementation planning.
**Issue:** https://github.com/krishna916/horizon/issues/25
**Intended implementer:** Luna
**Parent epic:** #2
**Visual baseline:** [Tasks workspace approved design](../../design/tasks-workspace/DESIGN-SPEC.md), approved 2026-10-10.
**Related prior decisions:** [#17 persisted list](2026-10-18-issue-17-task-list-design.md), [#21 completion](2026-10-22-issue-21-task-completion-design.md), [#23 archive and trash](2026-10-24-issue-23-task-archive-trash-design.md).
**Product references:** Horizon Constitution; PRD-004 Tasks; SPEC-001 Shared Concepts; PRD-003 Inbox; ENG-002 Frontend Engineering Guide.

## 1. Intent and boundaries

Users should see active commitments and today's completed work without historical clutter, and explicitly choose to reveal older completed tasks and archived tasks. Each section can collapse independently without changing task facts.

Deliver **Tasks list presentation only**: independent visibility switches, derived sections, collapsible headings and counts, and temporary navigation-scoped view state. The existing task API supplies the necessary timestamps. Do **not** create new task statuses, queries, endpoints, migrations, persisted preferences, global stores, or broad filtering/sorting capability.

Do not implement the sort controls from #26 or fine-grained Status/Priority/Tags/Due Date filters from PRD-004 in #25.

## 2. Owner-approved product contract (2026-10-25)

1. **Always offer** controls with exact labels **Completed history** and **Archived tasks**, independently switchable and **off by default**.
2. **Active** is always rendered and **expanded by default**. It displays unfinished, non-archived tasks, plus the already-approved temporary Active-row completion retention from #21. If empty, show **No active tasks.**
3. **Completed** renders only when it has eligible entries and is **expanded by default**. With history off, eligible entries are **today's** non-archived completions; with history on, eligible entries include both today's and older non-archived completions.
4. **Archived** renders only when **Archived tasks** is on and archived entries exist; it starts **expanded** when it becomes visible. Include completed-and-archived tasks exclusively here, never duplicated in Completed.
5. **Empty Completed and Archived sections are hidden**, even if the corresponding switch is enabled. The switches themselves remain visible and usable.
6. Each visible section has an independently operable expand/collapse control. Collapsing hides rows, **not** the section heading or its count. Changing one section's collapse state does not alter another section.
7. Section counts represent the tasks **eligible under current visibility settings**, not all stored tasks and not just currently expanded rows. A collapsed section retains its same count.
8. Temporary view state (both switches and all collapse states) survives opening, closing and switching the side panel, and a trip to the canonical full-page task route **and back**, but resets to defaults on navigating outside Tasks, full-page browser refresh, and a genuinely new Tasks visit.
9. **Today** uses the browser's local calendar date (not a hard-coded IST/UTC date) and its local midnight. Use the existing `useLocalDay` contract so completion classification updates at midnight or on tab/focus resume **without an API request solely for rollover**.
10. Leaving the list for the canonical full-page route **still ends the distinct #21 temporary completed-row retention**. This is different from preserving history switches/collapse state. While the Tasks list remains mounted, sorting/toggles/collapse/panel navigation must not end that temporary retention.

## 3. Classification and precedence

The server list already excludes deleted tasks and is scoped to the authenticated owner. For each returned `TaskSummary`, classify using facts, in this order:

- `archivedAt != null` => Archived (only if switch on), regardless of `completedAt`.
- Else, effective completion is false => Active.
- Else, ID is retained by existing list-session completion behavior => Active **for presentation only**.
- Else, completion is browser-local today => Completed.
- Else, completion is older than today => Completed only if Completed history switch is on.

An effective pending completion/reopen from #21 must continue to affect the immediate UI while requests are in flight; keep its rollback, error/retry and per-task serialization behavior. Do not fabricate or overwrite persisted completion timestamps. Missing/invalid completion dates should not appear in older history by accident: preserve the existing safe invalid-date behavior, and test it. Preserve current server-provided list order until #26 defines sorting.

Archived tasks may be completed or reopened using existing domain/API behavior; `archivedAt` remains set. Undo Archive/restore exposes the task under Active, Completed or hidden history according to preserved `completedAt`. Undo Delete restores the former `archivedAt` and `completedAt` classifications. Inbox flag is independent and must not influence membership in Tasks.

## 4. Implementation approach and trade-offs

**Chosen pragmatic approach — client-derived visibility, Task route layout owns ephemeral view state.**

- Extend `client/src/task/task-view.ts` / `classifyTasks` to return Active, Completed, Archived buckets with explicit history visibility. Retain existing effective-completion and retained-row inputs.
- Extend `client/src/task/TasksRouteLayout.tsx`'s existing Task layout context for the two switches and three expansion flags, so state survives the index-list unmount on canonical `/tasks/$id` navigation. The layout unmount on leaving Tasks (and memory reset on refresh) provides the required lifecycle. Reset account-scoped UI on authenticated-user change; never surface old-user content/settings across account boundaries.
- Add controls in `TaskWorkspace.tsx`, adapt `TaskSection.tsx` for Archived, collapsible accessible headings and counts. Use existing theme tokens and approved design layout; use keyboard-operable controls with explicit accessible switch/expanded states.
- Keep one existing `GET /api/v1/tasks` list fetch, TanStack Query ownership, and current `useLocalDay` hook.

**Alternatives rejected:** New backend filters/status would duplicate derived classification and increase complexity without benefit; localStorage/sessionStorage or URL-backed preferences would violate the approved reset behavior. A state hook only inside `TaskWorkspace` would lose UI selections on full-page navigation.

No new dependencies or backend changes anticipated.

## 5. Usability, errors and edge cases

- Section headings and counts remain visible when collapsed; hidden rows are not keyboard focusable.
- Both switches remain visible when list is empty or there is a loading/error condition; they must not expose stale private task rows during authentication revalidation or query error.
- Preserve existing Task rows' checkbox/menu/select behavior and existing detail-panel/full-page navigation. Expanded/collapsed controls must not open a task row.
- Keep list state stable across creation, completion, archive, restore, delete and TanStack Query refreshes, except where those facts legitimately change membership/count. No duplicate task in simultaneous buckets.
- Browser-local 23:59:59 versus 00:00:01 boundaries must be tested using explicit timezone offsets, especially when local and UTC dates differ. Ensure cache regrouping at local midnight and on tab focus/visibility refresh, without new network requests.
- Preserve owner-scoped API security and existing 404 semantics; no new authorization surface.

## 6. Conflicts reconciled and documentation follow-up

| Source | Older text | Confirmed interpretation for #25 |
|---|---|---|
| PRD-004 FR-025 / FR-026 | Completed and Archived collapsed by default | **Superseded for this design:** Active and eligible Completed start expanded; Archived starts expanded when revealed. Owner explicitly approved. |
| PRD-004 FR-017 / FR-027 | Status filter can show Completed | No stored `status` field. Status is a **derived** filter concept; fine-grained filter controls are a separate story, not #25. |
| PRD-004 restore prose | Restore Archived -> Active | Superseded by approved #23 lifecycle behavior: preserve `completedAt` and reclassify based on facts. |
| PRD-004 FR-019 | Due date ascending default | #26 owns sorting controls and their defaults. #25 must preserve current ordering and not preempt #26. |

Update the product PRD in its authoritative knowledge repository through the normal documentation process to reflect the approved initial expansion and restore semantics. Do **not** add a status enum to reconcile prose.

## 7. Acceptance verification

A Luna implementation must demonstrate:

1. Default visible set is Active + today's Completed; history/archived switches off. Empty optional sections absent.
2. Completed history switch independently adds older completions; switch off hides only the older subset.
3. Archived switch independently reveals archived entries, including completed+archived; no duplicate IDs across sections.
4. Collapse/expand retains count and heading and doesn't mutate any persisted task metadata or issue API writes.
5. Task panel selection, closing and full-page round trip preserve toggles/collapse; leaving Tasks or refreshing resets them. Existing completed-row retention ends on full-page route, not on list controls/panels.
6. Local day boundary and tab resume regroup cached completion facts in tested local timezone, without list refetch solely for midnight.
7. Ownership/auth loading/failure states still hide protected task content; later mutations and retries update correct buckets.
8. Vitest classification and RTL component/router tests, targeted Playwright navigation check, and project frontend quality gates pass.

## 8. Planning and execution gate

All previously raised product-behavior questions were answered by the owner by 2026-10-25. The owner approved this consolidated specification and explicitly authorized a Luna implementation plan. Execute the linked TDD-oriented Luna plan in the existing feature branch, then push and open a PR. No additional product or scope decisions may be introduced without owner approval.
