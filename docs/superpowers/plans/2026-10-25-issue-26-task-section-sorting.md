# Issue #26 — In-section Task Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan **task-by-task** in Luna's normal repository checkout. Use RED → GREEN test cycles and checked `- [ ]` steps. Luna owns coding; an independent read-only final review is welcome. Do not implement on `master`.

**Goal:** Add six deterministic sort orders, selected once for the Tasks workspace and applied independently inside Active, Completed and Archived, with no persisted sorting preferences or task mutations.

**Architecture:** Use the existing `GET /api/v1/tasks` owner-scoped result and `classifyTasks()` unchanged. Apply a small pure frontend sort function *after* classification, and store the selected sort mode alongside existing ephemeral visibility/collapse settings in `TasksRouteLayout`. No backend, database, API, or dependency changes.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, Tailwind 4, existing Lucide/shadcn/native controls, Vitest + React Testing Library, Playwright.

**Spec:** [Issue #26 design and owner-approved business rules](../specs/2026-10-25-issue-26-task-section-sorting-design.md). Also read [approved workspace visual spec](../../design/tasks-workspace/DESIGN-SPEC.md), [#25 visibility spec](../specs/2026-10-25-issue-25-task-history-visibility-design.md), PRD-004 Tasks, SPEC-001, Horizon Constitution, ENG-002 and `client/AGENTS.md`.

**Issue:** https://github.com/krishna916/horizon/issues/26  
**Branch:** `feature/26-task-section-sorting` (created from `master`; design and plan committed here).  
**Implementation owner:** Luna, native/inline. The owner has approved product semantics and #25-style navigation lifetime. No further questions on these settled rules.

## Global Constraints

- Start with `git fetch origin && git switch feature/26-task-section-sorting && git status --short`. Confirm this plan and its spec exist. Do not discard/overwrite unrelated local changes; stop and surface conflicts.
- Implement **only** issue #26. Do not create a task `status` enum, backend endpoint, migration, persistent sort storage, URL query, new global store, backend preference, filter, or extra dependency.
- Exact selector labels: `Newest first` (default), `Oldest first`, `Due date: earliest first`, `Due date: latest first`, `Priority: highest first`, `Priority: lowest first`. Visible control label: `Sort`. No title sort.
- `Newest`/`Oldest` primary `createdAt` instant DESC/ASC, final `id` DESC/ASC. Never use `updatedAt`, `completedAt` or `archivedAt` for this.
- Due sorts primary `dueDate` civil date ASC/DESC; priority sorts primary rank CRITICAL > HIGH > MEDIUM > LOW in both directions. **Null due dates and null priorities always last in both directions.** Ties: `createdAt DESC`, then `id DESC`.
- Apply sorting **independently within** Active/Completed/Archived. Keep their order and existing lifecycle membership/counts. Sort must not mutate task objects, cached arrays, or classified buckets.
- Keep one ephemeral selection scoped like #25 visibility/collapse: preserve within Tasks panel/creation/page round trips and toggles/collapse; reset after navigating outside Tasks, reload, or account change. Do not reset #21 temporary checked-row retention when changing sort; canonical-page visit still ends that retention.
- Sort change is a view-only state update. Never invoke a task API mutation or add a GET solely to sort. Use existing auth/error state guards to avoid cached cross-account content.
- Do not copy static `mockup.js` comparison logic (its missing-value behavior is not approved). Match the established UI visual and theme conventions instead.
- Keep each step RED → failing focused test → minimal implementation → passing focused test → checkpoint commit. Use `client/AGENTS.md`; when available, `testing-frontend` skill governs test mocks/selectors.
- Verify all checks before PR, then push the feature branch and create a non-draft PR against `master` with `Closes #26`. **Do not merge.** Escalate only new conflicts/decisions; do not reopen the approved sort semantics.

## File map and stable interfaces

| Path | Responsibility |
| --- | --- |
| **Create** `client/src/task/task-sort.ts` | `TaskSortMode` definition and pure sort utility; no React/API |
| **Create** `client/src/task/task-sort.test.ts` | Comparator, nulls, ties, immutability, three-section tests |
| **Modify** `client/src/task/TasksRouteLayout.tsx` | Extend `TaskViewState` and `DEFAULT_TASK_VIEW_STATE` with `sortMode` |
| **Modify** `client/src/task/TasksRouteLayout.test.tsx` | Full-state fixtures, route-state lifetime and user isolation |
| **Modify** `client/src/task/TaskWorkspace.tsx` | Accessible Sort selector and post-classification sorting |
| **Modify** `client/src/task/TaskWorkspace.test.tsx` | RTL sort interactions, visibility/collapse/retention and request invariants |
| **Create** `client/e2e/task-section-sorting.spec.ts` | Browser-level sort and route reset validation |

**Define in `client/src/task/task-sort.ts` (export exactly once):**
```ts
import type { TaskSections } from './task-view';

export type TaskSortMode =
  | 'newest'
  | 'oldest'
  | 'due-earliest'
  | 'due-latest'
  | 'priority-highest'
  | 'priority-lowest';

export function sortTaskSections(sections: TaskSections, mode: TaskSortMode): TaskSections;
```

`TaskSortMode` imports into `TasksRouteLayout.tsx` as a type. Extend existing `TaskViewState` with `sortMode: TaskSortMode`, with default `'newest'`. **Do not** introduce a second view-state owner or modify `classifyTasks()`'s function signature.

## Review Focus (include these regressions in the owning tasks)

1. Equal primary values but different `createdAt` and equal creation instants with different IDs give the owner-approved deterministic order.
2. Nulls stay **last in ascending and descending** due-date/priority orders, even when *both* items are null.
3. Equivalent instants expressed using different timezone offsets sort equally and use IDs as ties; due dates remain civil dates, not timezone-shifted instants.
4. Sorting a temporarily completed-but-retained Active row never reclassifies/removes it, ends no retention and creates no request; opening canonical page still ends retention per #25.
5. Hidden or collapsed sections adopt the chosen sorting when reopened; navigating outside Tasks, hard refresh and account changes reset selection and never expose previous-user rows.

---

### Task 1 — Pure deterministic sorting across classified sections

**Files**
- Create: `client/src/task/task-sort.ts`
- Create: `client/src/task/task-sort.test.ts`

**Interfaces**
- Consumes: `TaskSections` and `TaskSummary` (existing `task-view.ts`, `types.ts`).
- Produces: `TaskSortMode` and `sortTaskSections(sections: TaskSections, mode: TaskSortMode): TaskSections`.

- [ ] **Step 1 — RED:** In `task-sort.test.ts` create task summaries with *distinct* `createdAt`, `updatedAt`, `dueDate`, `priority` and ID values; use stable fixed timestamps. Test `newestFirstUsesCreatedAtNotUpdatedAt`: e.g. task 3 created Oct 20/updated Oct 01 precedes task 4 created Oct 19/updated Oct 25. Test `oldestFirstReversesCreationOrder`. Assert exact IDs and ensure both Newest/Oldest use id DESC/ASC respectively on equal creation timestamps.
- [ ] **Step 2 — RED:** Add table-driven tests `dueEarliestAndLatestPlaceUndatedLast` and `priorityHighestAndLowestPlaceUnprioritizedLast`. Assert all four priority levels in both directions; same due date/priority ties order by createdAt DESC then id DESC; two missing-value rows use the same tie rule. Include equivalent creation instants with different ISO offsets and due dates at a timezone boundary.
- [ ] **Step 3 — RED:** Add `sortsAllSectionsIndependentlyWithoutMutation`: deliberately interleave three buckets, assert each sorted ID list, preserve section membership/counts and fixed section key order, and assert **the original `sections` and all input arrays/objects are unchanged**.
- [ ] **Step 4 — Verify RED:** From `client/`: `npm run test -- src/task/task-sort.test.ts`. Expected: FAIL due to missing module/export/function, not fixture setup error.
- [ ] **Step 5 — GREEN:** Implement minimal pure comparator and copied arrays. Compare `createdAt` as real chronological instants (`Date.parse` or equivalent) to respect offsets; compare `dueDate` as the canonical `YYYY-MM-DD` civil-date string; use explicit priority ranks and null-first check **before applying ascending/descending sign** so nulls are always last; use numeric ID as final tie. Do not call any API or mutate source data. The data contract guarantees valid nonnull `createdAt`; do not invent a user-facing invalid-createdAt policy.
- [ ] **Step 6 — Verify GREEN:** `npm run test -- src/task/task-sort.test.ts` and `npm run typecheck`; expected 0 failures.
- [ ] **Step 7 — Commit:** `git add client/src/task/task-sort.ts client/src/task/task-sort.test.ts && git commit -m "feat(tasks): add deterministic in-section sort utility"`.

### Task 2 — Persist temporary sort selection across Tasks subroutes only

**Files**
- Modify: `client/src/task/TasksRouteLayout.tsx`
- Modify: `client/src/task/TasksRouteLayout.test.tsx`

**Interfaces**
- Consumes: `TaskSortMode` from Task 1, current route-layout view-state provider.
- Produces: `TaskViewState.sortMode: TaskSortMode`, `DEFAULT_TASK_VIEW_STATE.sortMode === 'newest'`, existing `useTasksLayout().viewState` and setter unchanged otherwise.

- [ ] **Step 1 — RED:** Update any complete `TaskViewState` object literals in the existing router test harness with `sortMode`. Add `sortModeDefaultsToNewest` and `sortModeSurvivesPanelAndCanonicalPageRoundTrip`. Probe via `useTasksLayout()`: switch to `priority-highest`; index → panel URL → /tasks/$id → back must preserve it, while history switches/collapse states remain intact.
- [ ] **Step 2 — RED:** Add `sortModeResetsAfterLeavingTasksAndChangingAuthenticatedOwner` asserting `'newest'` on `/notes` → fresh `/tasks`, and a different authenticated user, with existing owner-keyed reset. Browser hard reload goes in Task 4. Keep pre-existing route tests intact.
- [ ] **Step 3 — Verify RED:** `npm run test -- src/task/TasksRouteLayout.test.tsx`; expected new default/state assertions to fail prior to implementation.
- [ ] **Step 4 — GREEN:** Add `sortMode` to existing `TaskViewState` and `DEFAULT_TASK_VIEW_STATE` in `TasksRouteLayout.tsx`. Reuse existing scoped `TasksLayoutSession` state and provider; **do not** add localStorage or another provider. Adjust affected typed test fixtures; search for whole-object `setViewState({...})` callsites.
- [ ] **Step 5 — Verify GREEN:** `npm run test -- src/task/TasksRouteLayout.test.tsx` and `npm run typecheck`; expected 0 failures.
- [ ] **Step 6 — Commit:** `git add client/src/task/TasksRouteLayout.tsx client/src/task/TasksRouteLayout.test.tsx && git commit -m "feat(tasks): retain temporary sort selection within Tasks routes"`.

### Task 3 — Wire accessible selector into Tasks workspace

**Files**
- Modify: `client/src/task/TaskWorkspace.tsx`
- Modify: `client/src/task/TaskWorkspace.test.tsx`
- Optionally modify: `client/src/task/TasksRouteLayout.test.tsx` only for relevant integration assertions.

**Interfaces**
- Consumes: `viewState.sortMode`, `updateViewState`, `TaskSections`, `sortTaskSections`.
- Produces: native accessible `Sort` combobox with six options and sorted rows to the existing `TaskSection`; no other public interface change.

- [ ] **Step 1 — RED:** Test `sortSelectorShowsSixApprovedOptionsAndDefaultsToNewest` using `screen.getByRole('combobox', {name: 'Sort'})`, with exact accessible option text from Global Constraints; assert it is visible even when the task list is empty/loading/error.
- [ ] **Step 2 — RED:** Test `sortSelectionReordersActiveCompletedAndArchivedWithoutCrossingSections`: use realistic tasks with missing and equal values; enable both history switches; select at least `due-latest` and `priority-lowest`; verify **ordered row buttons inside each named section** and section count/headers, not just DOM text presence. Include all six options in a table-driven selector/ordering test or focused utility tests from Task 1.
- [ ] **Step 3 — RED:** Test `sortDoesNotEndActiveCompletionRetentionOrTriggerRequests`: a completed Active row stays there while changing sort and toggling/collapsing; no `taskApi.complete`, `reopen`, `update`, `archive`, `restoreArchive`, `softDelete` calls caused solely by sorting. `taskApi.list` isn't called again solely for switching sort. Test changed list data re-sorts under current mode, and error/auth verification hides stale task rows.
- [ ] **Step 4 — Verify RED:** `npm run test -- src/task/TaskWorkspace.test.tsx`. Expected newly added tests to fail because no sort control exists yet.
- [ ] **Step 5 — GREEN:** In `TaskWorkspace`, render a theme-consistent Sort control before existing visibility switches, matching the approved `docs/design/tasks-workspace/index.html` visual concept (but not copying demo behavior). Use one controlled `<select id=... value={viewState.sortMode} onChange=...>` bound through `updateViewState(current => ({...current, sortMode: next}))`. Keep other view-state properties. Derive `const sortedSections = sections ? sortTaskSections(sections, viewState.sortMode) : undefined` and pass those arrays to the **existing** `TaskSection` instances. Keep the current auth/list conditional rendering and #21 retention logic intact.
- [ ] **Step 6 — Verify GREEN:** `npm run test -- src/task/TaskWorkspace.test.tsx src/task/task-sort.test.ts src/task/TasksRouteLayout.test.tsx`, `npm run typecheck`; expected 0 failures.
- [ ] **Step 7 — Commit:** `git add client/src/task/TaskWorkspace.tsx client/src/task/TaskWorkspace.test.tsx && git commit -m "feat(tasks): expose workspace sort control across task sections"`.

### Task 4 — Browser regressions, verification and handoff

**Files**
- Create: `client/e2e/task-section-sorting.spec.ts`
- Modify only as test-discovered and relevant: the files from Tasks 1–3.

**Interfaces**
- Consumes: the existing Playwright mocked-auth/list conventions from `client/e2e/task-history-visibility.spec.ts`, `/tasks`, `/tasks/$id` routes.
- Produces: browser proof of selected sorting and route lifetime.

- [ ] **Step 1 — RED:** Write `sortOptionsReorderRowsWithoutNewApiRequests` with mocked `/api/v1/users/me` and `/api/v1/tasks` and distinct active/completed/archived rows. Assert default Newest; choose the other five modes and assert representative ordered task-row identifiers via the corresponding section's accessible region/list; include null-last both directions. Track list GET count and mutation requests: selecting a sort issues none.
- [ ] **Step 2 — RED:** Write `sortPersistsWithinTasksAndResetsOutside`: select `priority-highest`, toggle Completed history and Archived tasks, collapse/re-expand one section, open/close detail panel, visit full-page `/tasks/$id` and back — sort remains. Navigate `/notes` → `/tasks`, assert Newest; repeat sort choice then hard-reload and assert Newest. Test the control and section order with sections hidden/collapsed.
- [ ] **Step 3 — GREEN:** Make only minimal fixes to the implementation or browser fixtures uncovered by those cases. No new functionality or unrelated refactors.
- [ ] **Step 4 — Verify focused browser:** From `client/` run `npx playwright test e2e/task-section-sorting.spec.ts`; expected 0 failures. Use project's existing Playwright setup; if browsers/toolchain unavailable, record that explicitly rather than claiming pass.
- [ ] **Step 5 — Full verification:** From `client/` run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test:e2e` (assuming environment supports configured browser tests). Fix only relevant issues; record exact commands/results. Manually inspect desktop dark and light themes against approved Sort control and collapsed/hidden section behavior when possible.
- [ ] **Step 6 — Self-review:** Compare every issue #26 criterion and approved spec rule to a passing test. Check no backend changes, extra dependencies, API calls on sort, duplicate lifecycle membership, changed counts, changed `createdAt` fields, cached-array mutation or cross-user leak.
- [ ] **Step 7 — Commit:** `git add client/e2e/task-section-sorting.spec.ts` plus any genuinely needed test-driven changes, then `git commit -m "test(tasks): verify sorting and navigation lifecycle in browser"`. If no follow-up changes and tests already committed, commit only the new E2E artifact.
- [ ] **Step 8 — Deliver:** `git status --short`, review diff against `master`, `git push -u origin feature/26-task-section-sorting`. Open **non-draft PR** against `master` titled `feat(tasks): add in-section task sorting`, describe the six modes, null/tie policies and test evidence, and include `Closes #26`. **Do not merge.**

## Completion checklist

- [ ] Owner-approved sorting semantics implemented exactly, including create timestamp vs updated timestamp.
- [ ] All six options, null policies, and tie-breaks proven by unit + user-facing tests.
- [ ] Sections remain Active → Completed → Archived with counts/visibility unchanged.
- [ ] #21 retained completed-row presentation and #25 navigation/visibility behavior preserved.
- [ ] No persistent state, API, schema, or backend modifications.
- [ ] Client verification outputs recorded accurately, and PR links back to Issue #26.

## Documentation conflict reminder

PRD-004 FR-019 still describes the older due-date-first default. **The owner's accepted Issue #26 rules supersede that specific default**; do not modify the authoritative PRD stored in the separate knowledge repository without separate permission. The status-filter wording in PRD-004 does not mandate a stored status and is outside this issue. If new genuine conflicts emerge during implementation, raise them rather than inventing product rules.
