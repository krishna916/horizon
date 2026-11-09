# Issue #70 — Notes Browsing and Full-Page Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Luna execution handoff:** Execute **inline and sequentially**, with no subagents or parallel agent delegation. This branch is **planning-only** until the human explicitly authorizes implementation. Do not create a PR, merge, or alter other issues without approval.

**Goal:** Replace the Notes placeholder with an owner-safe, responsive Card/List workspace backed by the existing #69 API; open owned Notes directly in a read-only full page and establish an unpersisted `/notes/new` placeholder.

**Architecture:** Keep all Notes behavior inside `client/src/note/` and thin TanStack file routes. Query the existing paginated backend for 20 bounded summaries at a time, reuse read-only Tiptap for full detail, retain temporary browse state inside the Notes parent route, and store only a per-user view-mode enum locally. Reuse the established authenticated shell/session model. No backend, storage, or tag changes.

**Tech Stack:** React 19, TypeScript 6, TanStack Router, TanStack Query, Axios, Tiptap, Tailwind v4, Vitest/Testing Library, Playwright.

**Spec / authority:** [Issue #70](https://github.com/krishna916/horizon/issues/70); [approved #68 Notes design](../../design/notes-workspace/DESIGN-SPEC.md) and [issue #68](https://github.com/krishna916/horizon/issues/68); shipped [#69 API](https://github.com/krishna916/horizon/issues/69); PRD-005 Notes, PRD-009 Navigation, SPEC-001 Shared Concepts; `client/AGENTS.md`, `.agents/skills/align-context/SKILL.md`, `.agents/skills/testing-frontend/SKILL.md`, `docs/ai/INDEX.md`, and ENG-002 Frontend Engineering Guide. This plan also records explicit human decisions made during #70 planning on 2026-11-09.

## Global constraints and approved decisions

- **Scope approvals:** (1) Implement live text/structured previews now; use **fixtures only** to test image/file presentation; real integration waits for #78/#79. (2) `/notes/new` exists as a clearly labeled **non-editable placeholder**, no create call; #71 supplies the editor. (3) Request **20 Notes per batch**, explicit **Load More**; no infinite scroll. (4) Restore collection/sort/loaded batches/scroll **in memory** when returning from detail; no URL search parameters for this. (5) Live tags deferred to #72; fixture-test reserved display without inventing data or N+1 API calls.
- **Current API is sufficient:** `GET /api/v1/notes?collection=active|archived&page=0&size=20&sort=updated_desc|updated_asc|title_asc` and `GET /api/v1/notes/{id}`. Summary includes `id,title,preview,version,inbox,archivedAt,createdAt,updatedAt`; list includes `items,page,size,hasNext,counts:{active,archived}`. Detail returns `content` instead of `preview`. There are **no tags, files, images, or media URLs** in these current DTOs.
- **Preview ownership:** `NotePreviewBuilder` already supplies a valid ordered, bounded document (max 520 Java String characters, six top-level blocks, 16 KiB serialized). Render this summary, **never fetch full Note bodies per card**. Never scan outside it to promote images. Do not add another truncation algorithm that reorders blocks.
- **Collection behavior:** Active default, Archived secondary button with counts, both based on the same API. Mode shared across collections. No archive/unarchive command (#73), tag filter (#72), or search bar that claims to function (Search later). `inbox=true` Notes remain in Active.
- **Sort:** `updated_desc` default; `updated_asc` and `title_asc` alternatives. Sorting is server-driven and transient within the Notes visit; changing sort starts its own page-zero list. No persisted sort.
- **Cards:** viewport ≥1600: four columns; 1221–1599: three; 601–1220: two; ≤600: one; row-major DOM/keyboard order; gap 20px, padding approximately 21px, 440px overall maximum height; preview max height 265px desktop / 240px mobile with fade. Card title 18px, preview prose 16px. Natural short-note height, no masonry library and no full-row stretching.
- **List:** compact title, single-line excerpt, updated date, no thumbnail; omit absent tags/files entirely in live output. In fixture-only visual coverage, confirm reserved tags/file metadata collapse on narrow screens and do not disturb text order.
- **Title:** null/empty title displays `Untitled note` only in UI; never write a generated title. Body-only and title-only valid. File-only and image-only fixtures appear with the fallback, but **live creation/persistence for those cases is deferred**, because #69 rejects these node types.
- **Detail:** `/notes/$id` must load the full owned document through a single owner-safe request, display it **read-only** with an explicit editing-coming-in-#71 affordance, and offer Back to Notes. No faux editing controls, Save, tag editing, side panel, note modal, or lifecycle actions.
- **New:** `/notes/new` is a separate static route and must not be parsed as an ID. Render an intentional non-editable writer placeholder; visiting or leaving it performs **zero** create/update calls.
- **Return:** native note links; browser Back/forward work; Back to Notes uses history Back only when the detail/new page came from this Notes workspace, else navigates safely to `/notes`. Preserve the in-memory browse context, including loaded batches and scroll, within the same owner's visit. Refresh resets temporary collection/sort/scroll; only view mode survives.
- **Privacy:** owner-qualified Note query keys; add `notes` to `AuthSessionProvider.isPrivateQuery` for cancel/removal; owner switch resets in-memory context and hides old content before verification. No Note data in local/session storage, nor visible stale content after logout/account change. Direct foreign or missing ID gets the same generic unavailable message; no entity enumeration.
- **Security:** only validated safe rich-text links; no `dangerouslySetInnerHTML`, untrusted external image fetching, new rich text dependency, or speculative future storage URL contract. Render media from **local synthetic fixtures only** during #70 tests; do not make fixture paths into a backend contract.
- **Document precedence:** approved #68 Notes-specific navigation/title/collection decisions override older general List→Panel→Page guidance and PRD-005 mandatory title/collapsed archive paragraphs. Do not modify Tasks behavior or authoritative PRDs under this story.
- **Quality:** test-first per task; obey `client/AGENTS.md` and `testing-frontend`; no handwritten edits to generated router tree. Keep changes small and commit each independently passing slice.

## File responsibilities

| Path | Responsibility |
| --- | --- |
| `client/src/note/types.ts` | Exact #69 read/list DTOs and collection/sort/view-mode unions. |
| `client/src/note/api.ts` | Axios Notes list/detail calls only. |
| `client/src/note/queries.ts` | Owner-keyed infinite list and detail TanStack queries. |
| `client/src/note/viewPreference.ts` | Safe per-user Cards/List local-storage enum. |
| `client/src/note/NotesBrowseContext.tsx` | Notes parent-route transient view/collection/sort/scroll state; reset with verified owner. |
| `client/src/note/notePreview.tsx` | Safe renderer of already-bounded Tiptap preview; list excerpt extraction; fixture-only image-order presentation support. |
| `client/src/note/NoteCard.tsx`, `NoteListRow.tsx` | Native direct links and compact Note summaries. |
| `client/src/note/NotesWorkspacePage.tsx` | Header, counts, controls, responsive grid/list, loading/error/empty, Load More and scroll restoration. |
| `client/src/note/NoteDetailPage.tsx`, `NoteNewPlaceholder.tsx` | Read-only full-page document and intentionally unpersisted new route. |
| `client/src/routes/_authenticated/notes.tsx`, `notes.index.tsx`, `notes.$id.tsx`, `notes.new.tsx` | Thin parent, index, detail and static new routes. |
| `client/src/components/rich-text/RichTextViewer.tsx` | Optional generic accessible label; Task default unchanged. |
| `client/src/user/session/AuthSessionProvider.tsx` | Extend protected-query cancellation/removal to Notes. |
| `client/e2e/notes-browsing.spec.ts` | Browser validation, history, owner-safety and responsive behaviors. |
| Associated `*.test.ts(x)` files next to each module | Unit/component/integration tests for its slice. |

If a current repo path or public type differs, inspect first and keep the existing convention. Avoid pre-creating abstractions that are not needed by a task.

## Review focus: risky inputs to pin down in tests

1. **An older owner's in-flight list/detail response arrives after account switch:** previous content never becomes visible; Notes queries are cleared and re-keyed.
2. **Browser storage is blocked, malformed, or contains another owner's mode:** no crash; new owner defaults to Cards and can still switch for that in-memory visit.
3. **Return after several Load More clicks and non-default sort/collection:** exactly the previously loaded ordered items and scroll position return, with no initial reset to 20.
4. **A note ID is invalid, huge, foreign, or missing:** no request for invalid input; generic unavailable view for safe 404; unrelated error allows retry without leaking body.
5. **Adversarial preview JSON, markup-looking text, and late image fixtures:** no HTML execution, external image request, promoted cover, oversized cards, or changed reading order.

---

### Task 1: Typed read-only Notes API and paginated queries

**Files**
- Create: `client/src/note/types.ts`, `client/src/note/api.ts`, `client/src/note/queries.ts`
- Test: `client/src/note/api.test.ts`, `client/src/note/queries.test.tsx`

**Interfaces**
- `type NoteCollection = 'active' | 'archived'`
- `type NoteSort = 'updated_desc' | 'updated_asc' | 'title_asc'`
- `type NoteViewMode = 'cards' | 'list'`
- `type NoteSummary = { id:number; title:string|null; preview:RichTextDocument|null; version:number; inbox:boolean; archivedAt:string|null; createdAt:string; updatedAt:string }`
- `type NoteDetail = Omit<NoteSummary,'preview'> & { content:RichTextDocument|null }`
- `type NoteListResponse = { items:NoteSummary[]; page:number; size:number; hasNext:boolean; counts:{active:number;archived:number} }`
- `noteApi.list(collection:NoteCollection,sort:NoteSort,page:number,size?:number)` and `noteApi.get(id:number)`
- `useNoteList(userId:number|undefined,collection:NoteCollection,sort:NoteSort)` returns an enabled owner-keyed infinite query with 20-item pages.
- `useNoteDetail(userId:number|undefined,id:number|null)` returns an owner-keyed detail query disabled on invalid/no owner input.

- [ ] **Step 1 — failing API tests:** Assert that page zero calls `GET /notes` with params `{collection:'active',sort:'updated_desc',page:0,size:20}`, second page calls `page:1`, and detail calls `/notes/7`. Assert API types reflect nullable title/content and absent tag/file fields.
- [ ] **Step 2 — run red:** `cd client && npm run test -- src/note/api.test.ts`. Expect FAIL before API exists.
- [ ] **Step 3 — implement typed API:** Use existing `apiClient`, no per-item detail requests, no mutation methods, no backend edit.
- [ ] **Step 4 — failing query tests:** With authenticated owner 1, assert first page=0, next page uses `lastPage.page+1` only while `hasNext` is true; changed sort/collection/owner results in a different key; disabled when owner undefined.
- [ ] **Step 5 — run red:** `cd client && npm run test -- src/note/queries.test.tsx`; then implement using `useInfiniteQuery` (`initialPageParam:0`) and `useQuery`; rerun both tests green.
- [ ] **Step 6 — commit:** `git add client/src/note/types.ts client/src/note/api.ts client/src/note/queries.ts client/src/note/*test* && git commit -m "Add Notes read queries and typed pagination"`.

### Task 2: Per-owner view preference and protected session queries

**Files**
- Create: `client/src/note/viewPreference.ts`
- Test: `client/src/note/viewPreference.test.ts`
- Modify: `client/src/user/session/AuthSessionProvider.tsx`
- Test: `client/src/user/session/AuthSessionProvider.test.tsx`, optionally `client/src/app/SessionOwnedTree.test.tsx`

**Interfaces**
- `readNoteViewPreference(userId:number): NoteViewMode` and `writeNoteViewPreference(userId:number,view:NoteViewMode): void`; key format `horizon:notes:view:<userId>` and value exclusively `cards` or `list`.
- Session private-query predicate includes `notes` in addition to `tasks` and `tags`.

- [ ] **Step 1 — failing preference tests:** New user defaults Cards; write List survives module/component reload for same user; owner 2 remains Cards; bad stored enum ignored; read/write throws from storage are caught without crash; no Note payload gets stored.
- [ ] **Step 2 — run red:** `cd client && npm run test -- src/note/viewPreference.test.ts`.
- [ ] **Step 3 — implement storage helper** with try/catch on both read and write; use only verified numeric owner ID; keep transient selected mode in component/context if write failed.
- [ ] **Step 4 — failing session tests:** Cache `['notes',1,'list',...]` and `['notes',1,'detail',7]`; verify logout and account switch remove them and cancel pending Notes queries, while same-owner reverify does not reset preference/context.
- [ ] **Step 5 — run red, extend `isPrivateQuery` minimally, rerun green:** `cd client && npm run test -- src/user/session/AuthSessionProvider.test.tsx src/note/viewPreference.test.ts`.
- [ ] **Step 6 — commit:** `git add client/src/note/viewPreference* client/src/user/session/AuthSessionProvider* && git commit -m "Isolate Notes preferences and queries per owner"`.

### Task 3: Safe structured preview, plain list excerpt, and readable detail viewer

**Files**
- Create: `client/src/note/notePreview.tsx`
- Test: `client/src/note/notePreview.test.tsx`
- Modify: `client/src/components/rich-text/RichTextViewer.tsx`
- Test: `client/src/components/rich-text/RichTextViewer.test.tsx`

**Interfaces**
- `NotePreview({document}:{document:RichTextDocument|null})` renders existing bounded document nodes as safe React text/structure for cards; do not expand or fetch full content.
- `noteListExcerpt(document:RichTextDocument|null): string` provides leading text only for a compact one-line list excerpt.
- `RichTextViewer({value,ariaLabel?})` gains optional accessible label while keeping existing default `Task description`; Notes uses `Note content`.

- [ ] **Step 1 — failing preview tests:** Given a `doc` with headings, paragraphs, bold/italic/link, bullets, ordered lists, blockquote, code and table, assert reading order and text semantics; escaped text `<img src=x onerror=...>` stays inert; unsafe `javascript:` URLs never become clickable; null/empty document renders nothing invented. The server preview is already bounded: do not make a second 520-character cutoff.
- [ ] **Step 2 — fixture-only media tests:** Supply *synthetic* ordered image-first, text→image, and late-image documents, plus an attachment-only card composition. Verify a leading image occupies its encountered position in a card fixture, a late image omitted by the bounded fixture is never promoted, and attachment-only shows title fallback + fixture metadata without synthetic body text. Keep test assets same-origin; do **not** add production media fetches or commit to a #79 fileId/URL schema. Use local visual-fixture scaffolding rather than extending runtime API DTOs.
- [ ] **Step 3 — run red:** `cd client && npm run test -- src/note/notePreview.test.tsx`.
- [ ] **Step 4 — implement the smallest safe renderer:** Reuse existing rich-text safety utilities, use React elements not raw HTML; render supported text/structures or neutral fallback. Do not initialize a full Tiptap editor for each card. Only synthetic fixtures exercise future media slots.
- [ ] **Step 5 — failing viewer test:** With `ariaLabel="Note content"`, verify read-only document accessibility; without it the Task test still sees `Task description`. Implement optional label; rerun both tests green.
- [ ] **Step 6 — commit:** `git add client/src/note/notePreview* client/src/components/rich-text/RichTextViewer* && git commit -m "Render bounded Notes previews safely"`.

### Task 4: Native card and compact row components

**Files**
- Create: `client/src/note/NoteCard.tsx`, `client/src/note/NoteListRow.tsx`
- Test: `client/src/note/NoteCard.test.tsx`, `client/src/note/NoteListRow.test.tsx`

**Interfaces**
- `NoteCard({note}:{note:NoteSummary})` renders an accessible native link to `/notes/$id`, title fallback, bounded document preview, and available updated-date metadata.
- `NoteListRow({note}:{note:NoteSummary})` renders the same canonical link, title, one-line excerpt, updated-date metadata, no thumbnail.

- [ ] **Step 1 — failing component tests:** Test owned summary with actual title, null title, title-only, body-only, null preview, text/structured rich preview. Confirm href points directly to `/notes/7`; no side panel, no invented image/tag/file metadata, no embedded button inside the full-row link.
- [ ] **Step 2 — run red:** `cd client && npm run test -- src/note/NoteCard.test.tsx src/note/NoteListRow.test.tsx`. Use the repository `testing-frontend` mock-Link recipe or a real memory router.
- [ ] **Step 3 — implement components:** Follow #68 approved typography/density and existing theme tokens; render only actual API-backed fields. Keep reserved metadata regions from causing blank visible space; no speculative tag components.
- [ ] **Step 4 — test keyboard/native navigation and narrow-row layout** using accessibility selectors; fixture image/file visual slots must not alter link order or title fallback.
- [ ] **Step 5 — run green and commit:** `cd client && npm run test -- src/note/NoteCard.test.tsx src/note/NoteListRow.test.tsx`; `git add client/src/note/NoteCard* client/src/note/NoteListRow* && git commit -m "Add Notes card and list row browsing surfaces"`.

### Task 5: Persistent parent-route browse context and owner reset

**Files**
- Create: `client/src/note/NotesBrowseContext.tsx`
- Test: `client/src/note/NotesBrowseContext.test.tsx`

**Interfaces**
- `NotesBrowseState = { collection:NoteCollection; sort:NoteSort; view:NoteViewMode; scrollTop:number }`, defaults `active / updated_desc / saved-or-cards / 0`.
- `NotesBrowseProvider({userId,children}:{userId:number;children:ReactNode})` holds the state while nested Notes routes mount/unmount.
- `useNotesBrowse(): {state;setCollection;setSort;setView;rememberScroll}`; view change calls the safe per-owner storage helper.

- [ ] **Step 1 — failing state tests:** Select Archived, `title_asc`, List, scroll=850; unmount/re-mount workspace child under the *same provider* and confirm all retained. New provider for owner 2 starts Active/updated_desc with its own view preference and zero scroll; changing back to owner 1 must not surface stale owner 1 cached Note data. Browser refresh simulates a new provider: only stored view survives.
- [ ] **Step 2 — run red:** `cd client && npm run test -- src/note/NotesBrowseContext.test.tsx`.
- [ ] **Step 3 — implement provider:** Keep React state private to Notes parent route; initialize/reinitialize on verified owner change (key provider by ID in route and rely on `SessionOwnedTree` owner revision); never store list content or scroll in localStorage.
- [ ] **Step 4 — run green and commit:** `cd client && npm run test -- src/note/NotesBrowseContext.test.tsx`; `git add client/src/note/NotesBrowseContext* && git commit -m "Retain Notes browse context within owner session"`.

### Task 6: Workspace with server sort, Active/Archived, and 20-item Load More

**Files**
- Create: `client/src/note/NotesWorkspacePage.tsx`
- Test: `client/src/note/NotesWorkspacePage.test.tsx`

**Interfaces**
- `NotesWorkspacePage()` consumes `useNotesBrowse()` and `useNoteList(userId,collection,sort)`, flattens already-loaded pages in backend order, and provides native links through Task 4 components.
- Uses existing app shell scroll container `AppContent` (the scrollable `main` element); preserve its scroll before route exit and restore after the retained list pages render.

- [ ] **Step 1 — failing workspace tests:** Cards initially selected; switch List and back without list refetch; Active and Archived counts from API; sort options map exactly to backend enums; selecting sort/collection starts page 0; `Load More` increments page and appends, disappears when `hasNext=false`, disables during pending requests, and shows a non-destructive retry on next-page error. Confirm no extra detail fetch per card.
- [ ] **Step 2 — failing state tests:** Initial/loading skeleton, empty Active/Archived collection, fetch error with Retry, blank title, and 20 initial rows; no fake search or tag filter. Test keyboard focus and DOM order for both modes; check component grid uses row-major order and natural heights with 440px cap.
- [ ] **Step 3 — run red:** `cd client && npm run test -- src/note/NotesWorkspacePage.test.tsx`.
- [ ] **Step 4 — implement controls and responsive presentation:** Exact grid breakpoints and 20px gaps; cards have `align-self:start` behavior and responsive preview caps. Build accessible segmented-like buttons for collection and view, select for sort; use HTML semantics and existing shadcn primitives only when already available.
- [ ] **Step 5 — implement scroll integration:** Record actual `main` scrollTop on navigate-away; on returning to index, wait until cached/retained pages are rendered before restoring. Avoid a second window scroll container, global store, or query-parameter state. If pages were removed for a new owner, never restore an old owner's scroll/list.
- [ ] **Step 6 — run green and commit:** `cd client && npm run test -- src/note/NotesWorkspacePage.test.tsx`; `git add client/src/note/NotesWorkspacePage* && git commit -m "Build Notes workspace with explicit Load More"`.

### Task 7: Thin routes, read-only full page, and unpersisted New Note placeholder

**Files**
- Modify: `client/src/routes/_authenticated/notes.tsx` (replace placeholder with parent provider + `Outlet`)
- Create: `client/src/routes/_authenticated/notes.index.tsx`, `client/src/routes/_authenticated/notes.$id.tsx`, `client/src/routes/_authenticated/notes.new.tsx`
- Create: `client/src/note/NoteDetailPage.tsx`, `client/src/note/NoteNewPlaceholder.tsx`, `client/src/note/noteNavigation.ts` (only if needed for typed history origin/ID parsing)
- Test: `client/src/note/NoteDetailPage.test.tsx`, `client/src/note/noteNavigation.test.ts`

**Interfaces**
- `parseNoteId(raw:string):number|null` accepts strictly decimal, positive safe integers; otherwise returns null, no network call.
- History-state marker `horizonNoteNavigation?: {kind:'from-workspace';noteId?:number}`, added via TanStack Router `HistoryState` augmentation, for trusted Back behavior. Mark routes opened from Notes index, but do not trust unrelated direct/refresh navigation.
- Static new route is independent of `$id` route and never invokes `noteApi.create`.

- [ ] **Step 1 — failing route/detail tests:** Existing `id=7` fetches full content once, renders title/fallback and read-only Tiptap with `Note content` label. Invalid `0`, `abc`, negative or >`Number.MAX_SAFE_INTEGER` => generic unavailable with zero API requests. 404 => generic unavailable without owner hint; 500 => non-leaky Retry. Archived Note remains readable; no editing/lifecycle controls.
- [ ] **Step 2 — failing New tests:** `/notes/new` shows a clear editor-coming-next placeholder, Back to Notes, and zero Note POST/PATCH. Routing literal `new` cannot accidentally call GET `/notes/new`.
- [ ] **Step 3 — run red:** `cd client && npm run test -- src/note/NoteDetailPage.test.tsx src/note/noteNavigation.test.ts`.
- [ ] **Step 4 — implement thin routes/components:** `notes.tsx` retains provider while index/detail/new child routes change; index is workspace; $id is read-only detail; new is placeholder. Reuse AppShell and existing RichTextViewer. Run `cd client && npx @tanstack/router-cli generate` to regenerate router tree. No manual generated-file edits.
- [ ] **Step 5 — implement safe Back:** For trusted in-app Notes origin, browser history Back; for direct entry/refresh/unknown origin, `navigate({to:'/notes',replace:true})`. Returning must leave parent browse state intact and avoid duplicate history entries.
- [ ] **Step 6 — run green and commit:** `cd client && npm run test -- src/note/NoteDetailPage.test.tsx src/note/noteNavigation.test.ts` then `npm run typecheck`. Commit route/components/tests and generated router tree with `git commit -m "Add Notes full-page and new draft routes"`.

### Task 8: Browser acceptance and cross-account regression

**Files**
- Create: `client/e2e/notes-browsing.spec.ts`
- Modify tests when needed: `client/src/user/session/AuthSessionProvider.test.tsx` and `client/src/app/SessionOwnedTree.test.tsx`

**Interfaces**
- Use Playwright intercepted `/api/v1/users/me`, paginated `/api/v1/notes`, and `/api/v1/notes/{id}` fixtures. Match list route before item route, using exact pathname; do not require local backend, persisted fixtures or cloud images.

- [ ] **Step 1 — failing browser test: browsing:** At desktop viewport, show Cards + Active + first 20; switch List, switch Archived and sort; Load More yields 40 when `hasNext`; open item and assert URL `/notes/7` directly (never panel). Browser Back and visible Back to Notes restore collection, sort, mode, loaded batches and `main` scrollTop.
- [ ] **Step 2 — failing browser test: persistence:** Refresh after List and confirm same owner stays List while transient collection/sort reset; mocked different owner on same browser starts Cards; blocked localStorage test remains navigable.
- [ ] **Step 3 — failing browser test: direct routes:** `/notes/7` deep link shows read-only owned content; unknown 404 and malformed ID show same unavailable screen; `/notes/new` shows placeholder without POST/PATCH.
- [ ] **Step 4 — failing browser test: responsive and previews:** Test viewport widths 600/601/1220/1221/1599/1600 for one/two/three/four grid columns as designed, no horizontal overflow, native keyboard tab order; long card is ≤440px, short card remains compact. Confirm markup-looking text is inert. Test synthetic image-first/late-image and file-only cases with **local fixture media only**; avoid claiming backend file support.
- [ ] **Step 5 — failing session race test:** Switch mocked owner while an old Notes list/detail response is pending; old content never appears and the new owner uses only its own query key. Validate logout and retryable session verification hide old Notes.
- [ ] **Step 6 — implement only corrections revealed by tests; run green:** `cd client && npm run test:e2e -- notes-browsing.spec.ts` and targeted Vitest suites. Use `testing-frontend` route mocking and accessible selectors.
- [ ] **Step 7 — commit:** `git add client/e2e/notes-browsing.spec.ts client/src/... && git commit -m "Cover Notes browsing and session boundaries end to end"` (replace the placeholder add path with exact changed files).

### Task 9: Verification, scope audit, and handoff

**Files:** No new production files by default. Update this plan's checkbox status only if useful to execution review; don't revise design documents without a separate decision.

- [ ] **Step 1 — full client verification:** `cd client && npm run verify` (lint, format, coverage, build), plus `npm run test:e2e -- notes-browsing.spec.ts`. If Playwright environment unavailable, report blocker and retain unexecuted test as not verified.
- [ ] **Step 2 — final diff review:** Check only Notes files, minimal shared viewer/session changes, generated route tree and tests; verify no backend API/DB changes, no new dependency, no Task behavior change, no fake tag/file data, no real image fetch, no persisted note on `/notes/new`.
- [ ] **Step 3 — check user-visible acceptance:** Card/List + per-owner mode; 20 Load More; Active/Archived counts; sorts; responsive cap; deep link/read-only detail; meaningful fallback; generic 404; return with history/scroll; owner isolation; fixture-only media.
- [ ] **Step 4 — report deliberately deferred #70 checklist items:** Live image-only/file-only creation, thumbnail delivery, file indicators, and real tag chips **cannot** be accepted as integrated until #78/#79/#72. State this as a dependency boundary rather than marking live functionality complete.
- [ ] **Step 5 — present results to human:** list commits, tests run and pass/fail, screenshots/observations if browser verified, deferred integration points and any remaining design discrepancies. Wait for explicit approval before PR/merge.

## Implementation guardrails for Luna

1. Read this plan and approved `docs/design/notes-workspace/DESIGN-SPEC.md`, then follow repository `align-context` and `testing-frontend` skills before code changes.
2. Implement **sequentially**, test-first, in `feature/70-notes-browsing`. Do not use subagents, fetch speculative APIs, modify #69 backend to make visual fixtures work, or change #68 product decisions.
3. If the checked-in #68 mockup contains prototype-only behaviors (demo search, tag-only persistence, simulated file uploading), treat them as **non-production fixtures**, not implementation requirements for #70.
4. If a new material decision is needed beyond the approvals recorded here, **stop and ask the human** instead of filling it in. For minor engineering choices, stay consistent with existing code, record the choice briefly and proceed.
5. No code execution starts solely because this plan was committed or linked on the issue; the human must explicitly start Luna.

## Self-review / coverage mapping

| #70 requirement | Owning task |
| --- | --- |
| API-backed owner-scoped collection, bounded ordered preview | 1, 3, 8 |
| Owner-safe session transitions / no cross-account stale content | 1, 2, 5, 8 |
| Cards/List, metadata, untitled, responsive heights | 3, 4, 6, 8 |
| Per-user initial Cards and persisted List preference | 2, 5, 8 |
| Active/Archived counts, sort, 20-item Load More | 1, 5, 6, 8 |
| Direct full-page links/read-only deep link/404 | 4, 7, 8 |
| New Note direct route, no accidental persisted Note | 7, 8 |
| Browse context/history/scroll preservation | 5, 6, 7, 8 |
| Image/file/tags design fixture coverage but no live integration | 3, 4, 8, 9 |
| Tests, code quality, original scope boundaries | 8, 9 |
