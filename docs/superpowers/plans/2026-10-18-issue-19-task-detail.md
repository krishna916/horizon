# Issue #19 — Task Detail Panel and Canonical Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Let users view a task beside the Tasks list in an accessible, resizable panel or directly at its canonical full-page URL, with correct history and private read-only data.

**Architecture:** Keep read-only task detail and view-specific chrome under `client/src/task`. Use an index + child dynamic route under a Tasks parent layout so the parent owns ephemeral split-width state across panel→page→panel navigation. TanStack Router owns URL selection/history; TanStack Query owns user-scoped server data. Reuse production AppShell and the existing backend GET endpoint.

**Tech Stack:** React 19, TypeScript 6, TanStack Router 1.x, TanStack Query 5, Tailwind 4, Radix UI already installed, Axios, Vitest/React Testing Library, Playwright Chromium. No new backend migrations, endpoints, global store or runtime packages.

**Spec:** `docs/superpowers/specs/2026-10-18-issue-19-task-detail-design.md` (approved 2026-10-18). Also read `docs/design/tasks-workspace/DESIGN-SPEC.md` and its screenshots, PRD-004 Tasks, the Horizon Constitution, and ENG-002. Issue: https://github.com/krishna916/horizon/issues/19.

## Global Constraints

- Keep existing `client/src/task` feature boundary, `/_authenticated` file-based routing, and existing `client/src/index.css` semantic theme. Do not copy standalone mockup mechanics.
- Canonical route `/tasks/{id}` uses positive safe integer database ID; readable `TASK-N` is display only. Panel URL is `/tasks?task={id}`.
- Initial split is **60% list / 40% detail** across actual Tasks workspace after sidebar; **480px list minimum**, **360px detail minimum**, **5px divider**; **845px** workspace threshold switches to modal right-hand overlay.
- Keyboard separator ArrowLeft/ArrowRight modifies the requested list ratio by **2 percentage points**, clamped to pixel bounds; pointer dragging must release/cancel correctly.
- Remember split ratio only during the mounted Tasks route visit (including child-page navigation), not after leaving Tasks or reloading; no browser storage.
- Opening first panel **pushes**; switching selected tasks **replaces**; Close returns to prior list entry when explicitly known, and otherwise safely replaces URL to `/tasks`. Panel→page→Back restores selection and ratio. Never trust history length alone.
- Preserve an explicit origin in TanStack Router location state; initially Tasks-origin only, with a narrowly extensible representation for future entry points.
- Display only real production fields; plain-text safe JSON description, no `dangerouslySetInnerHTML`, rich-text renderer, fake section or nonfunctional archive/delete controls. Existing future issue owners: #18 create, #20 field edits, #23 lifecycle, #24 rich text.
- Keep current-user isolation, owner-scoped detail fetch, generic indistinguishable 404 and retryable transient errors. No stale cross-task or cross-user details.
- Native or mocked backend testing uses existing test tools. No unrelated refactor. Every task follows red → green → review → commit. Each commit runs relevant focused tests.
- For source edits, avoid touching `client/src/routeTree.gen.ts` by hand; regenerate using the existing TanStack Router Vite plugin and ensure generated changes are captured in the implementation commit.

## Review Focus

These edge classes must be covered by the owning tests below, rather than left as reviewer guesses:

1. **Direct/refresh URL with no trusted navigation state:** both panel and page render; Close/Back never escapes to an unrelated prior website (Tasks 3, 4, 8).
2. **Malformed/unsafe IDs and another user's ID:** no invalid GET; valid but unavailable returns the same safe generic 404 UI, never leaks prior data (Tasks 1, 5, 8).
3. **Fast task switch or session revalidation:** old query response cannot paint the new task or a previous user's task (Tasks 1, 5).
4. **845/844px and mid-drag viewport transitions:** exact boundary is usable, no negative width/overflow; mouse or pointer cancellation cannot leave a stuck drag (Tasks 6, 7).
5. **Modal keyboard/accessibility transitions:** Escape/backdrop/Close dismiss only once; trap focus while open; restore focus safely if originating row was removed (Task 7).

---

## File map and dependency order

`client/src/task/types.ts`, `api.ts`, `useTaskDetail.ts` — typed existing GET and user/ID-scoped cache.

`client/src/task/taskDescriptionText.ts`, `TaskDetailView.tsx` — pure safe description extraction and a reusable read-only detail renderer.

`client/src/task/TasksRouteLayout.tsx`, `taskNavigation.ts` — route-scoped ratio state, validated panel selection and trustworthy origin markers.

`client/src/routes/_authenticated/tasks.tsx` — changes from leaf Tasks view to parent `Outlet`; `tasks.index.tsx` — index view and validated `?task=` search; `tasks.$id.tsx` — numeric canonical page. Preserve `/tasks` behavior (including trailing-slash matching) in router tests.

`client/src/task/TasksListPage.tsx` — TanStack Router adapter supplying selection/navigation callbacks to `TaskWorkspace`; `TaskWorkspace.tsx`, `TaskSection.tsx`, `TaskRow.tsx` — existing list and accessible row selection.

`client/src/task/TaskDetailSurface.tsx`, `TaskPanelShell.tsx` — owner-scoped data/loading/unavailable/retry and presentational panel chrome.

`client/src/task/TaskSplitView.tsx` — measured workspace geometry and resizable split.

`client/src/task/TaskOverlay.tsx` — modal narrow-window fallback using existing Radix primitives.

`client/src/task/TaskDetailPage.tsx` — canonical wrapper, origin-sensitive Back, 740px single column; `client/src/app/layout/AppHeader.tsx` — recognizes the canonical task path as Tasks.

`client/e2e/task-detail.spec.ts` — API-mocked browser flows. Extend existing tests adjacent to changed components; do not rewrite unrelated tests.

### Task 1: Task detail API, types and account-isolated query

**Files:**
- Modify: `client/src/task/types.ts`
- Modify: `client/src/task/api.ts`
- Create: `client/src/task/useTaskDetail.ts`
- Create: `client/src/task/useTaskDetail.test.tsx`

**Interfaces:**
- `TaskDetail extends TaskSummary` with `description: Record<string, unknown> | null` and `deletedAt: string | null`; use the backend's existing fields, do not invent checklist/tags.
- `taskApi.get(id: number): Promise<AxiosResponse<TaskDetail>>` calls GET `/tasks/{id}`.
- `useTaskDetail(userId: number | undefined, taskId: number | null): UseQueryResult<TaskDetail, Error>`; query key `['tasks', userId, 'detail', taskId]`, enabled only for valid owner and task ID; preserve existing list query key `['tasks', userId]`.

- [ ] **Step 1 — Write failing tests.** In `useTaskDetail.test.tsx` assert GET `/tasks/7`, disabled queries for missing user/null/invalid IDs, separate caches for (user 1, task 7), (user 2, task 7) and (user 1, task 8), and that task 7's delayed response never populates the selected task 8 result. Use existing `createWrapper()`/`apiClient.get` spy style from `useTaskList.test.tsx`. Assert exact DTO fields including null description and null deletedAt.
- [ ] **Step 2 — Verify red.** From `client/` run `npm run test -- src/task/useTaskDetail.test.tsx`. Expect missing `get`/`useTaskDetail` and/or missing type failures.
- [ ] **Step 3 — Implement only the interfaces above.** Follow `useTaskList.ts` conventions; return `response.data`. No fallback previous-data rendering, no client owner ID in the GET URL, no list fetch for detail. If enabled is false, do not invoke `taskApi.get`. Avoid retries on known 404 in later boundary handling.
- [ ] **Step 4 — Verify green.** Run `npm run test -- src/task/useTaskDetail.test.tsx src/task/useTaskList.test.tsx`, then `npm run typecheck`; expect PASS.
- [ ] **Step 5 — Commit.** `git add client/src/task/types.ts client/src/task/api.ts client/src/task/useTaskDetail.ts client/src/task/useTaskDetail.test.tsx && git commit -m "feat(tasks): add account-scoped task detail query"`.

### Task 2: Safe description text and shared read-only detail view

**Files:**
- Create: `client/src/task/taskDescriptionText.ts`
- Create: `client/src/task/taskDescriptionText.test.ts`
- Create: `client/src/task/TaskDetailView.tsx`
- Create: `client/src/task/TaskDetailView.test.tsx`

**Interfaces:**
- `getTaskDescriptionText(document: Record<string, unknown> | null): string | null`.
- `TaskDetailView({ task }: { readonly task: TaskDetail }): React.JSX.Element`; render title, description if nonempty, priority and due-date metadata, using live design tokens. No action handlers in this pure view.

- [ ] **Step 1 — Write failing tests.** Assert `getTaskDescriptionText(null) === null`; empty `doc` becomes null; `doc` with paragraph/text nodes becomes plain text and preserves paragraph/hardBreak separation; nested lists/unknown wrappers preserve child text in order; a text node containing `<script>alert(1)</script>` remains literal text, never markup; unrelated attributes (`href`, node labels) never become visible text. In `TaskDetailView.test.tsx` assert present title, description, optional priority/dueDate, and **no** checklist/tags/attachments/activity sections or archive/delete/edit buttons. Assert renderer uses no HTML injection and creates no clickable links from stored document.
- [ ] **Step 2 — Verify red.** Run `npm run test -- src/task/taskDescriptionText.test.ts src/task/TaskDetailView.test.tsx`; expect missing module/component failure.
- [ ] **Step 3 — Implement.** Walk JSON nodes defensively (arrays, objects, cycles not expected from parsed JSON; ignore scalar fields other than recognized `type: 'text'` + `text`). Add newlines around block content and `hardBreak`, collapse excessive separators and trim; render through normal React text nodes with preserved whitespace styling. The `TaskDetailView` is presentation only; display metadata even when one optional value is absent using honest absent labels or omission, never fabricated data.
- [ ] **Step 4 — Verify green.** Run focused tests and `npm run typecheck`.
- [ ] **Step 5 — Commit.** `git add client/src/task/taskDescriptionText* client/src/task/TaskDetailView* && git commit -m "feat(tasks): render safe read-only task details"`.

### Task 3: Parent Tasks route, validated selection and temporary ratio ownership

**Files:**
- Create: `client/src/task/taskNavigation.ts`
- Create: `client/src/task/taskNavigation.test.ts`
- Create: `client/src/task/TasksRouteLayout.tsx`
- Create: `client/src/task/TasksRouteLayout.test.tsx`
- Modify: `client/src/routes/_authenticated/tasks.tsx`
- Create: `client/src/routes/_authenticated/tasks.index.tsx`
- Generated: `client/src/routeTree.gen.ts` (regenerated, never handwritten)

**Interfaces:**
- `type TaskSelection = { kind: 'none' } | { kind: 'valid'; id: number } | { kind: 'invalid' }`.
- `parseTaskSelection(raw: unknown): TaskSelection`. Positive `Number.isSafeInteger` only; reject 0, negatives, decimals, exponent/unsafe/unparsable values; ordinary positive digit strings supported.
- `type HorizonTaskNavigationState = { kind: 'panel-from-list' | 'page-from-panel'; taskId: number }` stored as optional `horizonTaskNavigation` on TanStack Router `HistoryState` via module augmentation, not browser-global mutable state.
- `useTasksLayout(): { listRatio: number; setListRatio: (nextRatio: number) => void }` exported from `TasksRouteLayout.tsx`; initial `listRatio=60`.
- Parent `createFileRoute('/_authenticated/tasks')` renders `TasksRouteLayout` with `<Outlet />`; index `createFileRoute('/_authenticated/tasks/')` renders existing `TaskWorkspace` at this stage. Index route `validateSearch` keeps optional raw `task` as a string so invalid IDs reach a safe unavailable state rather than crashing parsing.

- [ ] **Step 1 — Write failing tests.** `taskNavigation.test.ts` covers none/valid/invalid inputs including `'123'`, `'0'`, `'-1'`, `'1.5'`, `'1e3'`, `'9007199254740993'`, `'abc'` and missing. `TasksRouteLayout.test.tsx` uses a TanStack memory router to assert Tasks index at `/tasks` and `/tasks?task=123`, parent renders nested Tasks index, ratio starts at 60, and updates (e.g., 67) persist across index rerenders but reset after leaving Tasks and remounting. Test the full-page child-route round trip after that route exists in Task 8. Start with existing test wrappers; do not mock the core Router for these tests.
- [ ] **Step 2 — Verify red.** Run `npm run test -- src/task/taskNavigation.test.ts src/task/TasksRouteLayout.test.tsx`; expect missing modules/route failures.
- [ ] **Step 3 — Implement parent route and parsed search.** Confirm that nested index navigation preserves existing `/tasks` sidebar links without redirect loops, including trailing slash handling. The parent must own only ephemeral ratio, not task detail data. Use TanStack Router's documented `HistoryState` augmentation; do not edit generated route tree manually. Run the existing Vite/TanStack router generator through `npm run build` or existing project pipeline and inspect generated diff.
- [ ] **Step 4 — Verify green.** Run focused tests, `npm run typecheck` and `npm run build`. Run existing `TaskWorkspace.test.tsx` to ensure list-only mode still works.
- [ ] **Step 5 — Commit.** `git add client/src/task/taskNavigation* client/src/task/TasksRouteLayout* client/src/routes/_authenticated/tasks.tsx client/src/routes/_authenticated/tasks.index.tsx client/src/routeTree.gen.ts && git commit -m "feat(tasks): add route-scoped task workspace layout"`.

### Task 4: Accessible task selection and single-entry panel URL history

**Files:**
- Create: `client/src/task/TasksListPage.tsx`
- Create: `client/src/task/TasksListPage.test.tsx`
- Modify: `client/src/routes/_authenticated/tasks.index.tsx`
- Modify: `client/src/task/TaskWorkspace.tsx`
- Modify: `client/src/task/TaskSection.tsx`
- Modify: `client/src/task/TaskRow.tsx`
- Modify: `client/src/task/TaskRow.test.tsx`
- Modify: `client/src/task/TaskWorkspace.test.tsx`
- Modify: `client/src/task/TaskSessionBoundary.test.tsx`

**Interfaces:**
- `TaskRow` adds `onOpen: (taskId: number) => void` and `selected: boolean`; `TaskSection` passes these as appropriate. Each row has a semantic task-opening button with title and key text (both open the same task) and `aria-current`/selected styling as appropriate. No clickable `li` trapping future completion/menu controls.
- `TaskWorkspace` adds props `{ selection: TaskSelection; onSelectTask: (id: number) => void; onClosePanel: () => void; onOpenFullPage: (id: number) => void }`. The original list-load/classification behavior remains.
- `TasksListPage` is the route adapter: derives selection from index search, passes callbacks to workspace and handles pushes/replaces. Initial selection pushes `?task=id` and sets `horizonTaskNavigation: {kind:'panel-from-list',taskId:id}`. Switching selected IDs replaces the current panel history entry and retains origin marker. A panel opened directly with no trusted marker closes via `replace: true` to clean `/tasks`. Trusted list-origin closes via router history back.
- Keep disabled/deferred functionality absent; row opener must be independent from future completion/menu buttons.

- [ ] **Step 1 — Write failing tests.** Update obsolete #17 tests that assert no button anywhere on a populated list, replacing them with checks for **exactly the appropriate task-opening control** and no fake completion/menu buttons. Assert mouse click and Enter/Space activate the selected task once; clicking title or key (inside the semantic opener) works; selected row is visibly marked; keyboard focus visible. Memory-router test: list `/tasks` → click task 1 → `/tasks?task=1` push → click task 2 → `/tasks?task=2` replace → Back → `/tasks`, Forward reopens task 2. Direct `/tasks?task=1` loaded with no marker must preserve the untrusted-origin state (its visible Close control and fallback are exercised in Task 5); invalid search results in an invalid selection without GET. Preserve task grouping and session-boundary assertions.
- [ ] **Step 2 — Verify red.** Run `npm run test -- src/task/TaskRow.test.tsx src/task/TasksListPage.test.tsx src/task/TaskWorkspace.test.tsx src/task/TaskSessionBoundary.test.tsx`; expect newly specified interactions to fail.
- [ ] **Step 3 — Implement semantic opener and adapter.** Keep title wrapping and metadata order approved in #17. Use a semantic button rather than attaching broad bubbling `onClick` to `li`; future completion/menu elements must be siblings, not nested controls. Wire parent selection through `TaskSection`. Add temporary panel selection semantics, but do not create deceptive action icons or form controls. Use documented TanStack navigation `replace` and history APIs and explicit origin marker.
- [ ] **Step 4 — Verify green.** Run the four focused tests, `npm run typecheck` and `npm run lint`.
- [ ] **Step 5 — Commit.** `git add client/src/task client/src/routes/_authenticated/tasks.index.tsx && git commit -m "feat(tasks): open task details through URL-backed selection"`.

### Task 5: Real read-only detail boundary and reusable panel shell

**Files:**
- Create: `client/src/task/TaskDetailSurface.tsx`
- Create: `client/src/task/TaskDetailSurface.test.tsx`
- Create: `client/src/task/TaskPanelShell.tsx`
- Create: `client/src/task/TaskPanelShell.test.tsx`
- Modify: `client/src/task/TaskWorkspace.tsx`
- Modify: `client/src/task/TaskWorkspace.test.tsx`
- Modify: `client/src/task/TaskSessionBoundary.test.tsx`

**Interfaces:**
- `TaskDetailSurface({ taskId, surface, onClose, onOpenFullPage }: { taskId: number | null; surface: 'panel' | 'page'; onClose?: () => void; onOpenFullPage?: () => void }): React.JSX.Element`. It owns useCurrentUser/useTaskDetail and renders TaskDetailView, pending/errors, and surface-specific working controls.
- `TaskPanelShell({ children }: { children: React.ReactNode }): React.JSX.Element`. A presentational panel region/chrome that can later wrap #18's create form; #19 renders only detail content. Header actions live with TaskDetailSurface and are conditional on real callbacks.
- `TaskWorkspace` renders the detail region only for `selection.kind === 'valid'`; for `invalid` it renders the same generic unavailable state, with working Close. For no selection, list only.

- [ ] **Step 1 — Write failing tests.** Surface shows loading while GET pending, server-reported task key in header, shared TaskDetailView title/body, working Open full page and Close callbacks; absent archive/restore/delete/edit buttons. 404/other-owner/deleted ID shows generic unavailable message, never old task title. Network or 5xx shows retry and preserves list content; retry invokes query refetch. Bad/nonpositive IDs make no request. Session pending/re-fetch/error hides current and cached details. Rapid selection 7→8 with delayed 7 response displays only 8; user 1→user 2 does not reveal user 1's cached detail even if task ID matches.
- [ ] **Step 2 — Verify red.** Run `npm run test -- src/task/TaskDetailSurface.test.tsx src/task/TaskPanelShell.test.tsx src/task/TaskWorkspace.test.tsx src/task/TaskSessionBoundary.test.tsx`.
- [ ] **Step 3 — Implement.** Use `taskApi.get`/`useTaskDetail` from Task 1 and `TaskDetailView` from Task 2. Gate rendering by current-user verification. Treat Axios `404` separately from retryable failures via `isAxiosError`. Remove old visible content immediately on selection/user change (no `placeholderData` from prior selection). Use user and id query keys; no global detail store. In panel, key and functional full-page/close controls in the top header; any reserved lifecycle slot is **not rendered as a button**. Keep details read-only.
- [ ] **Step 4 — Verify green.** Run focused tests, `npm run typecheck` and `npm run lint`.
- [ ] **Step 5 — Commit.** `git add client/src/task && git commit -m "feat(tasks): add reusable private task detail surface"`.

### Task 6: Measured 60/40 split with keyboard and pointer resizing

**Files:**
- Create: `client/src/task/TaskSplitView.tsx`
- Create: `client/src/task/TaskSplitView.test.tsx`
- Modify: `client/src/task/TaskWorkspace.tsx`
- Modify: `client/src/task/TaskWorkspace.test.tsx`

**Interfaces:**
- `TaskSplitView({ list, detail, isOpen, listRatio, onListRatioChange }: { list: React.ReactNode; detail: React.ReactNode; isOpen: boolean; listRatio: number; onListRatioChange: (ratio: number) => void }): React.JSX.Element`.
- Layout math: `SPLITTER_PX = 5`, `LIST_MIN_PX = 480`, `DETAIL_MIN_PX = 360`, `OVERLAY_BELOW_PX = 845`, `DEFAULT_LIST_PERCENT = 60`. With available `W >= 845`, use `inner = W - 5`, `listPx = clamp(inner * listRatio / 100, 480, inner - 360)`; detail width `inner - listPx`. Convert dragged listPx back to percent relative to `inner`. Do not overwrite last requested ratio merely because viewport briefly shrinks.
- `ResizeObserver` observes **Tasks workspace content**, excluding existing 256px sidebar; modal choice deferred to Task 7 but threshold reported by split view. Keep presentation compatible with the current AppContent scroll container and existing list-only max-width.

- [ ] **Step 1 — Write failing tests.** Stub ResizeObserver for exact widths 1024, 845 and 844; at 1024 list/details approximately 60/40 of 1019px inner; at 845 list 480px, detail 360px; at 844 report overlay threshold rather than rendering impossible split. Verify title/list content does not get trapped in `max-w-5xl` for split width. Role separator is keyboard focusable with accessible name/orientation, `aria-valuenow`, min and max, left decreases and right increases by 2 percentage points where allowed, no movement beyond pixel min bounds. Pointer drag computes from workspace-relative X (not viewport X); pointer up/cancel stops drag; resizing workspace reclamps but preserves requested stored ratio.
- [ ] **Step 2 — Verify red.** Run `npm run test -- src/task/TaskSplitView.test.tsx src/task/TaskWorkspace.test.tsx`; expect missing splitter behavior.
- [ ] **Step 3 — Implement.** Use `ResizeObserver` and pointer capture with release/cancel cleanup. Provide visible keyboard focus and a usable narrow hit target for the separator even though layout divider occupies 5px. Split mode scrolls list and panel independently; list-only mode keeps centered approved layout. Wire `listRatio/setListRatio` from TasksRouteLayout. Avoid global window resize handler for computed width.
- [ ] **Step 4 — Verify green.** Focused tests + `npm run typecheck`. Validate no unexpected horizontal overflow at desktop size.
- [ ] **Step 5 — Commit.** `git add client/src/task && git commit -m "feat(tasks): support accessible resizable split layout"`.

### Task 7: Narrow-desktop modal detail overlay

**Files:**
- Create: `client/src/task/TaskOverlay.tsx`
- Create: `client/src/task/TaskOverlay.test.tsx`
- Modify: `client/src/task/TaskSplitView.tsx`
- Modify: `client/src/task/TaskSplitView.test.tsx`
- Modify: `client/src/task/TaskWorkspace.tsx`

**Interfaces:**
- `TaskOverlay({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }): React.JSX.Element`. Uses existing installed Radix Dialog primitive; not a new dependency. Drawer is modal and anchored to right side, capped at available workspace/viewport width.
- At measured workspace width **<845px**, TaskSplitView renders TaskOverlay for details and hides splitter. At **>=845px**, it renders split. No stored ratio mutation on mode change.

- [ ] **Step 1 — Write failing tests.** At 844px (and a substantially narrower width), selected details appear in a modal right-side dialog; list remains rendered but inaccessible/inert behind modal; splitter absent. Escape, backdrop and Close each invoke onClose once; tab focus stays inside; on dismissal keyboard focus returns to task-open trigger or fallback list heading when the original trigger is gone; vertical scrolling works and no horizontal overflow. At 845px, overlay is absent and splitter present. Resizing across threshold while task selected preserves requested ratio when returning to wide mode.
- [ ] **Step 2 — Verify red.** `npm run test -- src/task/TaskOverlay.test.tsx src/task/TaskSplitView.test.tsx`. Expect initial failures.
- [ ] **Step 3 — Implement modal overlay.** Reuse already-installed Radix primitives; respond to its controlled open/close callback and prevent duplicate navigation on combined events. Place backdrop over Tasks workspace appropriately; keep focus restoration robust when row disappears. Do not invent mobile-specific variant. The overlay uses the same TaskDetailSurface instance/content contract as the split view; resizing controls do not show.
- [ ] **Step 4 — Verify green.** Focused tests + `npm run typecheck` and `npm run lint`.
- [ ] **Step 5 — Commit.** `git add client/src/task && git commit -m "feat(tasks): add accessible narrow-workspace detail drawer"`.

### Task 8: Canonical full page and origin-sensitive Back behavior

**Files:**
- Create: `client/src/task/TaskDetailPage.tsx`
- Create: `client/src/task/TaskDetailPage.test.tsx`
- Create: `client/src/routes/_authenticated/tasks.$id.tsx`
- Modify: `client/src/task/TasksListPage.tsx`
- Modify: `client/src/task/TasksListPage.test.tsx`
- Modify: `client/src/app/layout/AppHeader.tsx`
- Modify: `client/src/app/layout/AppShell.test.tsx`
- Generated: `client/src/routeTree.gen.ts`

**Interfaces:**
- `TaskDetailPage({ rawId, onBack }: { rawId: string; onBack: () => void }): React.JSX.Element` uses `parseTaskSelection(rawId)` and TaskDetailSurface in page mode, wraps content with existing approved single-column **max-width 740px**, and renders working `Back to Tasks`.
- Child route `createFileRoute('/_authenticated/tasks/$id')` obtains `Route.useParams().id` and supplies origin-sensitive Back handler. When the page's explicit `horizonTaskNavigation.kind === 'page-from-panel'` matches ID and trusted route context, call router history Back to the selected panel entry; otherwise navigate/rewrite safely to `/tasks`. The panel's full-page handler pushes numeric URL and marks `page-from-panel`.
- `AppHeader` recognizes `/tasks` and descendant `/tasks/{id}` as Tasks without falsely classifying unrelated paths such as `/tasks-extra`.

- [ ] **Step 1 — Write failing tests.** Real memory router: select task 7 from list → open full page → URL `/tasks/7` → same title/key/metadata/description → Back to Tasks returns `/tasks?task=7` and retained route-level split ratio. Browser Back/Forward round-trip also works. Deep load `/tasks/7` with no state → Back to Tasks goes to `/tasks` rather than another origin; reload with 7 fetches correctly; `/tasks/TASK-7`, `/tasks/0`, `/tasks/-1`, `/tasks/9007199254740993` do not call API and show unavailable state; numeric other-user 404 is generic. Test header displays Tasks on child route.
- [ ] **Step 2 — Verify red.** `npm run test -- src/task/TaskDetailPage.test.tsx src/task/TasksListPage.test.tsx src/app/layout/AppShell.test.tsx`.
- [ ] **Step 3 — Implement page and route.** Canonical route fetches same account-scoped detail query as panel, does not render second copy of content or unimplemented header controls. Use parent TasksRouteLayout for width persistence; don't special-case task IDs in AppShell. On direct deep link with unknown origin use safe Tasks fallback; any future external origin must be represented explicitly and validated. Regenerate route tree via existing build pipeline.
- [ ] **Step 4 — Verify green.** Focused router tests, `npm run typecheck`, `npm run build`.
- [ ] **Step 5 — Commit.** `git add client/src/task client/src/routes/_authenticated/'tasks.$id.tsx' client/src/routeTree.gen.ts client/src/app/layout/AppHeader.tsx client/src/app/layout/AppShell.test.tsx && git commit -m "feat(tasks): add canonical task page with context-aware return"`.

### Task 9: Browser flows, regression suite and visual review

**Files:**
- Create: `client/e2e/task-detail.spec.ts`
- Modify (only if needed for actual regressions): `client/src/task/TaskWorkspace.test.tsx`, `TaskSessionBoundary.test.tsx`, `TaskSplitView.test.tsx`, `TaskOverlay.test.tsx`, `TasksListPage.test.tsx`.
- Do not add backend fixtures or modify server code for UI-only E2E coverage.

**Interfaces:** Extend the established `client/e2e/example.spec.ts` Playwright mock-API style. Intercept `**/api/v1/users/me`, `**/api/v1/tasks` and `**/api/v1/tasks/*` with realistic TaskSummary and TaskDetail JSON; keep each test independent.

- [ ] **Step 1 — Write browser tests before any resulting fixes.** At 1280×720 with mocked login: load `/tasks`; open TASK-7 row/key → assert `?task=7`, title and key in details; select TASK-8 → replace behavior; browser Back closes panel and Forward reopens TASK-8; expand canonical page and Back to selected panel; resize via pointer and ArrowLeft/Right and assert computed pane geometry stays >=480/360. At a viewport yielding <845px **workspace** (account for 256px sidebar), assert modal drawer, no separator, Escape/backdrop/Close. Deep open/reload both selection URL and canonical page, verify 404 and retryable 500 separately. Verify no fake archive/delete controls and no rendered injected HTML.
- [ ] **Step 2 — Verify red for any remaining unimplemented browser behavior.** `npm run test:e2e -- task-detail.spec.ts`; diagnose only genuine failures and capture evidence; the tests should have real assertions, not just screenshots.
- [ ] **Step 3 — Apply the smallest fixes needed to make E2E green.** If a bug contradicts the approved spec, fix it in the owning feature component with a matching unit test. Do not broaden issue #19 scope, introduce extra packages, or rewrite UX.
- [ ] **Step 4 — Full validation.** From `client/`: `npm run test`; `npm run test:e2e`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm run build`. All must PASS. Review approved desktop screenshots in `docs/design/tasks-workspace/screenshots/` against actual 1280×720 layout, plus dark/light semantic colors. If formatting check fails, run the existing formatter on changed files only and re-run checks; do not globally reformat repo.
- [ ] **Step 5 — Commit and hand off.** `git add client/e2e/task-detail.spec.ts client/src/task client/src/app/layout client/src/routes/_authenticated client/src/routeTree.gen.ts && git commit -m "test(tasks): cover task detail navigation and resizing"`. Provide Luna's final review report: files/commits, test command results, constraints verified, deviations (if any), and screenshots or E2E traces for failures.

## Mandatory Luna review gates

- **At each task:** Write failing test, see it fail for the expected reason, implement only that task, re-run focused tests, inspect changes, commit. Fresh reviewer checks contracts and tests before moving to the next task when using subagent-driven development.
- **After Tasks 3–4:** Inspect actual TanStack Router generated route hierarchy and browser push/replace/back behavior; do not settle for mocked `navigate` calls alone.
- **After Task 5:** Independently scrutinize user/ID cache isolation, 404 owner privacy and selected-task race conditions.
- **After Tasks 6–7:** Verify geometry and modal focus at the 845/844px boundary; review accessibility of separator and drawer.
- **After Task 8:** Check direct-load, canonical URL and history context across page/list transitions, including reload.
- **Before completion:** Review against the approved spec and PRD-004; ensure no work belonging to #18/#20/#23/#24 or future data sections slipped in. Run all checks from Task 9. User reviews the finished plan and chosen execution method **before** Luna modifies product code.

## Execution handoff

Recommend **subagent-driven-development** for Luna: routing, auth, resizing and modal focus are distinct risk areas and benefit from independent task reviews. This plan is documentation only; do not begin product implementation until the owner approves this implementation plan. At execution, create an isolated worktree using Superpowers guidance.