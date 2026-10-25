# Issue #25 — Task History Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task **in the current repository checkout**. Use no isolated worktree, no subagent implementers and no subagent reviewers, as explicitly directed by the owner. Use checkboxes (`- [ ]`) below to track steps.

**Goal:** Deliver independent Completed history / Archived tasks visibility switches and independently collapsible Active, Completed and Archived sections, preserving the approved task lifecycle and route behavior.

**Architecture:** Keep one existing owner-scoped `GET /api/v1/tasks`. Derive sections from existing completion/archive facts on the client, without database status fields. Store temporary view state in the existing Tasks route layout so full-page task navigation does not erase it; keep the separate #21 completion-retention state in the list mount, as already implemented.

**Tech Stack:** React 19, TypeScript, TanStack Router and Query, Tailwind v4, Lucide/shadcn patterns, Vitest + React Testing Library, Playwright 1.61. Existing Java/Spring/Postgres backend remains unchanged.

**Spec:** [Approved issue #25 design](../specs/2026-10-25-issue-25-task-history-visibility-design.md). Also consult `docs/design/tasks-workspace/DESIGN-SPEC.md`, #17/#21/#23 design specs, project/client agent guidance, PRD-004 and the Horizon Constitution. **The approved issue #25 spec governs where old PRD prose conflicts.**

**Issue:** https://github.com/krishna916/horizon/issues/25
**Branch:** `feature/25-task-history-archive-visibility` (already created; this plan is committed there).
**Execution:** **Native inline Luna implementation. No git worktrees. No delegated/subagent implementation or review.** After tests and self-review, push this branch and open a non-draft PR against `master`, referencing `Closes #25`. Do not merge it.

## Global Constraints

- Begin in the ordinary repository checkout: `git fetch origin`, `git switch feature/25-task-history-archive-visibility`, `git status --short`, and verify the plan/spec files exist. **Never implement on master; never discard unrelated local changes.** If the branch checkout is unsafe due to existing local changes, stop instead of overwriting them.
- User has already approved the design; implement without re-asking settled questions. Escalate only genuinely new product decisions or conflicting requirements; no arbitrary workflow changes.
- Exact switch labels: **Completed history** and **Archived tasks**. Both always available, independent, and off at the start of every new Tasks visit.
- **Active** always shown, starts expanded. **Completed** shown iff its eligible count is nonzero, starts expanded. **Archived** shown iff its switch is on and eligible count nonzero, starts expanded. Empty Completed/Archived headings are hidden even with enabled switches.
- All section counts equal **eligible visible-set membership** (before collapsing). Collapsing retains heading/count and never calls the API or writes metadata.
- Visibility switches and collapsed state persist across list/panel/full-page Tasks navigation, but reset when leaving Tasks, refreshing, or changing the authenticated account. Existing temporary completion-row retention **does not** persist through the full-page task route.
- Classification precedence: deleted excluded by API; archived takes precedence over completion; current in-flight effective completion/reopen and active-row retention from #21 still apply. Preserve `completedAt` and `archivedAt`, no `status` enum.
- “Today” is the **browser-local date**, including offset-aware timestamps, midnight and focus/visibility resumption. Reuse `useLocalDay`; do not add polling or timezone libraries.
- Keep existing list ordering; #26 owns sorting. No saved views, advanced filters, new endpoints, migrations, localStorage, URL-backed state, global store, backend changes or new dependencies.
- Respect current `client/AGENTS.md`, module ownership, auth-safe cache boundaries, and approved visual baseline. No copy/paste of static mockup event code.
- Work in test-first RED → GREEN cycles; checkpoint commits per task. **Do not push or open a PR until the whole branch passes verification.**

## File map / interfaces

| Existing path | Responsibility |
| --- | --- |
| `client/src/task/task-view.ts` | Pure classifier; return the three derived buckets and apply visibility flags |
| `client/src/task/task-view.test.ts` | Pure lifecycle/classification and local-midnight regressions |
| `client/src/task/TasksRouteLayout.tsx` | Extend current route-layout context with non-persistent view state, preserved across nested routes |
| `client/src/task/TasksRouteLayout.test.tsx` | Router-level persistence, reset, account-boundary proof |
| `client/src/task/TasksListPage.tsx` | Pass Tasks-layout-owned view state into workspace without changing route semantics |
| `client/src/task/TaskWorkspace.tsx` | Always-visible switches; derive membership; render eligible sections; preserve completion retention |
| `client/src/task/TaskSection.tsx` | Accessible independent collapse and stable header/count; support Archived rows |
| `client/src/task/TaskWorkspace.test.tsx` | Default, toggles, collapse, counts, action integration and auth/loading/error tests |
| `client/e2e/task-history-visibility.spec.ts` (new) | Real-browser, mocked API, navigation/reset and timezone-boundary tests |

Define stable types **once** near their owner, imported from there (not duplicated across files):

```ts
// client/src/task/task-view.ts
export interface TaskVisibilityOptions {
  readonly showCompletedHistory: boolean;
  readonly showArchivedTasks: boolean;
}
export interface TaskSections {
  active: TaskSummary[];
  completed: TaskSummary[];
  archived: TaskSummary[];
}
export function classifyTasks(
  tasks: readonly TaskSummary[],
  now: Date,
  retainedCompletedIds?: ReadonlySet<number>,
  effectiveCompletedById?: ReadonlyMap<number, boolean>,
  visibility?: TaskVisibilityOptions
): TaskSections;
```

Maintain positional compatibility for existing `classifyTasks` callers by adding optional `visibility` **last**; default it to both false. Classification should not mutate or re-sort the input. A missing persisted timestamp during *optimistic* completion uses the current established `now` fallback, without inventing persistence.

Define `TaskViewState` in `TasksRouteLayout.tsx` (or a small adjacent task-owned type file if necessary) with exact properties `showCompletedHistory`, `showArchivedTasks`, and `expanded: Record<'Active' | 'Completed' | 'Archived', boolean>`. Export `DEFAULT_TASK_VIEW_STATE` or a factory and expose `viewState` / `setViewState` through the existing `useTasksLayout()`. Defaults: `false`/`false` and all three expanded `true`. The production Tasks index owns no competing persistent state; `TasksListPage` passes state/update to `TaskWorkspace`. Existing direct-render unit tests of `TaskWorkspace` may use the default settings and a stateful test harness to exercise controls.

## Review Focus — test these failure modes explicitly

1. **Archived + completed + historical**: never appears twice or leaks into Completed; restore reveals it under Completed only when history is on.
2. **At local midnight with UTC date different**: 23:59:59 completion becomes older after 00:00; 00:00:01 completion remains “today”; toggle history reveals correct records with no rollover-only network call.
3. **Hidden or collapsed sections during mutations**: archive/restore/delete/Undo and completed/reopen reflect correct eligibility and counts with no stale/duplicate rows.
4. **Route lifetime mismatch**: canonical page round trip preserves toggles/collapse while ending #21 temporary Active retention; navigation outside Tasks and hard refresh reset choices.
5. **Account and errors**: user change, pending auth verification or failed request never shows previous owner's tasks; view state resets for new owner.

---

### Task 1: Extend pure task classification to three eligible buckets

**Files**
- Modify: `client/src/task/task-view.ts`
- Modify: `client/src/task/task-view.test.ts`

**Interfaces**
- Consumes: existing `TaskSummary`, `useLocalDay` instant, completion-retention set and optimistic completion map.
- Produces: `TaskVisibilityOptions` and `TaskSections { active, completed, archived }`, plus backwards-compatible `classifyTasks` signature above.

- [ ] **Step 1 — RED:** Extend existing exact-equality tests to expect `archived: []`. Add tests named `historicalCompletionRequiresHistorySwitch`, `archivedWinsOverCompletionAndIgnoresRetention`, `independentArchivedAndHistorySwitches`, `preservesInputOrderAcrossBuckets`, `optimisticReopenAndRetainedCompletionStillWork` and `kolkataMidnightOffsetBoundary`. Assert task IDs across bucket arrays, nonduplication and original input unchanged. For Kolkata set `process.env.TZ = 'Asia/Kolkata'` with `try/finally` restoration; use instants `2026-10-25T18:29:59Z` and `2026-10-25T18:30:01Z` relative to local midnight (Oct 26), including history on/off.
- [ ] **Step 2 — Verify RED:** From `client/`: `npm run test -- src/task/task-view.test.ts`. Expected: focused new cases fail for missing archived bucket / visibility behavior, not a fixture or setup failure.
- [ ] **Step 3 — GREEN:** Implement exact signatures above. Archived when `archivedAt !== null` and switch enabled; else effective incomplete/retained => Active; else valid same browser-local day or history switch => Completed. Historical visibility must not accidentally include corrupt/unparseable timestamps. Preserve existing optimistic completion behavior and index order.
- [ ] **Step 4 — Verify GREEN:** `npm run test -- src/task/task-view.test.ts`. Expected: 0 failed tests, including prior retention and due-date tests.
- [ ] **Step 5 — Commit:** `git add client/src/task/task-view.ts client/src/task/task-view.test.ts && git commit -m "feat(tasks): classify historical and archived task visibility"`.

### Task 2: Own temporary list-view settings in the existing Tasks route layout

**Files**
- Modify: `client/src/task/TasksRouteLayout.tsx`
- Modify: `client/src/task/TasksRouteLayout.test.tsx`
- Modify: `client/src/task/TasksListPage.tsx`

**Interfaces**
- Consumes: the current `TasksRouteLayout` parent / nested index+detail routes and `useTasksLayout()` pattern.
- Produces: `TaskViewState`, `DEFAULT_TASK_VIEW_STATE`, `viewState` and `setViewState` in `useTasksLayout()`, provided by the parent route for TasksListPage to pass into TaskWorkspace. Keep existing `listRatio` / `setListRatio` intact.

- [ ] **Step 1 — RED:** Add a route-harness probe in `TasksRouteLayout.test.tsx` using `useTasksLayout()`. Assert defaults both switches off and all sections expanded. Change visibility/collapse, navigate index → panel search → canonical `/tasks/$id` → back and assert settings retained; navigate `/notes` then back to `/tasks` and assert reset. Add account-switch case with mocked `/users/me` confirming no settings leak into another user; separate hard reload is covered by Playwright.
- [ ] **Step 2 — Verify RED:** `npm run test -- src/task/TasksRouteLayout.test.tsx`. Expected: new state interface/tests fail before implementation.
- [ ] **Step 3 — GREEN:** Extend the existing Tasks layout provider, **not** a new app-global store. Keep route-context lifetime across the nested Tasks index and full-page child. Scope state to the verified current account; reset when user changes (an owner-keyed inner route session is acceptable if it preserves existing draft/lifecycle contracts). Do not introduce storage or URL query params. In `TasksListPage` pass state/setter to workspace (Task 3 implements the receiving UI). If necessary to preserve compilable commits, introduce minimal typed optional props/defaults in TaskWorkspace here without functional controls; avoid a dangling runtime provider contract.
- [ ] **Step 4 — Verify GREEN:** `npm run test -- src/task/TasksRouteLayout.test.tsx` and `npm run typecheck`. Expected: 0 failures; existing split ratio and task-navigation tests remain correct.
- [ ] **Step 5 — Commit:** `git add client/src/task/TasksRouteLayout.tsx client/src/task/TasksRouteLayout.test.tsx client/src/task/TasksListPage.tsx client/src/task/TaskWorkspace.tsx && git commit -m "feat(tasks): preserve temporary visibility state across task routes"`. Stage TaskWorkspace only if actually modified.

### Task 3: Render accessible visibility controls and independently collapsible sections

**Files**
- Modify: `client/src/task/TaskWorkspace.tsx`
- Modify: `client/src/task/TaskSection.tsx`
- Modify: `client/src/task/TaskWorkspace.test.tsx`
- Optionally create: `client/src/task/TaskSection.test.tsx`, if a focused test keeps the workspace test small.

**Interfaces**
- Consumes: `TaskViewState` / setter from Task 2, `TaskSections` and classification visibility from Task 1, existing `TaskRow` and lifecycle/completion callbacks.
- Produces: real labeled, controlled independent switches; `TaskSection` accepts `title: 'Active' | 'Completed' | 'Archived'`, `expanded: boolean`, and `onExpandedChange: (next: boolean) => void`, preserving other row/event props.

- [ ] **Step 1 — RED:** Add RTL tests for (a) both switch labels always present and off by default (including all-empty data), (b) Active and eligible Completed initially expanded; Archived absent, (c) history reveals older non-archived only, (d) archive switch reveals archived and archived-completed only, (e) empty Completed/Archived hidden regardless of switch, (f) count equals eligible tasks and remains when collapsed, (g) collapsing one section leaves others expanded, (h) expand/collapse/switch requires no task mutation API calls, and (i) controls remain accessible while list loading/error; no private rows rendered. Replace brittle hard-coded total `getAllByRole('button')` count with behavior-based assertions where needed.
- [ ] **Step 2 — Verify RED:** `npm run test -- src/task/TaskWorkspace.test.tsx` and, if created, `npm run test -- src/task/TaskSection.test.tsx`. Expected: new visibility/collapse assertions fail.
- [ ] **Step 3 — GREEN:** Add approved controls visually matching the screenshot to the task-list control region (omit unimplemented #26 Sort control). Prefer a native labeled checkbox with `role="switch"` and accessible checked state if shadcn Switch is not already installed; no new dependency for two controls. Implement each section's heading as a keyboard-usable collapse button with `aria-expanded` and matching `aria-controls` when rows present; render count even collapsed. Reuse existing Tailwind semantic tokens and Lucide icon style. Preserve Active empty message if expanded, and hide its rows/message on collapse. Do not change task checkbox/menu click behavior.
- [ ] **Step 4 — Verify GREEN:** `npm run test -- src/task/TaskWorkspace.test.tsx` (and any new TaskSection test) plus `npm run typecheck`. Expected: 0 failures. Manually inspect visual spacing on full-width and existing 60/40 panel.
- [ ] **Step 5 — Commit:** `git add client/src/task/TaskWorkspace.tsx client/src/task/TaskSection.tsx client/src/task/TaskWorkspace.test.tsx` (and new section test, if present); `git commit -m "feat(tasks): add history switches and collapsible sections"`.

### Task 4: Protect task lifecycle and local-day behavior with integrated UI tests

**Files**
- Modify: `client/src/task/TaskWorkspace.test.tsx`
- Modify: `client/src/task/TasksRouteLayout.test.tsx` as needed
- Modify: `client/src/task/TaskSection.tsx` / `TaskWorkspace.tsx` only if failures prove a regression

**Interfaces**
- Consumes: Tasks 1–3; existing `TaskCompletionProvider`, `TaskLifecycleProvider`, `useLocalDay`; server-state cache and Task overlay navigation.
- Produces: regression coverage for composite lifecycle and view settings without altering server/API behavior.

- [ ] **Step 1 — RED:** Tests exercise an archived completed task restoring to Completed if completed today, or hidden history unless history on if older; archived+completed never appears twice; current user switching resets switches/expansion; completion in an Active list stays in Active through control flips, collapsing, panel open/close, and a subsequent full-page trip ends retention. Test cached tasks at local midnight and focus/visibility return with history off and on while asserting **no extra API call solely for rollover**. Preserve existing auth pending/error cases and mock cleanup.
- [ ] **Step 2 — Verify RED:** `npm run test -- src/task/TaskWorkspace.test.tsx src/task/TasksRouteLayout.test.tsx`. Expected: new lifecycle/integration cases expose any missing behavior (if an existing behavior already passes, record that fact instead of fabricating failure).
- [ ] **Step 3 — GREEN:** Make only the minimum changes necessary for failing behavior. Do not rewrite completion/lifecycle providers or change backend persistence. Keep section membership derived from one owner-scoped query and its effective completion overlay.
- [ ] **Step 4 — Verify GREEN:** `npm run test -- src/task/task-view.test.ts src/task/TaskWorkspace.test.tsx src/task/TasksRouteLayout.test.tsx src/task/TaskSessionBoundary.test.tsx`. Expected: 0 failures.
- [ ] **Step 5 — Commit:** Commit only changed UI/tests with `git commit -m "test(tasks): protect visibility against lifecycle and midnight regressions"` (or a narrowly described `fix:` if a real bug required code changes).

### Task 5: Real-browser behavior, verification and handoff PR

**Files**
- Create: `client/e2e/task-history-visibility.spec.ts`
- Modify only if required by proven regression: existing Tasks files/tests.
- Update implementation-facing docs only when necessary; report PRD-004 correction as a documentation follow-up, not an unrelated codebase rewrite.

**Interfaces**
- Consumes: complete functionality from Tasks 1–4, existing Vite Playwright server / API route interception patterns (see `client/e2e/task-detail.spec.ts` and `client/e2e/task-lifecycle.spec.ts`).
- Produces: reproducible browser evidence, pushed branch and PR.

- [ ] **Step 1 — RED:** Add Playwright tests with mocked `/api/v1/users/me`, `GET /api/v1/tasks` and owned detail endpoints as necessary. Scenario A: seed active, today-completed, yesterday-completed, archived-incomplete, archived-completed. Verify defaults; toggle history; toggle archived; collapse/expand headings and stable counts; verify only unique rows, including panel opening and returning from canonical full page. Scenario B: navigate to /notes then /tasks, assert reset; reload /tasks and assert reset; side-panel interaction preserves state. Scenario C: use Playwright `timezoneId: 'Asia/Kolkata'` and `page.clock` with a boundary near Oct 26 local midnight to prove completion membership changes at 00:00 without another intercepted Task list request. Tests must not depend on wall-clock date or external backend.
- [ ] **Step 2 — Verify RED:** `npm run test:e2e -- task-history-visibility.spec.ts`. Expected: new tests fail for not-yet-implemented behavior; if functionality already implemented, record passing evidence instead of introducing a false failure.
- [ ] **Step 3 — GREEN:** Correct only test-proven integration defects, preserving existing navigation and auth security. If Playwright clock APIs need adjustment, consult installed Playwright 1.61 documentation/types rather than assuming incompatible APIs. Do not add production dependencies.
- [ ] **Step 4 — Verify GREEN:** `npm run test:e2e -- task-history-visibility.spec.ts` and `npm run test:e2e`. Expected: 0 failed browser tests. If browser binaries are missing run `npm run test:e2e:install` (environment prerequisites, not app dependencies).
- [ ] **Step 5 — Commit:** `git add client/e2e/task-history-visibility.spec.ts` (and any narrow fixes) then `git commit -m "test(tasks): verify history visibility in browser"`.

## Whole-branch verification — mandatory before push/PR

From `client/`, run each command and read the actual exit status/output:

```bash
npm run test
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run test:e2e
```

Expected for **each**: exit status `0`. If a command fails, diagnose root cause, fix and rerun all relevant checks; do not claim success from partial output or previously cached tests. Backend build is not necessary for this frontend-only change **unless backend files were touched**; if they were, run the repo-required Maven checks plus Postgres Testcontainers integration tests.

Before push, self-review `git diff origin/master...HEAD` against **all** approved spec acceptance scenarios; scan for unwanted status enum, migrations, sorting controls, localStorage, stale task content, mutation side effects, broken keyboard focus and snapshot/brittle test regressions. Owner forbids subagent review, so record **self-review** and any limitations transparently in PR. Also inspect `git status --short` and ensure no unrelated files were included.

Then, **as explicitly authorized by the owner**:

```bash
git push -u origin feature/25-task-history-archive-visibility
```

Create a **non-draft** PR from `feature/25-task-history-archive-visibility` to `master`, title similar to `feat(tasks): add completed history and archived visibility (#25)`. Body must include `Closes #25`; link design and this plan; describe agreed PRD-004 expansion conflict resolution, local time policy, route-level reset behavior, key acceptance tests, commands and actual verification outcomes. **Do not merge.**

Report to the owner the PR URL, commits, changed files, test results, and any remaining risks/PRD documentation follow-ups. **Do not mark as shipped if verification did not pass.**
