# PR #85 — Notes Browsing Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution contract:** Luna implements **inline and sequentially**, with **no subagents or worktrees**. This is a supplemental **plan-only** commit; execution begins only on human approval. Work on the **existing** `feature/70-notes-browsing` branch and update **existing PR #85**, not a second PR. Do not merge it.

**Goal:** Fix confirmed PR #85 browse-state/scroll failures, make loaded pages survive a long detail visit, improve bounded preview presentation and test honesty, and reconcile #70's historical issue wording with the user's explicitly approved staged media scope.

**Architecture:** Retain the existing Notes parent provider across *transient same-owner* session verification, but reset it on logout/owner change; preserve the current authenticated shell's privacy overlay. Restore workspace scroll once when the list reappears, independently of page append events. Keep Notes list pages in owner-scoped TanStack Query in-memory cache until session invalidation, forward abort signals to Axios, and make small local preview/CSS/test adjustments. No backend change, no new global state store, and no media/tag integration.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, Axios, Tailwind CSS v4, Vitest, Testing Library, Playwright.

**Spec:** [Original #70 implementation plan](./2026-11-09-notes-browsing.md), [approved #68 design](../../design/notes-workspace/DESIGN-SPEC.md), [PR #85](https://github.com/krishna916/horizon/pull/85), [issue #70](https://github.com/krishna916/horizon/issues/70), and the approved five-point scope decision in [#70 issue discussion](https://github.com/krishna916/horizon/issues/70#issuecomment-6732820755). This plan was evaluated against PR head `d735b3cd50365cac63e3ae085f7e0b71ba77c058`; re-check head and comments before executing.

## Global constraints

- **Priorities:** P1 both unresolved CodeRabbit comments; P2 retain loaded batches, correct long-detail navigation scroll, and improve preview styling; P3 excerpt whitespace, abort propagation, and truthful fixture coverage. Do not add general-purpose infrastructure.
- **Existing user decisions remain locked:** Cards initially; per-owner/per-browser view preference; Active/Archived and `updated_desc/updated_asc/title_asc`; explicit 20-item Load More; collection/sort/loaded pages/scroll are in-memory; links direct to `/notes/{id}`; `/notes/new` is inert until #71; live tags wait for #72; inline images/files wait for #78/#79.
- **#69 API unchanged:** Summary contains a bounded ordered `preview`, **no media or tag metadata**. List query remains `size=20`. Do not invent URLs, blobs, image/file node types, DB fields, or per-card detail requests.
- **Session privacy:** Never show previous-owner data on a verification/error/owner change. `AuthenticatedSessionBoundary` already hides private content while unverified; Notes must preserve its *in-memory state* without bypassing that overlay. `SessionOwnedTree` is keyed on `ownerRevision`; logout and owner change must clear private Notes queries.
- **Cache retention:** Only Notes lists should use `gcTime: Infinity` so loaded pages survive a long **same-owner session**. This is memory-only, not browser storage; private queries are explicitly cleared on logout and owner change. Do not change application-wide cache defaults or re-enable automatic page refetch on return. Keep collection/sort separate query keys.
- **Frontend ownership:** Business UI stays in `client/src/note/`. Only minimal route, shared API/session, and scoped styling changes; TanStack Query remains the source of truth for server data. Follow `client/AGENTS.md`, ENG-002, `.agents/skills/align-context/SKILL.md`, `.agents/skills/testing-frontend/SKILL.md` and `.agents/skills/git-workflow/SKILL.md`.
- **Review feedback:** Treat CodeRabbit comments as hypotheses that have been verified against the cited PR head; re-verify if head changes. Ignore CodeRabbit's **80% docstring quota** as a mandatory blanket task—repository CI and SonarCloud are green. Add focused explanatory comments only for non-obvious lifecycle/caching behavior.
- **Git:** In the existing checkout, ensure `git status --short` is clean; `git fetch origin` → `git switch master` → `git pull --ff-only origin master` → `git switch feature/70-notes-browsing` → incorporate newer `origin/master` safely if necessary. Never discard local work or force-push. No new branch, worktree, subagent, dependency, backend change, or new PR.
- **Handoff:** Keep PR #85 open; commit/push reviewed changes, check every required CI status green, and report unresolved warnings. No merge without human approval.

## Five review risks to prove with tests

1. **Browser focus re-verifies the same account from Archived/List/title sort:** Notes never throws on missing context; private content is hidden until verified; collection/sort/view/scroll survive.
2. **Switch to a different owner or logout during a pending Notes request:** no stale previous-owner text or cache, no prior browse-state reuse, correct new owner preference.
3. **Load More while scrolled deeply:** requesting/receiving page two does not snap scroll to zero or back to a stale saved position.
4. **Read a Note for longer than the default five-minute query garbage-collection period:** Back restores the exact previously loaded 40 items and position, without restarting from the first 20.
5. **Open deep detail/new route from a scrolled Notes list or render adversarial/structured preview:** destination starts at top; Back restores the list; card styling stays bounded and excerpt preserves block separators without executing markup.

---

### Task 1: Keep the Notes provider mounted safely through same-owner verification (P1, CodeRabbit)

**Files**
- Modify: `client/src/routes/_authenticated/notes.tsx`
- Test: create `client/src/routes/_authenticated/notes.test.tsx` **or** a focused authenticated-route integration test adjacent to existing route tests; extend `client/e2e/notes-browsing.spec.ts`.
- Existing context: `client/src/user/session/AuthSessionProvider.tsx`, `client/src/app/layout/AuthenticatedSessionBoundary.tsx`, `client/src/app/SessionOwnedTree.tsx`, `client/src/note/NotesBrowseContext.tsx`.

**Interfaces**
- Keep `NotesBrowseProvider({userId,children})` and `useNotesBrowse()` unchanged.
- Track the **last verified user ID within this route instance** while the session temporarily transitions to `verifying` or `retryable-error`. An initial unverified visit must not render an `Outlet` without a provider. Clear/reset on `unauthenticated` or real owner transition, honoring `SessionOwnedTree`'s `ownerRevision` remount.

- [ ] **Step 1 — write failing integration test:** Start owner 1 verified; select Archived + List + `title_asc` and record scroll; trigger same-owner `verifySession()` with a delayed `/users/me` response. Assert no context exception, private content hidden while verifying, then the previous state restored on success. Repeat via a focus/visibility event and retryable verification failure; do not bypass privacy overlay.
- [ ] **Step 2 — write owner isolation test:** After owner 1 state is populated, verify owner 2 and assert fresh Active/`updated_desc`/Cards (or owner 2's own saved view); after logout ensure no previous-owner view is accessible. When initial phase is `verifying` with no prior verified owner, only the pending/verification state renders—**not** an unprovided Notes index.
- [ ] **Step 3 — verify red:** `cd client && npm run test -- src/routes/_authenticated/notes.test.tsx` (or the exact chosen integration test). The current route returns `<Outlet />` without its provider during verification.
- [ ] **Step 4 — minimal implementation:** Replace the `phase !== 'verified' ? <Outlet/>` branch with a stable last-verified-owner gate. Prefer route-local state and the existing `ownerRevision` remount; avoid modifying `AuthSessionProvider` public contract unless testing proves necessary. Preserve provider under transient verification; never expose an unguarded Outlet. Avoid writing refs during render if React Compiler/lint disallows it.
- [ ] **Step 5 — run green:** targeted route tests plus `cd client && npm run test -- src/user/session/NotesPrivateQueries.test.tsx src/note/NotesBrowseContext.test.tsx`. Confirm no stale data flashes on new-owner transition.
- [ ] **Step 6 — commit:** Commit route plus tests: `git commit -m "Preserve Notes browse provider across session verification"`.

### Task 2: Correct one-time scroll restoration and detail navigation (P1, CodeRabbit + independent review)

**Files**
- Modify: `client/src/note/NotesWorkspacePage.tsx`, `client/src/note/NoteDetailPage.tsx`, `client/src/note/NoteNewPlaceholder.tsx` (or the two associated thin routes if a smaller shared-main-scroll hook is preferable).
- Test: `client/src/note/NotesWorkspacePage.test.tsx`, `client/e2e/notes-browsing.spec.ts`.
- Related: `client/src/app/layout/AppContent.tsx`; the existing scroller is the `main` element.

**Interfaces**
- Preserve `NotesBrowseState.scrollTop` as the snapshot to restore when the index **remounts**, not as a controlled scroll value on every data change.
- Keep `rememberScroll(scrollTop:number):void` intact; no window scroll listeners, localStorage scroll state, or URL state.

- [ ] **Step 1 — failing Load More browser test:** Create a 40-note fixture with a delayed second-page reply. Scroll `main` to a nonzero position; click Load More (allowing the button to scroll into view), capture `main.scrollTop` **after the click but before resolving page two**, then resolve it. Assert the resulting scroll position stays approximately equal to that snapshot, not zero. Also test retry after a next-page error.
- [ ] **Step 2 — failing Back test:** From non-default Archived/List/sort with loaded pages, scroll `main`; open note and assert the detail document begins at `scrollTop≈0`; browser Back and in-app Back both restore the saved list scroll. Repeat for `/notes/new`; a direct detail deep link should start at the top. On changing collection or sort while on the index, start the new result set at the top instead of retaining the prior list's deep scroll.
- [ ] **Step 3 — verify red:** `cd client && npm run test:e2e -- notes-browsing.spec.ts`, targeting the new tests.
- [ ] **Step 4 — implement:** In the workspace, use a per-mount `restoredRef` guard; restore only after successful Notes list data and a real mounted `main` exist, and cache the element in `mainRef` at that point. Capture the actual scroll in the index cleanup after route departure; do not overwrite saved scroll while the shell renders a verification fallback. Remove `query.data` as a repeated restoration trigger. For index-to-detail/new navigation, reset the shared `main` scroll after list cleanup, and leave list state untouched.
- [ ] **Step 5 — run green:** run the added Playwright tests and component tests; verify no regressions when toggling Cards/List, collection, or sort.
- [ ] **Step 6 — commit:** `git commit -m "Restore Notes scroll once and start detail pages at top"`.

### Task 3: Retain loaded pages and cancel obsolete network work (P2/P3)

**Files**
- Modify: `client/src/note/queries.ts`, `client/src/note/api.ts`.
- Test: `client/src/note/queries.test.tsx`, `client/src/note/api.test.ts`, `client/src/user/session/NotesPrivateQueries.test.tsx`.

**Interfaces**
- `noteApi.list(collection:NoteCollection,sort:NoteSort,page:number,size?:number,signal?:AbortSignal)`, `noteApi.get(id:number,signal?:AbortSignal)`; optional signal maintains compatibility with existing direct calls.
- `useNoteList(...)` sends `signal` from TanStack Query to the Axios Notes read; `useNoteDetail(...)` does likewise.
- `useNoteList(...)` uses `gcTime:Infinity` for in-memory same-owner read continuity; maintain `['notes',userId,'list',collection,sort]` keys and the existing explicit private-query purge on logout/owner change. Disable unnecessary remount refetch that would re-request all previously loaded pages merely due to re-entry; subsequent explicit Refresh/Retry and future #71 mutations can invalidate when appropriate.

- [ ] **Step 1 — failing cache retention test:** Mount `useNoteList(1,'active','updated_desc')`, load pages 0 and 1; unmount the observer; advance a fake clock **past five minutes** with guaranteed `vi.useRealTimers()` cleanup; verify cached pages 0 and 1 remain; remount the hook and verify both pages still render without silently falling back to page zero. Confirm sort/collection isolation.
- [ ] **Step 2 — failing cancellation tests:** Assert `AbortSignal` is present in Axios request config for collection and detail; abort the signal or call `queryClient.cancelQueries({queryKey:['notes']})` and verify request cancellation, including old-owner requests during logout/switch. Existing owner-query removal must still work.
- [ ] **Step 3 — verify red:** `cd client && npm run test -- src/note/queries.test.tsx src/note/api.test.ts src/user/session/NotesPrivateQueries.test.tsx`.
- [ ] **Step 4 — implement minimum:** Set `gcTime:Infinity` on **Notes list** queries only, pass queryFn `signal` through `apiClient.get`. Keep `enabled` guards and `retry:false` detail policy. Explicitly explain in a short code comment why session-private list queries remain in memory and when they are cleared. No localStorage persistence and no global QueryClient default change.
- [ ] **Step 5 — run green and commit:** rerun targeted tests; `git commit -m "Retain paginated Notes lists and cancel stale requests"`.

### Task 4: Restore approved preview typography and correct list excerpts (P2/P3)

**Files**
- Modify: `client/src/note/NoteCard.tsx`, `client/src/note/notePreview.tsx`, `client/src/index.css` (**scoped selectors only**).
- Test: `client/src/note/notePreview.test.tsx`, `client/src/note/NoteCard.test.tsx`, `client/src/note/NoteListRow.test.tsx`, `client/e2e/notes-browsing.spec.ts`.

**Interfaces**
- Keep `NotePreview({document,interactiveLinks?})` API; keep safely rendered React nodes (no HTML injection).
- Keep `noteListExcerpt(document:RichTextDocument|null):string` API but place one normalized space between top-level/block-level elements, preserving normal adjacent inline text. Example: two paragraphs `"Plan"` then `"Budget"` return `"Plan Budget"`, not `"PlanBudget"`.
- Existing card height cap `440px`, padding about `21px`, title 18px; preview 16px. Preview cap **240px up to 600px viewport**, **265px from 601px upward**. Keep responsive row-major grid unchanged.

- [ ] **Step 1 — failing excerpt tests:** Check adjacent paragraphs with zero explicit whitespace, heading→paragraph, list items, a hard break, adjacent inline bold/plain spans, code block, a one-line-only excerpt, and null/empty/unsafe documents. Assertions must not introduce duplicate spaces or combine words.
- [ ] **Step 2 — failing preview layout tests:** In browser widths 600 and 601, verify card computed max preview heights 240px and 265px; preview headings don't inherit global 56px heading sizes or large margins; code/list/table content stays readable and clipped within the 440px card; title stays 18px. Check light/dark themes and mobile overflow.
- [ ] **Step 3 — verify red:** targeted Vitest and Playwright tests; current unscoped CSS and same-height preview cap should fail these assertions.
- [ ] **Step 4 — implement:** Use only `.note-preview`-scoped styles or local utility classes to reset inherited heading/margin/layout styles, 16px prose, list indents, safe long-token wrapping and contained tables. Change the preview container's breakpoint-specific max height. Make excerpt extraction insert block separators without scanning outside the already bounded server summary; preserve safe link handling and noninteractive links inside card navigation.
- [ ] **Step 5 — run green and commit:** `cd client && npm run test -- src/note/notePreview.test.tsx src/note/NoteCard.test.tsx src/note/NoteListRow.test.tsx` and relevant browser tests; `git commit -m "Correct Notes preview density and block excerpts"`.

### Task 5: Make media fixture tests honest about current scope (P3, CodeRabbit issue warning)

**Files**
- Modify: `client/src/note/notePreview.test.tsx`, `client/src/note/NoteCard.test.tsx`, possibly `client/e2e/notes-browsing.spec.ts`.
- Documentation step: update **issue #70** text to explicitly reflect the existing human-approved staging; retain the original requirements for future #78/#79 rather than silently dropping them.

**Interfaces**
- Production summary type remains unchanged. Do not make fixture-only `MediaCardFixture` look like a production implementation or invent a file ID/image URL API.
- #70's live acceptance now covers **bounded text/structured preview behavior**; future inline image/file thumbnail rendering and image-only/file-only persisted Note integration are explicitly dependent on #78/#79; live tag chips depend on #72. Keep layout fixture evidence clearly labeled as **design-only**.

- [ ] **Step 1 — tighten tests:** Keep real production `NotePreview` and `NoteCard` assertions against the actual #69 text/structured DTO. Keep media positioning/attachment design fixtures separately labeled as **non-production layout examples**, never assert they prove integrated media rendering. Where a test combines a production card and an unrelated sibling `<span data-fixture="attachment">`, remove the misleading association or replace it with an explicit design-only fixture test.
- [ ] **Step 2 — run green:** `cd client && npm run test -- src/note/notePreview.test.tsx src/note/NoteCard.test.tsx`; confirm no changes to runtime API schemas or backend.
- [ ] **Step 3 — reconcile original issue #70 scope:** Amend issue text (description or a clearly identified accepted amendment) so its **dependency/acceptance criteria** explicitly reflect the decisions approved in [#70 handoff](https://github.com/krishna916/horizon/issues/70#issuecomment-6732820755): no live thumbnails/media in #70; real media #78/#79; tags #72; `/notes/new` placeholder until #71. Do not reinterpret it as authorization to implement media now. Link the accepted amendment in PR #85 so CodeRabbit's linked-issue checker can compare reality with the approved scope.
- [ ] **Step 4 — comment on CodeRabbit's Linked Issues warning:** Explain the user-approved scope adjustment with URLs; do not write thumbnail code or change #69 summary contract simply to satisfy a stale issue checklist. Leave the **Docstring Coverage** warning unaddressed as an automatic threshold; document complex lifecycle/cache invariants if needed.
- [ ] **Step 5 — commit any test changes:** `git commit -m "Clarify Notes preview fixture coverage and deferred media scope"`. Do not commit an issue-description update as a repository file.

### Task 6: End-to-end verification and review-thread closure

**Files:** No additional production files by default; update only tests uncovered by failures, PR description and existing CodeRabbit threads.

- [ ] **Step 1 — full local checks:** `cd client && npm run verify` followed by `npm run test:e2e -- notes-browsing.spec.ts`. Run any affected general session E2E tests, e.g. `npm run test:e2e -- cross-tab-session.spec.ts`; if practical also run full Playwright. Ensure format/lint/typecheck/coverage/build are all green.
- [ ] **Step 2 — safety review:** Verify no raw HTML, no cross-user content on verification/logout, no extra API calls per card, only view-mode enum in storage, and no working edit/upload/tag functionality. Existing Task behavior and app shell must remain unchanged.
- [ ] **Step 3 — check original PR diff against both plans:** `docs/superpowers/plans/2026-11-09-notes-browsing.md` and this remediation plan. Confirm all five risk tests above pass, including late page cache retention and detail-scroll reset.
- [ ] **Step 4 — push existing branch / update PR:** `git push origin feature/70-notes-browsing`. Update existing [PR #85](https://github.com/krishna916/horizon/pull/85) with a brief remediation summary, test results, and explicit deferrals. Do **not** create a second PR.
- [ ] **Step 5 — address existing CodeRabbit threads in place:** Reply with specific change/test evidence to [scroll restoration](https://github.com/krishna916/horizon/pull/85#discussion_r4510029310) and [provider re-verification](https://github.com/krishna916/horizon/pull/85#discussion_r4510029322). Resolve them only after verifying the fixes.
- [ ] **Step 6 — re-check all PR checks at latest head:** Wait for completed CI and verify frontend, backend, Playwright, SonarCloud and CodeRabbit job statuses are green. A green CodeRabbit **job** means review completed; separately inspect any new actionable findings. Do not bypass/disable checks. If permissions/environment block checks, report the actual status.
- [ ] **Step 7 — leave PR open:** Provide human with updated URL, commit SHAs, exact tests/results, and any remaining deliberate warnings or deferred dependencies. No merge.

## Mapping from review to tasks

| Finding | Decision | Task |
| --- | --- | --- |
| CodeRabbit: missing Notes provider on same-owner verification | **Fix before merge** | 1 |
| CodeRabbit: Load More scroll jump / missing ref | **Fix before merge** | 2 |
| Long note visit loses already loaded 20/40 pages after 5-minute cache GC | **Fix before merge** | 3 |
| Old-owner Notes request not physically aborted | **Small robustness fix** | 3 |
| Detail/new route inherits workspace scroll | **Fix before merge** | 2 |
| Incorrect preview heading/prose sizing and mobile preview cap | **Fix before merge** | 4 |
| Excerpts concatenate adjacent paragraphs | **Fix** | 4 |
| Image/file fixture tests don't exercise production media | **Make coverage claims explicit; don't pull in #78/#79** | 5 |
| CodeRabbit: linked issue still describes live thumbnails | **Align issue with approved deferral** | 5 |
| CodeRabbit: 80% docstring coverage warning | **Skip blanket docstring generation** | 5 |
| Full green checks + review threads | **Mandatory final gate** | 6 |

**Self-review:** All findings from the 2026-11-09 PR #85 review have a task, regression test, scope amendment, or explicit skip rationale. Each code task is test-first, uses existing React/TanStack contracts, and stays within Notes feature boundaries. No new product behavior, backend infrastructure, unapproved upload/media contracts, or agent orchestration is introduced.