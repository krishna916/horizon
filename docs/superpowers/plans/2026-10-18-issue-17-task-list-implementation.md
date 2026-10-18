# Issue #17 — Persisted Tasks List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Horizon's authenticated `/tasks` placeholder with a read-only, API-backed Active list and conditional Completed Today list, matching the approved design without implementing future-story controls.

**Architecture:** One owner-authenticated `GET /api/v1/tasks` query cached by numeric user ID. Pure client-side lifecycle/date classification feeds feature-owned presentational components. A local-day hook updates the grouping at browser-local midnight or after a suspended tab resumes without polling the API.

**Tech Stack:** React 19, TypeScript, TanStack Router and Query, Axios, Tailwind CSS 4, Vitest, React Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-issue-17-task-list-design.md` (approved 2026-10-18)

**Issue:** https://github.com/krishna916/horizon/issues/17

## Global Constraints

- Read the approved spec AND `docs/design/tasks-workspace/DESIGN-SPEC.md` / `screenshots/01-list.jpg` before writing code. Also obey `client/AGENTS.md`, the Constitution and existing patterns.
- Work on a separate implementation branch, **not** the documentation-only branch. Ensure the approved spec/plan are available in that branch before execution; reconcile with the latest `master` first.
- Current frontend layout is `client/src/task/` and `client/src/routes/_authenticated/tasks.tsx`; do **not** move it into `src/features/` or change `AppShell`.
- Existing API response: `{ items: TaskSummary[] }`; `GET /api/v1/tasks` is already owner-filtered, excludes deleted tasks, and orders by `createdAt DESC, id DESC`. Preserve order **within** sections.
- Task list fields: `id`, `key`, `title`, nullable `priority`, nullable `dueDate` (`YYYY-MM-DD`), `inbox`, nullable `completedAt`, nullable `archivedAt`, `createdAt` and `updatedAt`. `TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'`.
- Visible copy: `All Tasks`, `Stay organized and clear the path ahead.`, `Active`, `Completed` and `No active tasks.`. Keep user-facing copy aligned with the spec and visual baseline.
- Never render actions that do not work: no fake checkbox, menu, creation, sorting, history, collapse, or task-opening affordance. Task key is text, not a link.
- Archived always overrides completed; archived and older completed rows are hidden in #17. Completed is completely absent if none were completed on the current browser-local calendar day. Active remains visible even when empty.
- Render key, optional priority then optional due date in the mockup's metadata order; title on line one. No description, tags or attachments. Use theme tokens, not copied mockup CSS.
- No server changes, schema changes, generic global-state framework, new date library, polling or dependency upgrades.
- Each task uses **RED → GREEN → small commit**; never declare tests/build passing without actually running them.

## File Map

| Path | Responsibility |
| --- | --- |
| `client/src/task/types.ts` (create) | Collection types matching Java `TaskSummaryResponse` |
| `client/src/task/api.ts` (create) | Feature-owned Axios endpoint |
| `client/src/task/useTaskList.ts` (create) | Owner-keyed TanStack Query |
| `client/src/task/useTaskList.test.tsx` (create) | HTTP + query/auth/cache contract |
| `client/src/task/task-view.ts` (create) | Pure lifecycle classification and due-date display |
| `client/src/task/task-view.test.ts` (create) | Local-day, precedence, order and formatting |
| `client/src/task/useLocalDay.ts` (create) | Midnight/visibility/focus day signal |
| `client/src/task/useLocalDay.test.tsx` (create) | Midnight, DST and cleanup tests |
| `client/src/task/TaskRow.tsx` (create) | Inert two-line row presentation |
| `client/src/task/TaskSection.tsx` (create) | Read-only section header, count and rows |
| `client/src/task/TaskRow.test.tsx` (create) | Metadata, semantics, absence of fake controls |
| `client/src/task/TaskWorkspace.tsx` (create) | Auth, query states and grouping composition |
| `client/src/task/TaskWorkspace.test.tsx` (create) | Query integration, empty/error/retry, section visibility |
| `client/src/routes/_authenticated/tasks.tsx` (modify) | Thin route to `TaskWorkspace` |

Do not add files to `shared/` for one-feature behavior. Use existing `client/src/lib/api-client.ts` and `client/src/user/hooks/useCurrentUser.ts` unchanged.

## Review Focus

The following five failure modes each have an owning test below:

1. **Account A → B:** user B must never see A's cached task rows, including while B's response is loading (Task 1 and Task 5).
2. **UTC date differs from browser date:** completion classification must use browser-local year/month/day, not ISO's UTC day (Task 2).
3. **DST / sleeping tab crosses midnight:** section grouping refreshes on the local calendar boundary or tab resumption without another tasks request (Task 3 and Task 5).
4. **Both completed and archived:** task is absent from both visible sections regardless of today's completion timestamp (Task 2 and Task 5).
5. **Request fails after a previous successful render:** error state must hide prior rows, provide Retry and recover on success (Task 5).

---

### Task 1: Typed API contract and authenticated query

**Files:**
- Create: `client/src/task/types.ts`
- Create: `client/src/task/api.ts`
- Create: `client/src/task/useTaskList.ts`
- Test: `client/src/task/useTaskList.test.tsx`

**Interfaces:**
- `export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'`
- `export interface TaskSummary` with the exact 10 response fields in Global Constraints (`id: number`, `priority: TaskPriority | null`, `dueDate: string | null`, timestamps as `string | null` where specified).
- `export interface TaskListResponse { items: TaskSummary[] }`
- `export const taskApi = { list: () => apiClient.get<TaskListResponse>('/tasks') }`
- `export function useTaskList(userId: number | undefined)` returning the TanStack Query result for `TaskListResponse`. Query key is `['tasks', userId]`; `enabled: userId !== undefined`. Do not use `placeholderData` or `keepPreviousData`.

- [ ] **Step 1: Write failing tests** in `useTaskList.test.tsx` using a fresh QueryClient provider per test (disable retries). Assert: Axios shared client sends `GET /tasks` and returns `items`; `useTaskList(undefined)` sends **zero** requests; `useTaskList(1)` sends one request and returns user 1 data; rerender as user 2 produces no user 1 data while pending and eventually shows only user 2; swapping back may use **only** user 1's own cache.
- [ ] **Step 2: Verify RED.** Run `npm run test -- src/task/useTaskList.test.tsx` from `client/`; expect missing-module/test failures.
- [ ] **Step 3: Implement** types, `taskApi.list` through the existing shared Axios instance, and the query hook. Set `queryKey: ['tasks', userId]`; only enable when numeric ID exists; `queryFn` unwraps `response.data`. Never derive owner identity from `TASK-N` and never introduce global cache resets to solve this.
- [ ] **Step 4: Verify GREEN.** Run `npm run test -- src/task/useTaskList.test.tsx`; expect all Task 1 tests passing. Confirm tests use request mocks, not real network.
- [ ] **Step 5: Commit.** `git add client/src/task/types.ts client/src/task/api.ts client/src/task/useTaskList.ts client/src/task/useTaskList.test.tsx && git commit -m "feat(tasks): add owner-scoped list query"`

### Task 2: Pure lifecycle grouping and due-date formatting

**Files:**
- Create: `client/src/task/task-view.ts`
- Test: `client/src/task/task-view.test.ts`

**Interfaces:**
- `export interface TaskSections { active: TaskSummary[]; completed: TaskSummary[] }`
- `export function classifyTasks(tasks: readonly TaskSummary[], now: Date): TaskSections`
- `export function formatTaskDueDate(dueDate: string, now: Date): string` (UI copy `Today` when same local day; otherwise localized `en-US` abbreviated month + numeric day, e.g. `Oct 24`).

- [ ] **Step 1: Write failing tests.** With explicitly constructed TaskSummary fixtures, assert (a) incomplete non-archived → Active; (b) completed today → Completed; (c) completed yesterday/older → neither; (d) archived, including archived+completed-today → neither; (e) `inbox: true` remains included; (f) input order is preserved inside groups; (g) no mutation of original data. Test local-calendar behavior with `completedAt` values containing offsets where UTC and local dates differ. Test invalid completion timestamp is not categorized as today.
- [ ] **Step 2: Verify RED.** `npm run test -- src/task/task-view.test.ts`.
- [ ] **Step 3: Implement** a single iteration over summaries; check `archivedAt` first, then `completedAt`; compare `new Date(completedAt).getFullYear()/getMonth()/getDate()` with `now` local getters and reject invalid dates. Don't filter on `inbox`; deleted tasks are filtered by the API.
- [ ] **Step 4: Add due-date test cases** for `null` omission handled at caller; `'2026-10-24'` rendered as `Oct 24` on other days and `Today` on the same local date. Crucially test `'2026-01-01'` near UTC/local date boundaries without using `new Date('2026-01-01')` to format it; parse year/month/day as a civil date.
- [ ] **Step 5: Verify GREEN** with `npm run test -- src/task/task-view.test.ts`, then commit: `git add client/src/task/task-view.ts client/src/task/task-view.test.ts && git commit -m "feat(tasks): derive task list sections from lifecycle facts"`

### Task 3: Browser-local midnight and tab-resume signal

**Files:**
- Create: `client/src/task/useLocalDay.ts`
- Test: `client/src/task/useLocalDay.test.tsx`

**Interface:**
- `export function useLocalDay(): Date` returns a current browser-local day reference for both classification and `Today` due labels.

- [ ] **Step 1: Write failing hook tests.** Start a fake clock at local `2026-10-18 23:59:50` using `new Date(2026, 9, 18, 23, 59, 50)`. Advance past local midnight and assert the returned date's local day changes; advance again and assert next day also works. Assert focus and `visibilitychange` recover a missed day change. Assert all timers and event listeners clean up on unmount; restore real timers in `afterEach` or `try/finally` even on assertion failure.
- [ ] **Step 2: Verify RED.** `npm run test -- src/task/useLocalDay.test.tsx`.
- [ ] **Step 3: Implement** `useLocalDay` with React state and effect: calculate next local midnight via `new Date(year, month, day + 1)`, timeout until then, refresh the day and reschedule; refresh on window `focus` and document `visibilitychange` when visible; cancel timeout and remove listeners on effect cleanup. Do **not** add a 24-hour interval or task-query refetch.
- [ ] **Step 4: Verify DST expectations.** Run the focused hook/date tests under `TZ=America/New_York` and `TZ=Asia/Kolkata`: `TZ=America/New_York npm run test -- src/task/useLocalDay.test.tsx src/task/task-view.test.ts` and `TZ=Asia/Kolkata npm run test -- src/task/useLocalDay.test.tsx src/task/task-view.test.ts`. Include a fake-clock transition around a US DST weekend to prove the schedule uses calendar midnight, not `86_400_000` ms.
- [ ] **Step 5: Verify GREEN** and commit: `git add client/src/task/useLocalDay.ts client/src/task/useLocalDay.test.tsx && git commit -m "feat(tasks): refresh local calendar day without polling"`

### Task 4: Read-only task rows and sections

**Files:**
- Create: `client/src/task/TaskRow.tsx`
- Create: `client/src/task/TaskSection.tsx`
- Test: `client/src/task/TaskRow.test.tsx`

**Interfaces:**
- `export function TaskRow({ task, now, completed }: { task: TaskSummary; now: Date; completed: boolean })`
- `export function TaskSection({ title, tasks, now }: { title: 'Active' | 'Completed'; tasks: readonly TaskSummary[]; now: Date })`. Title decides the row's completed visual treatment. The caller controls whether Completed renders at all.

- [ ] **Step 1: Write failing RTL tests** asserting two-line row title, literal `TASK-7` reference, optional Priority badge (`Critical`, `High`, `Medium`, `Low`, with Critical using neutral primary emphasis), calendar icon and due date only when present. Assert no description, empty badge, tags or attachments. Assert a completed row is visually muted/struck through; active is not.
- [ ] **Step 2: Test accessible inert semantics.** No buttons, links, checkbox inputs, menu affordances, `role="button"`, fake disabled controls or `onClick` on rows or section headers. Section headings and counts are text; list items have stable React keys from numeric `task.id`. An empty Active section displays exact `No active tasks.`.
- [ ] **Step 3: Verify RED.** `npm run test -- src/task/TaskRow.test.tsx`.
- [ ] **Step 4: Implement** focused presentational components and approved desktop spacing/borders from `screenshots/01-list.jpg`. Reuse Tailwind tokens `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted` and Lucide `Calendar`. Keep noninteractive reserved spacing minimal and `aria-hidden`, but draw **no** fake checkbox/menu glyphs. Do not copy HTML/CSS from `mockup.js` or edit shared shadcn primitives.
- [ ] **Step 5: Verify GREEN** with `npm run test -- src/task/TaskRow.test.tsx`; commit: `git add client/src/task/TaskRow.tsx client/src/task/TaskSection.tsx client/src/task/TaskRow.test.tsx && git commit -m "feat(tasks): render read-only task sections"`

### Task 5: Authenticated workspace, route and all UI states

**Files:**
- Create: `client/src/task/TaskWorkspace.tsx`
- Test: `client/src/task/TaskWorkspace.test.tsx`
- Modify: `client/src/routes/_authenticated/tasks.tsx`

**Interface:**
- `export function TaskWorkspace()`; `Route` in `tasks.tsx` uses `component: TaskWorkspace`.

- [ ] **Step 1: Write failing integration tests** using fresh QueryClient providers, `useCurrentUser` mocking only at the auth boundary, and mocked `taskApi.list`. Assert heading/subtitle; initial loading has no mock/empty/other-account rows; success classifies Active + positive Completed and hides archived/older/deleted (deleted absent in API fixture); empty response displays Active/`No active tasks.` and omits Completed; archived-only/historical-only responses behave the same.
- [ ] **Step 2: Add failure and cache tests.** Reject Task API request; assert explanatory `role="alert"`, visible `Retry` button and **no** old rows. Click Retry after arranging a success and assert rows appear. Change mocked current user from ID 1 to ID 2 with user 2's fetch pending: assert ID 1's rows disappear immediately. When `useCurrentUser` is pending, errored or yields no user, assert **no Task API call** and **no task content**.
- [ ] **Step 3: Add rollover integration test.** Initially show one completion late on the local 18th; fake timer crosses midnight into the 19th; Completed section disappears while Active remains and task API call count stays at **one**. Add focus/visibility resume coverage and restore fake timers in guaranteed cleanup. Confirm no Add Task / completion / archive / sort / history controls have been accidentally introduced.
- [ ] **Step 4: Verify RED.** `npm run test -- src/task/TaskWorkspace.test.tsx`.
- [ ] **Step 5: Implement** `TaskWorkspace` composition: call `useCurrentUser`, then `useTaskList(user?.id)` unconditionally as a hook; gate rendering when auth unresolved/error/empty; show heading/subtitle inside `AppShell`'s existing outlet; show query pending state before sections; on `isError` (even if stale data exists) show error + `Retry` calling `refetch()`; otherwise classify `data.items` against `useLocalDay()` and display Active plus nonempty Completed. Replace route placeholder with an import of `TaskWorkspace`; leave `_authenticated.tsx` and shell unchanged.
- [ ] **Step 6: Verify GREEN.** `npm run test -- src/task/TaskWorkspace.test.tsx` and `npm run test -- src/task`; then commit: `git add client/src/task/TaskWorkspace.tsx client/src/task/TaskWorkspace.test.tsx client/src/routes/_authenticated/tasks.tsx && git commit -m "feat(tasks): integrate authenticated task workspace"`

## Final verification and review gate

- [ ] Inspect `git diff master...HEAD` and compare **each** section of the approved design spec with the Task 1–5 test evidence. Do not expand beyond issue #17.
- [ ] Run from `client/`: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build`. If TanStack Router needs regenerated routing types, use the documented `npx @tanstack/router-cli generate`; do not hand-edit `routeTree.gen.ts`.
- [ ] Open real authenticated `/tasks` with backend available. Check API data (not mocks), zero tasks, a task with priority/due date, a task completed today, older completed and archived tasks. Inspect light **and** dark themes against approved `screenshots/01-list.jpg`; verify no misleading UI controls. If manual backend fixtures cannot be created, explicitly report which scenarios were not manually exercised and rely on automated tests for those cases.
- [ ] Report command exit codes, test counts, any deviation from approved spec, and manual verification evidence. Run final review before PR. No unverified “all green” claims.
- [ ] Open a PR for **issue #17** only after code is implemented and checked. Reference the approved spec and this plan; leave #18/#19/#21/#23/#25/#26 behaviors to their owners.

**Stop at plan review:** This plan is an execution handoff for Luna. Writing/approving it does not authorize feature-code implementation, merging or changes to future-story scopes.
