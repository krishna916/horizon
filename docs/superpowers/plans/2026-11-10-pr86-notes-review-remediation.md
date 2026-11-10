# PR #86 Notes Editing Review Remediation — Implementation Plan

> **For Luna / coding agent:** REQUIRED: use `superpowers:executing-plans` **inline, one task at a time**. **No subagents, delegation, or parallel agent execution.** Write a failing regression test first, verify red, implement the smallest fix, verify green, and commit each independent slice. This is a **review-remediation plan**, not a new feature.

**Goal:** Make PR #86 safe to merge by closing its five CodeRabbit findings, fixing three failed manual Notes tests, addressing independently identified data-integrity/navigation risks, and strengthening regression tests without expanding #71 scope.

**Architecture:** Keep the existing NoteSaveCoordinator + useNoteAutosave + owner-bound in-memory recovery design. Repair write-dispatch/confirmation semantics, editor identity and authentication lifecycle, cache-refresh behavior and navigation. Do not introduce state-management infrastructure, a rewrite of the coordinator, new Note endpoints or persistence.

**Tech stack:** Existing React 19 / TypeScript / TanStack Router and Query / Axios / Tiptap / Vitest / Playwright; #69 Spring Boot Notes API.

**Spec and evidence:**
- Original implementation plan: `docs/superpowers/plans/2026-11-09-notes-rich-editing-autosave.md`.
- Product: issue #71, approved #68 Notes design `docs/design/notes-workspace/DESIGN-SPEC.md`; #69 backend, #70 browsing.
- PR: https://github.com/krishna916/horizon/pull/86, reviewed head `b90d07951e711913aac0bddf9672c85c1598149a`.
- Manual browser failures: https://github.com/krishna916/horizon/pull/86#issuecomment-6761189140.
- CodeRabbit inline threads: `#discussion_r4521761865`, `#discussion_r4521761867`, `#discussion_r4521761871`, `#discussion_r4521761878`, `#discussion_r4521761888`.

## Global constraints and product decisions

- **Keep #71 boundaries:** title/body rich editing, autosave, recovery, navigation. Tag UI and tag-only/atomic Note+Tag behavior belong to **#72**; attachment/image flows to #78/#79. The manual report's “Tag flows unavailable” is **expected scope separation**, not a #71 defect. Explicitly mark it deferred in PR review replies.
- **Do not pretend HTTP writes are reversible.** A PATCH already sent may commit despite disposing the client coordinator or aborting the request. For pending **unsent** draft changes, allow `Discard unsent changes and sign out`. For **in-flight or ambiguous** writes, do not show a misleading promise that discarding undoes them: offer `Wait for save and sign out`, Stay, and a clearly acknowledged `Sign out anyway — changes may already have saved` fallback if necessary. Existing confirmed server edits are never silently rolled back. A true strict undo/revert is out of scope and requires a separate product/server decision.
- **Session:** verification on focus/visibility is frequent and transient: retain a verified owner's mounted editor/Tiptap/caret/undo stack behind the authenticated privacy overlay, pause writes until verified, handle `retryable-error` similarly. On actual 401, owner switch or explicit logout, private UI must unmount/hide and memory-only same-owner recovery policy remains intact.
- **Explicit 409:** no automatic merge/overwrite. Any asynchronous Load latest must not silently discard edits made since the user's confirmation; Keep local must send the latest authorized draft with a fresh server version. Repeated conflict returns to conflict state.
- **Owner safety:** no dispatched mutation or cache update for a previous/unverified owner; no unsaved Note content in localStorage/sessionStorage/IndexedDB. Distinguish server-owned cached Note detail (`#70` permits it) from unsaved draft snapshots (never Query-persisted).
- **Plan execution:** work on the existing PR branch; preserve #68 layout, #70 Cards/List state and Task editor behavior; no new API, schema, cache library, general-purpose event bus or speculative Tag UI. Before editing, confirm PR head and review paths haven't changed; if a finding is already fixed, document evidence and skip its code change.
- **Verification convention:** commands below run from `client/`. Use `npm run test -- <paths>`, `npm run verify` and `npm run test:e2e`. E2E should model real delayed POST/PATCH/GET and focus/re-authentication—not only immediate stub responses.

## Review ledger (no finding silently omitted)

| Source | Finding | Priority | Owning task |
| --- | --- | --- | --- |
| CodeRabbit #4521761865 | Wait/Retry-and-leave reads React-stale `canLeave` after save | P1 | Task 1 |
| CodeRabbit #4521761867 | Routine focus verification unmounts active Tiptap/coordinator | P1 | Task 2 |
| CodeRabbit #4521761871 | Main scroll is not reset when opening Note editor | P2 | Task 5 |
| CodeRabbit #4521761878 | Newly persisted direct-link Note falsely gains workspace origin | P2 | Task 5 |
| CodeRabbit #4521761888 | Deliberately discarded draft is restashed in unmount cleanup | P2 | Task 1 |
| Manual browser comment | Discard-and-logout claims to undo already-sent PATCH | **P1** | Task 1 |
| Manual browser comment | New Note/title/count stale until browser reload | **P1** | Task 3 |
| Manual browser comment | Untouched `/notes/new` falsely says `Saved` | P2 | Task 3 |
| Manual browser comment | Tag flows unavailable | Expected #72 | Task 7 (reply only) |
| Architecture review | Direct `/notes/7` → `/notes/8` may reuse wrong coordinator | **P1** | Task 2 |
| Architecture review | `Load latest` GET can erase edits typed while awaiting resolution | **P1** | Task 4 |
| Architecture review | Lost/committed PATCH metadata unavailable during actual expiry recovery | P2 | Task 4 |
| Architecture review | Guard allows arbitrary dirty `/notes/new` → any numeric ID bypass | P2 | Task 5 |
| Architecture review | Mutation dispatch should verify live owner/session, not only successful response | P1 defensive | Task 4 |
| Architecture review | `<dialog open aria-modal>` without real focus containment | P2 accessibility | Task 5 |
| CodeRabbit pre-merge | Two unrelated Tasks files in #71 PR | Scope hygiene | Task 7 |
| CodeRabbit pre-merge | Blanket docstring coverage suggestion | Skip blanket changes; document reason | Task 7 |

### Five regression scenarios that matter most

1. **Server-side write already sent, then sign-out requested:** never promise discard; test both unsent and in-flight/ambiguous cases, including logout failure.
2. **Window focus during a slow PATCH:** same-owner verify must keep one Tiptap instance and recover the issued write without a false 409 or lost cursor/undo.
3. **Navigate between two cached Note IDs:** coordinator for Note A must never PATCH Note B (or vice versa); `new` → its created ID is the only identity-preserving special case.
4. **Return to paginated Cards/List after editing/creating:** title, list count, and pagination reflect server changes without hard reload or destroying browse/scroll state.
5. **Choose Load latest then type while GET is pending:** changes since the confirmation must not disappear; conflict resolution stays explicit.

---

## Task 1 — Make save-and-leave and sign-out truthful and deterministic

**Files:** Modify `client/src/note/NoteSaveCoordinator.ts`, `useNoteAutosave.ts`, `NoteEditorNavigationGuard.tsx`, `NoteEditorPage.tsx` and their corresponding tests. Touch `client/src/user/hooks/useLogoutUser.ts` only if needed for the existing guarded logout contract.

**Interfaces and behavior:**
- Expose `canLeaveNow(): boolean` from `useNoteAutosave`, computed synchronously from `coordinator.snapshot()`. Use it after awaited `flush()`/`retry()`; don't wait for a React state commit before proceeding.
- Add a conservative save-flight signal to `NoteSaveSnapshot`, e.g. `writeInFlight: boolean` plus `outcomeUncertain: boolean` if required. A queued debounce is **unsent**; an issued POST/PATCH is **not cancellable with a guaranteed rollback**. A failed/ambiguous request remains uncertain until reconciled.
- Make `discardDraft()` terminal for that editor identity: dispose timers, mark a synchronous `discardedRef`, clear recovery, and make unmount cleanup skip restash. Late promises must neither recreate recovery nor mutate another owner's cache.
- Sign-out prompt semantics:
  - Unsent-only: explicit `Discard unsent changes and sign out`; stops scheduled mutation before dispatch.
  - In-flight/uncertain: no `Discard draft` claim; show `Wait for save and sign out` (and retry/reconcile when necessary). If user insists on leaving while outcome uncertain, use a **second explicit acknowledgement** saying changes may already be on server. Always discard only the *local* recovery state on completed explicit logout. If logout fails and returns to Notes, do not resurrect deliberately discarded content.
  - In-flight change successfully committed: label outcome as saved, allow sign-out. Do **not** attempt an automatic reverse PATCH to satisfy an impossible discard promise.
- Blocked navigation when `flush` or `retry` returns but latest draft still dirty/failed/conflicted must stay blocked.

- [ ] **1. Write red hook/guard tests:** mock coordinator saving, resolve awaited flush then check that a *single* click `Wait for save` proceeds; same for Retry. Failed/incomplete save stays blocked. Existing tests currently assert Retry was merely called: strengthen them to assert `blocker.proceed`.
- [ ] **2. Verify red:** `npm run test -- src/note/NoteEditorNavigationGuard.test.tsx src/note/useNoteAutosave.test.tsx`.
- [ ] **3. Implement `canLeaveNow` and guard use**, with no new global state; confirm the synchronous coordinator check is after the await.
- [ ] **4. Write red logout tests:** (a) pending 900ms debounce → discard+sign-out → zero POST/PATCH, even after timers advance; (b) hold already-issued PATCH → sign-out dialog says it might persist, offers wait, **does not offer misleading discard**; (c) resolve PATCH → sign out after saved; (d) ambiguous PATCH/error → require reconciliation/explicit sign-out acknowledgment, never promise rollback; (e) deliberately discarded draft + logout API failure → no Resume entry appears.
- [ ] **5. Verify red:** `npm run test -- src/note/NoteEditorNavigationGuard.test.tsx src/note/useNoteAutosave.test.tsx src/note/NoteSaveCoordinator.test.ts`.
- [ ] **6. Implement minimal coordinator flight/uncertainty signal, honest sign-out UX, and discard ref**, preserving the existing `AuthSessionProvider` / AppSidebar logout workflow and same-owner memory policy.
- [ ] **7. Verify green:** repeat the test command. Exercise actual Playwright sign-out flow in Task 6.
- [ ] **8. Commit:** `git add client/src/note client/src/user/hooks/useLogoutUser.ts && git commit -m "fix(notes): prevent false discard and complete guarded navigation"`.

## Task 2 — Keep editor mounted through verification; isolate Note identity

**Files:** Modify `client/src/note/NoteEditorPage.tsx`, `NotesRoute.tsx`, `useNoteAutosave.ts` and their tests; `client/src/user/session/AuthSessionProvider.tsx` only if an auth lifecycle distinction is missing.

**Interfaces and behavior:**
- Keep `ActiveNoteEditor` mounted during same-owner `verifying` and transient `retryable-error`. The existing `AuthenticatedSessionBoundary` hides/inerts private DOM and `useNoteAutosave` pauses mutations. Do not expose the last verified owner as current authentication; holding its ID for *mounted component identity* is not authorization to GET/PATCH.
- Protect initial loading and query pending states: `useNoteDetail` being disabled or cancelled during verification must not cause the parent to replace an already-mounted editor with a skeleton. Retain initial Note data for the editor's mounted lifetime without granting unverified data access. On true `unauthenticated` transition, clear UI while memory recovery above `SessionOwnedTree` may retain an eligible draft.
- A paused but otherwise clean Note is **not unsaved**. Fix `snapshot().hasUnsavedChanges` so `phase === 'paused'` alone cannot cause recovery UI for a clean editor; preserve true dirty/failed/conflict cases.
- **Editor lifetime invariant:** keyed by `verifiedOwner + logicalNoteIdentity`. Different Note IDs get different coordinators/Tiptap instances; **only** a successful first POST to the matching created ID keeps the existing `new` editor instance. Do not key only by owner. Avoid global state: the `NotesRoute` parent can track just the in-session promoted created ID.
- Test unknown/invalid direct routes and cross-owner switches: never reuse earlier owner content.

- [ ] **1. Write red component tests:** verified owner 1 editing Note 7; simulate focus verification and transient verification error; `ActiveNoteEditor`/Tiptap DOM node remains the same, caret/undo intact, and no fresh POST/PATCH until verified. Clean paused Note produces no recovery notice.
- [ ] **2. Verify red:** `npm run test -- src/note/NoteEditorPage.test.tsx src/note/NotesRoute.test.tsx src/note/useNoteAutosave.test.tsx`.
- [ ] **3. Implement same-owner mounted-editor retention and clean-paused semantics**, keeping privacy overlay inert, current owner verification checks intact.
- [ ] **4. Write red identity tests:** navigate directly from Note 7 to already cached Note 8 while dirty/saving/after explicit safe leave: initialNote and save coordinator belong to 8, and never dispatch a PATCH to 7. Test `/notes/new` → POST id 501 → `/notes/501` retains same Tiptap node/caret. A subsequent `/notes/502` intentionally gets a fresh editor.
- [ ] **5. Implement narrow editor identity fix** via parent-hosted logical key and approved new→ID transition, rather than reinstating separate leaf editor components.
- [ ] **6. Verify green:** same targeted tests plus `npm run test -- src/components/rich-text/RichTextEditor.test.tsx`.
- [ ] **7. Commit:** `git add client/src/note client/src/user/session && git commit -m "fix(notes): retain editor across verification and isolate note identity"`.

## Task 3 — Refresh Notes collection and correct initial save status

**Files:** Modify `client/src/note/queries.ts`, `useNoteAutosave.ts`, `NotesWorkspacePage.tsx` only as needed, `NoteEditorPage.tsx` and focused tests including `NotesWorkspacePage.test.tsx`, `NoteEditorPage.test.tsx`.

**Interfaces and behavior:**
- The current `publishSavedNote` invalidates `['notes', ownerId, 'list']`; `useNoteList` has `refetchOnMount:false`, so an inactive collection may not refresh on return. Prefer `refetchOnMount:true` **for stale/invalidated Notes list queries**, retaining existing successful cached pages during the fetch. Keep `refetchOnWindowFocus:false` and owner-scoped query keys.
- Confirm after create/update the Active count and relevant visible collection are fresh. Do not manually splice created Notes into arbitrary sort/pagination pages, create an N+1 detail-fetch pattern or reset to one page. Preserve #70 Load More count, collection/sort, view and scroll.
- For untouched new route (no server Note ID), `clean` status means `Not saved yet` or no save status, **never `Saved`**. `Saved` only means a confirmed server-backed Note with latest edits acknowledged. A title/body change pending debounce reads `Unsaved changes`.
- Empty title is valid; only the display fallback is `Untitled note`.

- [ ] **1. Write red Query tests:** existing cached Cards/List page, create/update via coordinator, return without hard refresh, verify server refetch is triggered and updated Note title/count appears; previously loaded pages and scroll survive. Test Active and Archived, including title sort, and that owner 2 is not refetched.
- [ ] **2. Verify red:** `npm run test -- src/note/NotesWorkspacePage.test.tsx src/note/useNoteAutosave.test.tsx`.
- [ ] **3. Apply minimal Query lifecycle change** (refetch stale/invalidated on mount). Confirm no infinite refetch loop or every-keystroke list fetch while editor is open.
- [ ] **4. Write red status tests:** blank new Note displays `Not saved yet` (or no indicator) and makes zero POST; after meaningful input shows Unsaved changes then Saving and only **after confirmation** Saved; existing clean Note can show Saved.
- [ ] **5. Implement save copy conditional on `snapshot.persisted` and revision, verify green:** `npm run test -- src/note/NotesWorkspacePage.test.tsx src/note/NoteEditorPage.test.tsx src/note/useNoteAutosave.test.tsx`.
- [ ] **6. Commit:** `git add client/src/note && git commit -m "fix(notes): refresh saved collection and avoid false Saved status"`.

## Task 4 — Harden 409 resolution, expiry replay and mutation ownership

**Files:** Modify `client/src/note/NoteSaveCoordinator.ts`, `NoteDraftRecoveryProvider.tsx`, `useNoteAutosave.ts`; extend corresponding tests.

**Interfaces and behavior:**
- `resolveConflict('load-server')` must not wipe edits created after confirmation while its GET is pending. Choose simplest robust policy: lock rich editor/title **only for the asynchronous confirmed resolution window**, keep it enabled while merely showing the conflict. If internal or rapid edits can still arrive, compare `localRevision` with the revision captured at confirmation before replacing; on difference remain conflict and preserve local draft. Disable confirm buttons during resolution to prevent concurrent resolutions.
- `keep-local` always fetches current owned version and sends the authorized latest local snapshot; if another edit occurs while in flight, serialize it after successful confirmation. A second `409` returns to conflict.
- Retain the **frozen previously issued PATCH** (id, expectedVersion, submitted normalized title/body, local revision) in **memory-only** `recoverySnapshot()`/`NoteDraftRecoveryEntry` when actual `401` unmounts. After verified same-owner resume, reconcile fresh server GET against that submitted snapshot before classifying newer version as external conflict; if it matches, mark that revision saved and queue later edits. If changed differently, require explicit conflict choice. Do not store this metadata in browser storage.
- Check live authenticated owner/session epoch **immediately before** each POST/PATCH dispatch in the transport adapter (not solely in `onCreated`/`onUpdated` callbacks). No writes while verifying or after ownerRevision change. A previously dispatched request cannot be retracted; completion must not touch new-owner UI/cache.

- [ ] **1. Write red conflict race tests:** confirm Load latest, hold GET, simulate draft edit, release GET; local edit remains and conflict persists. Confirm Keep, hold GET then type, ensure latest authorized draft ultimately saved serially or remains explicit conflict. Repeat 409 pauses.
- [ ] **2. Verify red:** `npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/NoteEditorPage.test.tsx`.
- [ ] **3. Implement resolution lock/revision check** with distinct `resolvingConflict` state/control if needed; do not disable the editor for the entire ordinary conflict state.
- [ ] **4. Write red expiry tests:** in-flight PATCH version 2→3 commits then 401/unmount, later owner 1 logs in; fresh GET matches frozen patch, no false conflict, and later local changes follow as serial PATCH. Different server payload with version 3 yields explicit conflict, not overwrite. Other owner/explicit logout drops recovery metadata.
- [ ] **5. Implement in-memory pending-PATCH recovery and reconcile path**, without persisting draft to Query or storage. Keep idempotent POST replay behavior and its frozen UUID/body unchanged.
- [ ] **6. Write red auth-dispatch tests:** session becomes verifying or owner switches just before pending debounce/flush sends; assert zero POST/PATCH under old owner. Server result from previously dispatched write can never enter another owner's cache.
- [ ] **7. Implement dispatch-time gating** and verify green: `npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/useNoteAutosave.test.tsx src/note/NoteDraftRecoveryProvider.test.tsx src/note/NoteEditorPage.test.tsx`.
- [ ] **8. Commit:** `git add client/src/note && git commit -m "fix(notes): reconcile pending writes and guard explicit resolution"`.

## Task 5 — Correct navigation origin, scroll, and dialog accessibility

**Files:** Modify `client/src/note/NotesRoute.tsx`, `NoteEditorNavigationGuard.tsx`, `NoteEditorPage.tsx` and tests; optionally reuse installed Radix UI primitives for modal focus.

**Interfaces and behavior:**
- On editor route entry from workspace, set the actual scrollable `<main>`'s `scrollTop=0` in a layout effect. Do **not** repeat when `/notes/new` is replaced with its created ID: no caret/scroll jump. Workspace remembers/restores its separate scroll on Back, even after Load More.
- `onCreated` carries `horizonNoteNavigation:from-workspace` **only** if that marker was trusted before create; direct/bookmarked/external new routes must get normal `Back to Notes` fallback, never history back to arbitrary previous pages.
- Only bypass unsaved navigation guard for `/notes/new` → **the exact persisted ID returned by its successful POST**. Dirty new→unrelated numeric Note or link stays guarded.
- Two confirmation dialogs must be genuinely modal: focus goes into modal, Tab/Shift-Tab cannot reach background, Escape/Cancel behaves safely, focus returns to trigger on close. Prefer existing Radix/shadcn patterns (the project includes `radix-ui`); alternatively proper native `dialog.showModal()` with cleanup. `<dialog open aria-modal>` alone is insufficient. Keep semantic labels and keyboard operability.

- [ ] **1. Red route tests:** open Note from deeply scrolled workspace → editor starts at scroll 0 → Back restores browse scroll; new→created ID doesn't reset editor scroll/caret; direct entry after initial create retains untrusted origin and Back goes to `/notes`.
- [ ] **2. Verify red:** `npm run test -- src/note/NotesRoute.test.tsx src/note/NoteEditorNavigationGuard.test.tsx`.
- [ ] **3. Implement scroll/origin fixes** without altering `NotesBrowseContext` and #70 history assumptions.
- [ ] **4. Red guard tests:** dirty `/notes/new` → arbitrary `/notes/999` blocked; successful POST id 501 may replace only `/notes/501`.
- [ ] **5. Implement exact-ID bypass**, using confirmed `snapshot.persisted.id` as trusted transition data rather than a loose numeric-path regex.
- [ ] **6. Red modal tests:** keyboard focus trapping and Escape/focus restoration for both conflict and leave confirmations; no background editing possible while confirmation is open.
- [ ] **7. Implement accessible modal behavior** without new dependency unless existing primitives cannot support it; verify `npm run test -- src/note/NotesRoute.test.tsx src/note/NoteEditorNavigationGuard.test.tsx src/note/NoteEditorPage.test.tsx`.
- [ ] **8. Commit:** `git add client/src/note && git commit -m "fix(notes): preserve navigation origin and modal accessibility"`.

## Task 6 — Browser regression suite for actual failures

**Files:** Extend `client/e2e/notes-editing.spec.ts` and `notes-browsing.spec.ts`. Prefer existing Playwright request interception and synthetic QA fixtures.

- [ ] **1. Write browser test for logout unsent:** control fake clock, type during debounce, click Sign out, choose explicit unsent discard; assert zero Note mutations and successful logout, no resumed draft after same-user login.
- [ ] **2. Write browser test for logout in-flight:** hold PATCH and request Sign out; verify copy says changes may save, no fake discard, choose wait; release PATCH; verify it saved and only then logout proceeds. Include failed/uncertain write and logout API failure paths.
- [ ] **3. Write browser test for stale Notes listing:** create Note and edit title, return to previous list without reload; count and title refresh, Cards/List and loaded pagination/scroll remain valid.
- [ ] **4. Write browser test for blank status:** untouched `/notes/new` does not display Saved and makes zero POST; title/body entry saves and only then displays Saved.
- [ ] **5. Write browser test for lifecycle:** focus/visibility reverify while PATCH pending, assert same Tiptap element and content/caret, no false 409 after confirmed own write; actual unexpected 401 then verified same-user Resume reconciles prior write; account switch is isolated.
- [ ] **6. Write browser test for conflicts/routes:** Load-latest pending GET cannot drop later edits; Keep uses fresh server version; direct Note A→B updates correct ID; bookmarked new→created Back stays inside Notes; editor scroll starts at top.
- [ ] **7. Run targeted E2E:** `npm run test:e2e -- notes-editing.spec.ts notes-browsing.spec.ts`. Expect PASS (no manual hard reload as workaround). Add tests for each manual failure and CodeRabbit behavior before declaring resolved.
- [ ] **8. Commit:** `git add client/e2e && git commit -m "test(notes): cover manual failures and autosave lifecycle races"`.

## Task 7 — Scope hygiene, quality gate, and PR review closure

**Files:** PR discussion/review threads, and only relevant test/implementation files. No mandatory new production docs.

- [ ] **1. Run frontend verification:** `npm run verify` and `npm run test:e2e`. Expect lint/format/typecheck/build/tests/coverage and the complete E2E suite to pass. If backend unchanged, no Java/schema edits or migrations; if a genuine backend bug was found, isolate it with backend tests and document the deviation.
- [ ] **2. Recheck #70 and Tasks:** Notes Cards/List browse, archived rendering, existing Task editor and navigation/toolbar tests must remain green. Don't undo an actual Task fix to satisfy a cosmetic pre-merge check.
- [ ] **3. Resolve unrelated Task modifications consciously:** `client/src/task/TasksRouteLayout.tsx` and `client/e2e/task-detail.spec.ts` are out of scope for #71. Prefer extracting their already-isolated change to a separate Task PR if practical; otherwise retain and explicitly justify the exception in PR description. Do not introduce fresh Task work.
- [ ] **4. CodeRabbit's docstring warning:** No bulk docstrings solely for metric satisfaction. Add a concise state-invariant note to `NoteSaveCoordinator` if it materially clarifies ambiguous POST/PATCH/conflict handling. Reply that the actual SonarCloud/CI gate passed; no blanket comment churn.
- [ ] **5. Account for every inline thread:** #4521761865 (synchronous leave), #4521761867 (editor retention), #4521761871 (scroll), #4521761878 (origin), #4521761888 (discard restash). Reply with test name and commit SHA; mark resolved only once verified.
- [ ] **6. Account for the manual verification comment:** reproduce/fix/test three genuine failures; explicitly defer Tag tests to #72 with link. Keep the already passed browser cases passing.
- [ ] **7. Self-review diff vs original plan and scope:** no Tag selector, no attachment/image upload, no fake recovery after crash, no content storage, no new unnecessary architecture; check race-sensitive closures and owner provenance.
- [ ] **8. Update PR description/checklist** with remediation commits, test commands/results, and precise sign-out UX wording. Ask for repeat manual testing of the three original failures; do not claim verified before testing.

## Completion / reviewer acceptance criteria

- [ ] No possibility for *this client* to dispatch an unsent autosave after a confirmed discard; an already-issued server write is never described as reversible.
- [ ] Session focus/reverification never unmounts a same-owner editor; owner mismatch/actual logout cannot reveal or send prior owner's draft.
- [ ] Each editing session is bound to exactly one Note ID, except successful new→same-created-ID transition.
- [ ] CodeRabbit's five issues fixed with regression evidence.
- [ ] Stale listing/count and false blank `Saved` fixed in browser without hard refresh.
- [ ] Conflict resolution and expiry reconciliation preserve newest edits and use explicit owner/version checks.
- [ ] No Tags feature added (#72 remains independent).
- [ ] All frontend CI and E2E checks pass, with human browser retest of the three failures.

**Handoff:** Execute tasks in order on `feat/71-notes-rich-editing-autosave`. Use **inline `superpowers:executing-plans` only—no subagents**. The plan gives remediation expectations; no production-code fixes were made when this file was added.
