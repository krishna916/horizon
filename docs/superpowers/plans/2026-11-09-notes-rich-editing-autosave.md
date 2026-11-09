# Notes Rich Editing and Autosave (#71) Implementation Plan

> **For Luna:** REQUIRED SUB-SKILL: `superpowers:executing-plans`, executed **inline/native only**. Never spawn subagents. Work task by task with red/green tests, small commits and review checkpoints.

**Goal:** Implement the #68-approved full-page Notes rich editor, title/body autosave and reliable conflict/session handling.

**Architecture:** Reuse Horizon's React 19/Tiptap 3 editor and #69 owner-scoped Notes APIs. Keep a single serialized, idempotent save coordinator for each editing session; preserve only an owner-bound in-memory recovery snapshot above authenticated route remounts. The existing Spring Boot Note API is sufficient; no offline store, Tag implementation, attachments or images.

**Stack:** React 19, TypeScript 6, TanStack Router + Query, Axios, Tiptap 3, Vitest/Testing Library, Playwright; existing backend Java/Spring Boot.

**Spec:** `docs/design/notes-workspace/DESIGN-SPEC.md` (approved #68) and issue #71, including its explicit scope, draft, conflict and session decisions. `PRD-005 Notes` and `SPEC-001` apply where not superseded. Dependencies: #69, #70, #43. Follow-ons: #72, #78, #79.

## Global constraints

- **Scope:** #71 supports title/body rich text only. #72 owns Tag selection, Tag-only staging, shared Tag side effects, atomic first-create Tag assignment and cross-workspace tests. #78/#79 own attachment/image flows. Do not build those in #71.
- **UX:** Full-page edit from Cards/List without a side panel; nullable title; placeholder/`Untitled note` is display-only. Untouched, whitespace-only editor never creates a Note. Meaningful title-only or body-only input creates one Note; body-only title remains null. Existing archived Notes remain editable.
- **Save:** `Saving…`, `Saved`, `Save failed` + Retry in #68's top action row. Start with a tunable 900ms idle debounce. Serialize POST/PATCH; no response can replace newer local edits, reset caret or falsely mark a dirty draft saved.
- **Recovery:** only in application memory for active editing and unexpected expiry. No Note content in browser localStorage, sessionStorage, IndexedDB, Query cache or persistent recovery service. In-app navigation requires save/wait/retry or stay. Browser unload warning is best effort; crash/refresh loses unsaved work.
- **409 policy:** Pause autosave, preserve latest local edits, expose **Keep my version** and **Load latest version** with explicit confirmation. Keep = fresh GET and user-authorized versioned overwrite; Load = explicit local discard and fresh GET. Repeated conflicts remain conflicts; no automatic merge.
- **Authentication:** On unexpected `401`, suspend writes/hide draft; same verified owner may recover it after login. Explicit sign-out (including cross-tab sign-out) or different verified owner discards it. Reconcile server/creation state before writing after relogin.
- **Server contract:** `POST /api/v1/notes` requires canonical UUID `Idempotency-Key` with `title`/`content`. `PATCH /api/v1/notes/{id}` uses `expectedVersion` and updated fields; GET returns `version`. The backend normalizes blank titles to null; ``table``/`horizontalRule` are meaningful Tiptap structures. Owner checks, optimistic locking, validation and idempotency already exist in #69.
- **Engineering:** Follow `client/AGENTS.md`, `ENG-002` and existing feature-module layout; no new editor/framework; don't hand-edit generated router tree. Test first and commit individually. Preserve #70's owner-keyed browse state, return origin, sort, view and scroll.

## File responsibility map

| Location | Responsibility |
| --- | --- |
| `client/src/note/types.ts`, `api.ts`, corresponding tests | Typed Note create/update, UUID header, existing response DTOs |
| `client/src/note/noteDraft.ts`, `noteDraft.test.ts` | Pure title/body normalization, meaningful-draft and rich-text equality |
| `client/src/note/NoteSaveCoordinator.ts`, `NoteSaveCoordinator.test.ts` | Debounce, frozen POST snapshot/key, serial PATCH, versions, retry, error/conflict, reconcile |
| `client/src/note/useNoteAutosave.ts`, test | React bridge, authenticated transport, owner-scoped Query invalidation, safe cleanup |
| `client/src/note/NoteDraftRecoveryProvider.tsx`, test | One in-memory owner-bound draft across route/session unmount; never persistent |
| `client/src/user/session/AuthSessionProvider.tsx`, `sessionMarker.ts`, `client/src/user/hooks/useLogoutUser.ts` (+ tests) | Separate expiry, explicit logout, cross-tab logout, owner identity |
| `client/src/note/NoteEditorPage.tsx`, test | Approved editor layout, title/Tiptap, status, retry, conflict actions |
| `client/src/components/rich-text/RichTextEditor.tsx`, test | Keep editor mounted/caret stable during acknowledgments, explicit replacement only |
| `client/src/note/NoteEditorNavigationGuard.tsx`, test | Router/back/links and beforeunload guard |
| `client/src/note/NotesRoute.tsx`, `NotesWorkspacePage.tsx`, Notes leaf routes (+ tests) | Stable new→persisted edit host, origin and same-owner Resume |
| `client/e2e/notes-editing.spec.ts` | End-to-end save races, auth, conflicts, navigation and accessibility |

## Review focus

1. **Typing during slow first POST:** exactly one creation, same idempotency key/body on retry, later edits serialized as PATCH.
2. **Server commits PATCH but response is lost:** fresh GET reconciliation; no blind overwrite or duplicate version update.
3. **Expiry during save:** old owner content hidden, same-owner recovery allowed, different owner and explicit logout cleared.
4. **New route becomes persisted ID:** no editor remount or caret movement, and no duplicate browser Back entry.
5. **Typing while conflict paused:** edits accumulate locally but no PATCH until confirmed choice, including a repeated 409.

---

### Task 1: Typed HTTP mutations and draft semantics

**Files:** Modify `client/src/note/api.ts` and `types.ts`; create `client/src/note/noteDraft.ts`, `noteDraft.test.ts`; modify/create `api.test.ts`.

**Interfaces:**
- `type NoteDraft = {title:string;content:RichTextDocument|null}`.
- `normalizeNoteDraft(draft:NoteDraft):{title:string|null;content:RichTextDocument|null}`; `hasMeaningfulNoteDraft(draft):boolean`; `noteDraftsEqual(a,b):boolean`. Reuse `normalizeRichTextDocument` and `richTextDocumentsEqual`. Match Java `NoteContentPolicy.isWhitespace` behavior for deciding initial creation; title max length 255 remains server-validated.
- `noteApi.create(body:{title:string|null;content:RichTextDocument|null}, key:string)` POST and `noteApi.update(id:number, body:{expectedVersion:number;title?:string|null;content?:RichTextDocument|null})` PATCH, both returning Axios `NoteDetail`.

- [ ] **1. Write red tests:** blank/whitespace-only title/body produces zero meaningful content; title-only, body-only, table and horizontal rule are meaningful; null/empty rich text normalizes; fallback never enters payload; nullable title remains nullable.
- [ ] **2. Verify red:** `cd client && npm run test -- src/note/noteDraft.test.ts src/note/api.test.ts`.
- [ ] **3. Implement helpers and Axios create/update** using existing `apiClient`. Test exact endpoints, UUID header, `expectedVersion`, no Tag calls or invented fields.
- [ ] **4. Verify green:** same command, expect PASS.
- [ ] **5. Commit:** `git add client/src/note && git commit -m "feat(notes): add mutation API and meaningful draft checks"`.

### Task 2: Serialized, idempotent autosave coordinator

**Files:** Create `client/src/note/NoteSaveCoordinator.ts` and `NoteSaveCoordinator.test.ts`.

**Interfaces:** `NoteSavePhase = 'clean'|'dirty'|'saving'|'saved'|'failed'|'conflict'|'paused'`; `NoteSaveSnapshot = {draft:NoteDraft;localRevision:number;confirmedRevision:number;persisted:{id:number;version:number}|null;phase:NoteSavePhase;hasUnsavedChanges:boolean}`. `NoteTransport = {create:(body:ReturnType<typeof normalizeNoteDraft>,key:string)=>Promise<NoteDetail>;update:(id:number,body:{expectedVersion:number;title:string|null;content:RichTextDocument|null})=>Promise<NoteDetail>;get:(id:number)=>Promise<NoteDetail>}`.

`NoteSaveCoordinator` constructor accepts `{initialDraft,initialNote,transport,onChange,onCreated?,debounceMs?:number}`; expose `edit(draft):void`, `flush():Promise<void>`, `retry():Promise<void>`, `pause():void`, `resume():Promise<void>`, `dispose():void` and `snapshot():NoteSaveSnapshot`. Snapshot each dispatched request with its **localRevision**; only acknowledge that revision on success. Never copy acknowledged server content over a newer local draft. One request in flight per Note.

- [ ] **1. Red tests:** untouched new draft sends no POST; first meaningful change fires one POST after tunable idle debounce; an edit while POST pending queues **one PATCH** with returned version. Later local revisions survive stale acknowledgment.
- [ ] **2. Verify red:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts`.
- [ ] **3. Implement create sequencing:** mint one canonical UUID at first POST; freeze key/body for all retries, even on timeout/unknown outcome. Never create a second Note with a fresh key after ambiguous failure. Do not send overlapping saves.
- [ ] **4. Red update tests:** rapid edits collapse into a single update, in-flight change queues next versioned PATCH, clearing title sends null, no-op skips write, updated server version advances only when confirmed.
- [ ] **5. Implement PATCH scheduling**, then test ordinary 5xx/error/Retry, safe discard of stale response callbacks, no automatic failure retry loop.
- [ ] **6. Red timeout test:** PATCH response lost after commit; reconciliation fresh GET notices matching sent snapshot and acknowledges; unchanged version permits retry; mismatched newer server version enters conflict.
- [ ] **7. Implement ambiguous-outcome reconciliation and verify green:** same test command, expect PASS.
- [ ] **8. Commit:** `git add client/src/note/NoteSaveCoordinator* && git commit -m "feat(notes): coordinate safe serialized autosave"`.

### Task 3: Explicit version conflict flow

**Files:** Extend `NoteSaveCoordinator.ts` and `NoteSaveCoordinator.test.ts`.

**Interfaces:** `resolveConflict(choice:'keep-local'|'load-server'):Promise<void>`, invoked **after UI confirmation**, never automatically. Keep-local performs fresh owned GET and versioned PATCH of the **latest** local draft. Load-server performs GET then intentionally replaces draft/baseline/version. Repeated 409 stays conflicted; invalid/foreign Note remains generic unavailable.

- [ ] **1. Red tests:** PATCH 409 pauses autosave; typing while paused sends zero requests. Keep-local uses GET's latest version and most recent typed data; another 409 retains conflict and draft.
- [ ] **2. Verify red:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts`.
- [ ] **3. Implement resolution** with generation/owner validation and serialized writes. Network error while fetching latest retains local draft instead of clearing.
- [ ] **4. Red tests:** Load-server explicitly replaces only after user confirmation and a successful fresh GET; rejected GET or owner change cannot overwrite current draft.
- [ ] **5. Implement load and verify green:** same command.
- [ ] **6. Commit:** `git add client/src/note/NoteSaveCoordinator* && git commit -m "feat(notes): require explicit conflict resolution"`.

### Task 4: Safe in-memory session-expiry recovery

**Files:** Create `client/src/note/NoteDraftRecoveryProvider.tsx` and tests; modify `client/src/App.tsx`, `client/src/user/session/AuthSessionProvider.tsx`, `sessionMarker.ts`, `client/src/user/hooks/useLogoutUser.ts` and tests.

**Interfaces:** Wrap `SessionOwnedTree` **inside** `NoteDraftRecoveryProvider`, itself inside `AuthSessionProvider`. The existing `SessionOwnedTree` changes key on owner revision, so mounting recovery below it would lose a draft on 401. Provider exposes `stash(ownerId,editorRoute,draft,persistedVersion?,frozenCreateRequest?)`, `peekForVerifiedOwner(id)`, `consumeForVerifiedOwner(id)`, `discard()`; one active unsaved draft only.

Add a small explicit-logout signal to AuthSession context, separate from 401 and ownerRevision. For other-tab explicit sign-out, extend existing opaque session marker with **logout intent only** (backward compatible with random opaque markers; never user ID/Note content). Only verified owner may access a retained draft. On re-login, GET/reconcile first; never trust old session responses. Refresh/restart loses memory.

- [ ] **1. Red tests:** unexpected 401 hides yet retains unsaved owner-1 draft through authenticated route unmount; fresh verified owner 1 can recover; owner 2, explicit logout and cross-tab sign-out marker discard. Same-owner focus verification does not erase. Zero Note-content storage writes.
- [ ] **2. Verify red:** `cd client && npm run test -- src/note/NoteDraftRecoveryProvider.test.tsx src/user/session/AuthSessionProvider.test.tsx src/user/session/sessionMarker.test.ts`.
- [ ] **3. Implement provider and minimal auth reason/sign-out marker changes** with editor generation invalidation. Ensure no draft renders on login, after explicit logout or to an unverified user. Keep existing Task session behavior unchanged.
- [ ] **4. Verify green:** same command; add test for expired session while initial POST is unresolved, preserving frozen key/body for retry.
- [ ] **5. Commit:** `git add client/src/App.tsx client/src/note/NoteDraftRecoveryProvider* client/src/user && git commit -m "feat(notes): retain memory-only drafts for same-user login"`.

### Task 5: React hook and owner-bound cache coordination

**Files:** Create `client/src/note/useNoteAutosave.ts` and `useNoteAutosave.test.tsx`; modify `client/src/note/queries.ts` only if reuse requires it.

**Interfaces:** `useNoteAutosave({ownerId,initialNote,onCreated})` returns `{snapshot,edit,flush,retry,resolveConflict,canLeave}`. Adapt Axios responses to coordinator transport. While session not freshly `verified`, pause writes. On confirmed save, refresh/update only matching owner Note/list Query state; never replace a dirty editor from Query cache.

- [ ] **1. Red tests:** create/update invalidate correct owner Note list/detail but not other-owner cache; no per-card detail refetch; no dirty content reset on server response or background Query refresh.
- [ ] **2. Verify red:** `cd client && npm run test -- src/note/useNoteAutosave.test.tsx`.
- [ ] **3. Implement hook** with `useAuthSession`, `noteQueryKeys`, coordinator subscriptions and cleanup. No global autosave event bus.
- [ ] **4. Red tests:** focus re-verification increments epoch while PATCH pending; reject stale callbacks, re-fetch/reconcile before resuming verified same-user writes; account switch cancels pending timers and cache updates.
- [ ] **5. Implement validation and verify green:** same command.
- [ ] **6. Commit:** `git add client/src/note && git commit -m "feat(notes): bind save coordinator to authenticated Query state"`.

### Task 6: Full-page rich Note editor and state UI

**Files:** Create `client/src/note/NoteEditorPage.tsx` and `NoteEditorPage.test.tsx`; modify `client/src/components/rich-text/RichTextEditor.tsx` and tests.

**Interfaces:** `NoteEditorPage({routeNoteId,onBack})` renders #68's centered full-page document (808px outer / ~736px text), title → metadata → visible compact Tiptap toolbar → body. Keep the top Back/status/Retry row visible. No working Tags/files/images controls in #71; reserve future seams without speculative APIs. RichTextEditor must preserve mounted editor/caret during onChange and save acknowledgment; use explicit external-replacement token only for first-load and confirmed Load-latest.

- [ ] **1. Red UI tests:** new empty draft makes zero mutations; title-only/body-only save correctly; blank title never gets `Untitled note` stored; archived Notes edit; visible Saving/Saved/Save failed/Retry, accessible title/body.
- [ ] **2. Verify red:** `cd client && npm run test -- src/note/NoteEditorPage.test.tsx`.
- [ ] **3. Implement editor** reusing existing safe rich text extensions, toolbar and theme tokens; no separate editor implementation or Save button.
- [ ] **4. Red caret tests:** a stale server ack cannot call Tiptap `setContent` or jump selection while typing; explicit server Load-latest updates once. Existing Task editor tests must remain green.
- [ ] **5. Implement minimal RichTextEditor change** and verify both Note and shared rich-text tests.
- [ ] **6. Red conflict UI tests:** 409 shows Keep/Load actions and pauses; both require confirmation; Keep uses latest draft; Load discards only on confirmed successful GET; repeat conflict remains visible.
- [ ] **7. Implement conflict UI and verify green:** `cd client && npm run test -- src/note/NoteEditorPage.test.tsx src/components/rich-text/RichTextEditor.test.tsx`.
- [ ] **8. Commit:** `git add client/src/note client/src/components/rich-text && git commit -m "feat(notes): add full-page rich editor and save states"`.

### Task 7: Route continuity, guards and recovery entry

**Files:** Create `client/src/note/NoteEditorNavigationGuard.tsx` and test; modify `client/src/note/NotesRoute.tsx`, `NotesWorkspacePage.tsx`, `routes/_authenticated/notes.new.tsx`, `routes/_authenticated/notes.$id.tsx`; update former read-only/placeholder component tests.

**Interfaces:** Keep **one parent-hosted editor** under `NotesRoute` when path changes from `/notes/new` to `/notes/{id}`, rather than separate editor leaf components (which would remount Tiptap). After first confirmed create, `navigate({replace:true})` to canonical ID; preserve trusted origin in history and caret. Existing direct ID GET, invalid/403/404 generic unavailable, and #70 browse state remain intact.

Guard user Links/history/Back when dirty, saving, failed or conflicted: Stay, or Retry/Wait until confirmed save then leave. Use current TanStack Router blocker and native beforeunload. Bypass only trusted internal create→id replacement and forced auth redirect. Notes workspace exposes **Resume unsaved note** after same-owner verification (no auth-page draft rendering); different owner sees nothing. Explicit logout with unsaved work requires an explicit discard warning.

- [ ] **1. Red tests:** user navigation while dirty/in-flight/failed/conflicted is blocked, Stay preserves edits, Retry/Wait eventually leaves after save, untouched blank draft leaves freely; beforeunload listener tracks dirty state.
- [ ] **2. Verify red:** `cd client && npm run test -- src/note/NoteEditorNavigationGuard.test.tsx`.
- [ ] **3. Implement blocker and guarded Back** without changing unrelated Tasks navigation. Ensure session-expiry redirect isn't trapped by a stale blocker.
- [ ] **4. Red routes:** new route does not create on mount; after POST URL replaces to ID with **same mounted Tiptap instance**, Back restores origin Cards/List view and scroll; direct ID and invalid/foreign IDs behave safely.
- [ ] **5. Implement parent editor host and update leaf routes**; regenerate router tree only if needed, never edit generated code by hand.
- [ ] **6. Red recovery tests:** after expiry and same-owner login, Resume restores memory draft and reconciles server version; different owner/explicit logout gets no Resume. Restoring a changed version enters explicit conflict.
- [ ] **7. Implement resume entry and verify green:** `cd client && npm run test -- src/note/NoteEditorNavigationGuard.test.tsx src/note/NoteDetailPage.test.tsx src/note/NotesWorkspacePage.test.tsx && npm run typecheck`.
- [ ] **8. Commit:** `git add client/src/note client/src/routes/_authenticated client/src/routeTree.gen.ts && git commit -m "feat(notes): guard navigation and keep editor across first save"`.

### Task 8: E2E acceptance, regression and review

**Files:** Create `client/e2e/notes-editing.spec.ts`; adapt #70 Notes browsing/rich text/session tests where necessary. Backend #69 tests remain canonical unless a demonstrated backend contract gap needs an isolated fix.

- [ ] **1. Red Playwright scenarios:** untouched new Note issues no POST; title-only/body-only creates; content survives reload **after confirmed save**; full-page edit from Cards/List and archived collections preserves origin and scroll.
- [ ] **2. Race tests:** hold first POST while typing, verify one ID and serial PATCH; retry ambiguous POST with identical UUID/body; hold PATCH while typing, newest edit persists, caret stays put; lost PATCH response reconciles.
- [ ] **3. Conflict tests:** second writer causes 409, no automatic overwrite, Keep/Load require confirmation, edits while paused preserved, repeated 409 stays paused.
- [ ] **4. Failure/session tests:** 503/timeout and Retry, 401→same-owner Resume, 401→other-owner cleared, explicit logout clears, zero Note content persisted in storage, malformed/foreign ID generic unavailable.
- [ ] **5. Navigation/a11y:** router Link/Back guarded, browser unload warning best effort, mobile/editor keyboard semantics, toolbar accessible, no synthetic title or panel.
- [ ] **6. Run targeted E2E:** `cd client && npm run test:e2e -- notes-editing.spec.ts`; expect PASS.
- [ ] **7. Run regression gates:** `cd client && npm run verify && npm run test:e2e` (including `notes-browsing.spec.ts`). If Java code changed, run backend module tests and integration suite per repository guide.
- [ ] **8. Final scope review:** verify #68 layout, #71 three policies, no #72/#78/#79 implementation, no browser-content storage, no Task editor regressions. Summarize tests and any deviations in PR.
- [ ] **9. Commit:** `git add client && git commit -m "test(notes): cover editing and autosave end to end"`.

## Handoff and completion gate

Luna should read #71, #68's approved design spec, #69/#70 API/browser behavior, `client/AGENTS.md` and this plan before code. Work on the feature branch using inline `superpowers:executing-plans`, implement all tasks with tests/commits, and open a PR linking #71 for human review. Do **not** start implementing merely because a plan was added; seek plan approval first. Future #72 extends the same save coordinator for staged tags and atomic first-create Note+Tags; #78/#79 hook in media sequencing later.
