# Issue #17 — Persisted Tasks List Design Specification

**Status:** Written design specification approved by owner on 2026-10-18; approved for implementation planning, not yet for product-code changes.
**Issue:** https://github.com/krishna916/horizon/issues/17
**Epic:** https://github.com/krishna916/horizon/issues/2
**Prerequisite:** https://github.com/krishna916/horizon/issues/16 (completed)
**Visual source:** [Approved Tasks design](../../design/tasks-workspace/DESIGN-SPEC.md), commit `05fa90d`, and accompanying screenshots.
**Product and architecture sources:** PRD-004 Tasks; PRD-000 V1 Scope; SPEC-001 Shared Concepts; Horizon Constitution; `docs/ai/INDEX.md`; ENG-002 Frontend Engineering Guide; `AGENTS.md` and `client/AGENTS.md`.

## Goal and agreed scope

Turn authenticated `/tasks` from a placeholder into a persisted, read-only Tasks workspace. Show commitments from the real Task API, match the approved desktop layout and existing light/dark theme, and establish reusable feature-owned list boundaries without prematurely implementing actions from later stories.

The owner explicitly confirmed these decisions:
- **One authenticated Task collection request** using TanStack Query and existing Axios infrastructure; classification happens on the client.
- **Browser-local timezone** determines which completions count as "today." Rollover happens automatically at local midnight without backend polling.
- **Option B for future controls:** introduce a control only when it is functional in its owning story; never render deceptive buttons, dead clickable rows, checkbox/menu controls, or placeholder interactions in #17.
- **Completed section hidden when empty.** Older completions and archived tasks are hidden by default.
- Active list, loading, empty, error/working Retry and authenticated-user-safe cache behavior are required.

Do not copy `mockup.js` DOM/events into React or replace `AppShell`.

## Presentation and classification

The workspace heading is **All Tasks**, with subtitle **Stay organized and clear the path ahead.** Preserve approved typography, two-line rows, density, whitespace, section styling and semantic colors. Sections are conceptually ordered **Active → Completed → Archived**, but only Active and nonempty Completed render in #17.

| Section | Derivation | Default visibility |
|---|---|---|
| Active | `completedAt == null && archivedAt == null` | Always render section, including **No active tasks.** when zero rows |
| Completed | `archivedAt == null && completedAt` is on the browser-local current calendar date | Render section **only when nonempty** |
| Archived | `archivedAt != null` (takes precedence over completion) | Hide until #25 |
| Completed history | `archivedAt == null` and completion before the current browser-local date | Hide until #25 |
| Deleted | Excluded by the existing authenticated Task list query | Never render |

A task with both `completedAt` and `archivedAt` belongs to Archived, not Completed. Completed and archived facts must not become a new workflow status enum or persisted frontend state. Task inbox membership does not remove a task from the Tasks workspace.

Every visible row presents the **title** on the first line and **TASK-N key** plus only available **due date** and **priority** metadata on the second, following the approved screenshot styling/order. There is **no task description** in the list. The current API provides neither tags nor attachments: do not invent them, or render empty badges/icons. Preserve room in the row structure for future controls without drawing fake controls. Task key is display text, not a link in #17; canonical detail navigation is in #19.

Use the collection's existing stable newest-first order (`createdAt DESC, id DESC`) **within each section**. PRD-004's older due-date-first sort rule was superseded by the approved October 10 mockup and implemented #16 decision. User-selectable sorting belongs to #26.

Do not add functional Add Task, row-click navigation, completion checkbox, action menu, section collapse, history switch, archived switch or sorting control in #17; these are separately scoped and were explicitly deferred by the owner.

## API contract and data flow

Use only **`GET /api/v1/tasks`** via `client/src/lib/api-client.ts`. It returns `{ "items": [TaskSummary, ...] }`. Existing `TaskSummaryResponse` fields are:

```ts
type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
interface TaskSummary {
  id: number;                  // canonical backend identity
  key: string;                 // human-readable, e.g. TASK-7; per-user
  title: string;
  priority: TaskPriority | null;
  dueDate: string | null;      // YYYY-MM-DD, date only
  inbox: boolean;
  completedAt: string | null;  // ISO offset-aware timestamp
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface TaskListResponse { items: TaskSummary[]; }
```

The server already filters on the authenticated owner and `deletedAt IS NULL`; the shallow list does not expose `description`, `deletedAt`, `userId`, tag entities or attachment metadata. **No backend changes**, extra endpoints, pagination, migrations, or client-side artificial delete fields are needed for this story.

```text
/tasks authenticated route -> current-user query
  -> Task feature's user-scoped TanStack Query
  -> GET /api/v1/tasks (single collection request)
  -> pure lifecycle/date classification
  -> Active section and optional Completed section -> read-only task rows
```

All Task-specific code belongs under the **existing** `client/src/task/` directory, with `client/src/routes/_authenticated/tasks.tsx` remaining a thin route adapter. The frontend guide's `src/features/task` path is an illustrative convention; the actual repository uses `src/task`, `src/home`, `src/user`. Do not reorganize existing feature directories in this story.

Proposed responsibilities (exact filenames/interfaces follow only in the subsequent implementation plan): Task API client, summary types, query hook/configuration, pure classifier, workspace, section and row view, and tests. Keep TanStack Query as owner of server state and view-local React state for date rollover; no new global state management. Reuse existing shadcn/ui and theme primitives where appropriate.

**Cache and session boundary:** Task query identity includes authenticated numeric user ID (e.g. `['tasks', userId]`). Do not fetch task data while authentication is unresolved or failed. On account switch, do not show cached tasks belonging to the preceding user; never use a hardcoded owner ID or trust the key `TASK-N` as a globally unique identifier. Honor the existing authenticated route boundary and avoid a global auth redesign.

## Browser-local day behavior

Parse the `completedAt` ISO timestamp as an instant and compare its browser-local **year, month, and day** to the same parts of the browser's current date. Do not compare UTC calendar dates, use an exact 24-hour rolling window, or use the reference screenshot's frozen date.

Keep a lightweight view-local day signal. Schedule an update for the next **local** midnight, then schedule the next midnight again; account for days with non-24-hour lengths (DST). Recheck when a suspended/background tab regains focus or visibility and clean up timers/listeners. Do **not** refetch merely because midnight passed; regroup currently cached facts. Future server-side completions/refetches still update through TanStack Query.

`dueDate` is a pure date string, not a timestamp; format it without introducing an unintended timezone shift (in particular, avoid naïvely formatting `new Date('YYYY-MM-DD')` as a local instant). Use the approved visual representation.

## Loading, errors, emptiness, authorization

- **Pending:** render a calm loading state inside the workspace; no mock data, content flash or premature empty message.
- **Success with zero active:** render Active and **No active tasks.**. This applies even if the response includes only archived or historical completed tasks. Hide Completed if it has zero today completions.
- **Failure:** render an explanatory error with an actionable **Retry** that refetches the Task query. Failed authorization or request error must not fall through to previous/stale rows.
- **Unauthenticated/current-user-unavailable:** rely on the existing authenticated-route contract and show no task content while auth is unresolved. Do not introduce a new application-wide auth state mechanism.

## Acceptance tests and verification

Use Vitest + React Testing Library with isolated test-only fixtures and a QueryClient provider; do not ship fake task data. Tests must cover:

1. Successful authenticated list response renders title, key, present due/priority; omitted metadata is absent and description is not rendered.
2. Active, today's completed, older completed, archived, and archived+completed precedence; server-owned exclusion of deleted items.
3. Completed section hidden when zero today completions, visible when positive; Active empty state in genuinely empty and all-hidden scenarios.
4. Local day comparison of offset timestamps around local midnight, including dates differing from UTC; no fixed 24-hour assumption.
5. Timer-driven rollover while mounted and visibility/focus recovery, without a second Task API call; guaranteed fake-timer cleanup.
6. Pending/error/retry-to-success handling without leaking old data.
7. Changing authenticated user IDs cannot display other-account cached tasks; no API call while user identity unknown.
8. Absence of nonfunctional action/menu/navigation/sort/history/collapse controls.

Run actual `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` in `client/`; manually inspect the authenticated screen and light/dark themes against the approved desktop screenshot. Evidence must accompany completion claims.

## Cross-document reconciliation and exclusions

- PRD-004's historical Completed section/collapse concept is handled by **#25**, not #17. The approved October design controls this initial display.
- **#18** creates tasks; **#19** provides side panel/canonical navigation; **#21** implements completion/reopen; **#23** archive/delete; **#25** visibility and collapse plus expanded date-boundary coverage; **#26** sorting; **#27** tags; **#30** attachments. Their future controls must be functional when introduced.
- No Search, Inbox Capture, Today's workflow, Trash UI, backend schema, new API contract, account settings, timezone preference, global state store or speculative reusable framework in #17.
- `Task.id` remains canonical. Human-readable `TASK-N` values are per-owner; two owners may have the same displayed key.
- The API's unpaginated collection is a deliberate existing contract; do not silently introduce server filtering or pagination.

## Owner review gate

The owner approved this written design specification on 2026-10-18. The implementation plan is recorded at `docs/superpowers/plans/2026-10-18-issue-17-task-list-implementation.md` for separate review. Do not implement product code or merge changes until that plan is reviewed and the execution method is confirmed.
