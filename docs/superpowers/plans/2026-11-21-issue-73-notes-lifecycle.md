# Issue #73 — Notes Lifecycle Implementation Plan

> **For Luna / agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`, inline/native **without subagents**, task by task. Follow `superpowers:test-driven-development` and `superpowers:verification-before-completion`. Read this plan, the linked design, and the repository agent guides before touching code. **Owner review of this plan is required before Task 1.** Do not merge without approval.

**Goal:** Deliver version-aware Note archive, unarchive, soft-delete and deleted-restoration with Card/List/full-page actions, safe autosave coordination, persistent Undo, owner isolation and accurate workspace visibility.

**Architecture:** Add lifecycle methods to the current Note aggregate, transactional command service and existing controller. Use the existing `@Version` field and owner-scoped repository, then a Notes-route-local frontend lifecycle coordinator that reconciles TanStack Query and works *through* `NoteSaveCoordinator` for editor actions. Extend only the current Notes vertical slice; no new lifecycle platform.

**Tech stack:** Java 25 / Spring Boot 4.0.6 / Maven / PostgreSQL 17 / JPA / JUnit / Testcontainers; React 19 / TypeScript / Axios / TanStack Query + Router / Tiptap / Tailwind / Vitest / RTL / Playwright.

**Issue:** [#73](https://github.com/krishna916/horizon/issues/73). **Branch:** `feature/73-notes-lifecycle`. **Spec:** [2026-11-21-issue-73-notes-lifecycle-design.md](../specs/2026-11-21-issue-73-notes-lifecycle-design.md). **UX:** [#68 Notes DESIGN-SPEC.md](../../design/notes-workspace/DESIGN-SPEC.md).

## Global constraints

- Owner-approved on 2026-11-21: quick lifecycle actions on Cards/List **and** full-page; all lifecycle mutations version-aware; flush pending saves before editor lifecycle; persistent Undo and Trash confirmation. These are not optional implementation suggestions.
- Exact HTTP transport is an **engineering proposal for owner review of this plan**, not an additional previously approved product decision: require `X-Expected-Version` as a nonnegative decimal header on all four commands. `POST /api/v1/notes/{id}/archive`, `POST /api/v1/notes/{id}/restore`, `POST /api/v1/notes/{id}/restore-deleted` return `200 NoteDetailResponse`; `DELETE /api/v1/notes/{id}` returns `200 NoteDeletionReceipt {id,version}`. The DELETE body is omitted; receipt supplies the confirmed version for Undo. Keep `PATCH expectedVersion` unchanged and return `409` on stale commands.
- Use current Notes #68 navigation: Cards/List → **full-page**, no Note side panel. Approved separate Active/Archived controls and per-user/device Card/List preference remain. Older PRD-005/PRD-000/Constitution panel-first/required-title wording must **not** be silently applied.
- Facts not states: existing `archived_at`, `deleted_at`, `inbox` and JPA `version`. No status enum, schema migration, tag mutation, new global store or new dependency. Archive/restore/soft-delete/Trash restoration change only intended fact plus `updated_at` and JPA version on a real state change. Archive, delete and restore preserve Tags, title, content and Inbox fact.
- Archived Notes remain editable; deleted Notes disappear from ordinary GET, PATCH, list/count and future Search. Foreign/missing/inaccessible resources have indistinguishable `404`; authentication `401`; malformed version `400`; optimistic conflict `409` with RFC 9457 Problem Details.
- Only the future Epic #9 performs permanent deletion. #77 physical cleanup and #78/#79 media integration remain out of scope. Archive/soft delete must not invoke file deletion; media retention/access tests are deferred until files exist. Note Tag filters are separate #89, global Search #74.
- Read `Agents.md`, `client/AGENTS.md`, `server/AGENTS.md`, `docs/ai/INDEX.md` and relevant ENG guidelines. Run repository `align-context`, `testing-spring-integration` and `testing-frontend` skills as applicable. Existing implementation takes precedence over outdated condensed stack/docs (Java 25 and Spring Boot 4.0.6 now).
- Work only on `feature/73-notes-lifecycle`. Write a failing test, verify RED, implement, verify GREEN, self-review and commit at each task. Execute inline, no subagents. Never invent product decisions; escalate conflicts; never claim a test passed without running it.

## Source reconciliation

| Accepted behavior | Authority | Task |
| --- | --- | --- |
| Factual lifecycle; restoration preserves original archive/Inbox | SPEC-001, PRD-008, #73 | 1, 2 |
| Archived editable; deleted hidden; owner-safe access | PRD-005, #69, #73 | 1, 2, 8 |
| Direct full-page; Card/List; Active/Archived counts; context return | Approved #68, #70 | 3, 5, 6, 8 |
| Version conflict + autosave/draft safety | #69, #71, approved decisions | 1–4, 6 |
| Persistent Undo and delete confirmation | Approved #73 decisions and #23 precedent | 3, 5–8 |
| Tags/Inbox unaffected; media retained but integration deferred | SPEC-001, #72, #77–#79 | 1, 2, 8 |

## Exact file map

- Domain: `server/src/main/java/com/krishnamurti/horizon/note/domain/Note.java`.
- Application/persistence: `server/src/main/java/com/krishnamurti/horizon/note/application/NoteCommandService.java`, `infrastructure/NoteRepository.java`.
- HTTP/recovery: `server/src/main/java/com/krishnamurti/horizon/note/web/NoteController.java`, `NoteRequestMapper.java`; create `NoteDeletionReceipt.java` and `note/api/NoteRecoveryApi.java`, `NoteRecoverySnapshot.java`.
- Frontend API/state: `client/src/note/api.ts`, `types.ts`, `queries.ts` if needed; create `NoteLifecycleProvider.tsx`, `NoteLifecycleActions.tsx`, `NoteLifecycleNoticeList.tsx`.
- Frontend UI/integration: `client/src/note/NoteSaveCoordinator.ts`, `useNoteAutosave.ts`, `NoteCard.tsx`, `NoteListRow.tsx`, `NoteEditorPage.tsx`, `NotesRoute.tsx`; update guards/pages only where integration requires.
- Tests live adjacent to current Note tests; add `client/e2e/notes-lifecycle.spec.ts`. Do not move `client/src/note` into a new module folder.

## Review Focus: five high-risk failures

1. A PATCH completes while Archive starts: lifecycle uses *acknowledged* version; caret/editor is not reset (Task 4).
2. DELETE commits but its response is lost: no guessed success or guessed Undo version; exact duplicate retry obtains real server receipt without a second version increment (Tasks 1–3).
3. Archived Note → Trash → Undo retains `archived_at`, `inbox`, Tags and content, returns to Archived, not Active (Tasks 1–3, 8).
4. Late infinite-list refetch after Archive/Delete cannot resurrect an obsolete row or leak an old owner's Note (Task 3).
5. Session or owner changes during autosave/Undo cannot dispatch under wrong owner, expose stale data, or notify success to a different account (Tasks 3–4, 6–8).

---

### Task 1: Note domain, locking and transactional lifecycle

**Files:** Modify `server/src/main/java/com/krishnamurti/horizon/note/domain/Note.java`, `application/NoteCommandService.java` and `infrastructure/NoteRepository.java`. Test `server/src/test/java/com/krishnamurti/horizon/note/domain/NoteTest.java` and `application/NoteCommandServiceIntegrationTest.java`.

**Interfaces:**
- `Note.archive(OffsetDateTime when):void`; `restoreArchived():void`; `softDelete(OffsetDateTime when):void`; `restoreDeleted():void`. Set/clear only corresponding fact; repeated same-state operation with matching current version is no-op.
- `NoteCommandService.archive(Long id,long expectedVersion):Note`; `restoreArchived(Long id,long expectedVersion):Note`; `softDelete(Long id,long expectedVersion):Note`; `restoreDeleted(Long id,long expectedVersion):Note` — `@Transactional`, use `CurrentUserProvider`.
- Existing `NoteRepository.lockOwnedForTagWrite(id,userId)` for non-deleted operations. Add `lockOwnedIncludingDeleted(Long noteId,Long userId):Optional<Note>` with `PESSIMISTIC_WRITE` for soft delete and deleted restore. All queries owner-scoped.
- If current version differs from requested, throw existing `NoteVersionConflictException`, except an *exact duplicate* delete acknowledgment: already-deleted Note with current version equal to submitted version + 1 returns existing deleted Note without another mutation; older/different stale requests fail. Guard positive/overflow arithmetic rather than blindly incrementing `Long.MAX_VALUE`. The exception exists only to resolve a lost DELETE response.
- Actual dirty changes advance `@Version` and `updated_at` once; do not manually increment or change `BaseEntity`. Use UTC timestamp source as in existing Tasks.

- [ ] **Step 1 — RED domain:** add tests `archiveSetsOnceAndRestoreClearsOnlyArchive`, `softDeleteAndRestorePreservePreviousArchiveAndInbox`, `repeatedOperationsDoNotTouchContentOrTimestamps`.
- [ ] **Step 2 — RED service:** add `lifecycleAdvancesVersionExactlyOnce`, `matchingVersionNoOpDoesNotAdvanceVersion`, `staleVersionConflicts`, `deleteCanBeRetriedAfterLostResponse`, `olderStaleDeleteIsRejected`, `deletedCannotBeArchivedOrPatched`, `foreignAndMissingAreIndistinguishable`; include Note Tags via existing Note Tag test fixtures.
- [ ] **Step 3 — run RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteTest,NoteCommandServiceIntegrationTest test`. New tests fail on missing methods/behavior, not infrastructure setup.
- [ ] **Step 4 — implement GREEN:** add exact methods and owner locks; use save-and-flush, existing error types and `@Version`. Archive/soft delete never touch file associations/Tag associations or call File cleanup.
- [ ] **Step 5 — run GREEN:** same command; inspect real PostgreSQL version/updated_at/no-op assertions. If duplicate-retry semantics cannot be proven with actual Hibernate version behavior, stop and escalate instead of guessing.
- [ ] **Step 6 — commit:** `git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(note): add version-aware lifecycle commands"`.

### Task 2: HTTP endpoints and future Trash recovery contract

**Files:** Modify `server/src/main/java/com/krishnamurti/horizon/note/web/NoteController.java`, `NoteRequestMapper.java` (reuse `NoteExceptionHandler.java`). Create `web/NoteDeletionReceipt.java`, `note/api/NoteRecoveryApi.java`, `NoteRecoverySnapshot.java`. Test `server/src/test/java/com/krishnamurti/horizon/note/web/NoteControllerIntegrationTest.java` and `application/NoteQueryServiceIntegrationTest.java`.

**Interfaces:**
- `NoteRequestMapper.parseExpectedVersionHeader(String raw):long` validates missing/blank/non-decimal/negative/overflow values; throws `NoteRequestValidationException("X-Expected-Version",...)` → RFC 9457 400.
- `NoteDeletionReceipt(Long id,long version)` gives post-delete version without exposing document content.
- `NoteRecoveryApi.restoreDeletedNote(Long noteId,long expectedVersion):NoteRecoverySnapshot`; `NoteRecoverySnapshot(Long id,long version,boolean archived)`. Implement in Note command layer for future Trash use through `note.api`, not internal repository.
- Existing `NoteController` adds `archive(id,rawHeader)`, `restoreArchived(id,rawHeader)`, `softDelete(id,rawHeader)`, `restoreDeleted(id,rawHeader)`. Actions use Task 1 and existing `NoteResponseMapper.toDetail` with owner Tags; the DELETE path must **not** use normal Note GET after deletion.
- Preserve existing POST/PATCH/GET/list contract and pagination. Ordinary reads/updates continue filtering `deleted_at IS NULL`; recovery-only path can access owned deleted resource.

- [ ] **Step 1 — RED API:** tests `archiveAndRestoreReturnDetailAndExpectedVersion`, `deleteReturnsReceiptAndHidesNormalReads`, `restoreDeletedReturnsOriginalArchiveAndTagSet`, `missingOrMalformedHeaderReturns400`, `staleHeader409`, `foreignAndMissingLifecycle404`, `unauthenticatedLifecycle401`, `duplicateDeleteReturnsConfirmedVersion`.
- [ ] **Step 2 — RED collection:** test Active/Archived counts and list exclusion; archived PATCH remains allowed; archive→delete→restore returns original collection; Inbox and Tags unchanged; regular GET/PATCH deleted Note return `404`.
- [ ] **Step 3 — run RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteControllerIntegrationTest,NoteQueryServiceIntegrationTest test`.
- [ ] **Step 4 — implement GREEN:** endpoints in **existing** NoteController, header parsing, response record and minimal public recovery interface. Keep existing exception handler/Problem Details, owner scoping and transactions. No per-method controllers.
- [ ] **Step 5 — run GREEN:** targeted command, then `./mvnw -Duser.timezone=UTC -Dtest=NoteTagAssignmentServiceIntegrationTest,NotePersistenceIntegrationTest test`. Verify no migration/new status introduced.
- [ ] **Step 6 — commit:** `git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(note): expose lifecycle and recovery REST actions"`.


### Task 3: Typed frontend API and Note-scoped lifecycle/Undo coordinator

**Files:** Modify `client/src/note/api.ts`, `types.ts`, `queries.ts` only if necessary. Create `NoteLifecycleProvider.tsx` and `NoteLifecycleProvider.test.tsx`; extend `api.test.ts` and `queries.test.tsx`.

**Interfaces:**
- `type NoteLifecycleOperation = 'archive' | 'restore' | 'delete'`; `type NoteLifecycleTarget = Pick<NoteSummary,'id'|'version'|'archivedAt'>`; `type NoteDeletionReceipt = {id:number;version:number}`.
- `type NoteLifecycleResult = {kind:'note';note:NoteDetail} | {kind:'deleted';receipt:NoteDeletionReceipt}`.
- `noteApi.archive(id:number,version:number):Promise<AxiosResponse<NoteDetail>>`; `restoreArchived` same; `softDelete(id:number,version:number):Promise<AxiosResponse<NoteDeletionReceipt>>`; `restoreDeleted(id:number,version:number):Promise<AxiosResponse<NoteDetail>>`. Every request sends `X-Expected-Version`.
- `useNoteLifecycle()` exposes `run(ownerId:number,target:NoteLifecycleTarget,operation:NoteLifecycleOperation):Promise<NoteLifecycleResult|null>`; `undo(noticeId:string):Promise<boolean>`; `retryDelete(noticeId:string):Promise<boolean>`; `dismiss(noticeId:string):void`; `notices:readonly NoteLifecycleNotice[]`; `stateFor(ownerId:number,noteId:number):{pending:boolean;error:string|null;retry:()=>void}`.
- Provider lives within owner-keyed `NotesRoute` outside the list/editor conditional. Notice records owner ID, Note ID, operation, pre-archive fact, **returned** version, pending/error state; never rich Note content or browser storage. Notices persist only within the Notes route and vanish on owner change/route exit.
- Before success cache writes, cancel owner-specific list/detail queries. On Archive/Restore remove the note from old collection in all loaded infinite-query pages and set detail from returned response; invalidate all owner list collection/sort variants to refresh counts and order. On Delete remove normal detail/list only after confirmed receipt. On Undo use the server's **returned** version, invoke authenticated inverse route, then revalidate caches. Never synthesize bounded previews or use a global store.
- For uncertain DELETE response show `delete-unconfirmed` with Retry using original expectedVersion; a real server receipt must precede Undo. For `409` show conflict, require manual review; no silent auto-rebase. Invalidate superseded notices for same Note; two Notes retain independent notices. Before and after awaits validate owner, session epoch and owner revision; never leak private data across accounts.

- [ ] **Step 1 — RED transport:** `api.test.ts` checks path, verb, required header and responses on all four routes.
- [ ] **Step 2 — RED state:** `NoteLifecycleProvider.test.tsx` tests `archiveMovesActiveToArchived`, `restoreMovesArchivedToActive`, `deleteWaitsForReceiptBeforeUndo`, `undoArchiveUsesReturnedVersion`, `undoDeletePreservesPriorArchivedCollection`, `twoNotesKeepIndependentNotices`, `failedUndoRetry`.
- [ ] **Step 3 — RED races:** `unknownDeleteOutcomeRetryUsesOriginalVersion`, `stale409NeverAutoRebases`, `lateInfinitePageCannotResurrectDeletedNote`, `allSortsAndPageCountsInvalidate`, `ownerChangeDropsNoticesAndLateResults`, `sameNoteDoubleClickDispatchesOnce`.
- [ ] **Step 4 — verify RED:** `cd client && npm run test -- src/note/api.test.ts src/note/NoteLifecycleProvider.test.tsx src/note/queries.test.tsx`.
- [ ] **Step 5 — GREEN:** implement API/client coordinator. Look at `client/src/task/TaskLifecycleProvider.tsx` only for precedent; **do not import Task internals**.
- [ ] **Step 6 — verify GREEN:** targeted tests plus `npm run test -- src/user/session/NotesPrivateQueries.test.tsx`.
- [ ] **Step 7 — commit:** `git add client/src/note && git commit -m "feat(note): coordinate owner-safe lifecycle and Undo"`.

### Task 4: Serialize full-page lifecycle actions with existing autosave

**Files:** Modify `client/src/note/NoteSaveCoordinator.ts` and `useNoteAutosave.ts`; tests `NoteSaveCoordinator.test.ts` and `useNoteAutosave.test.tsx`.

**Interfaces:**
- `NoteSaveCoordinator.prepareLifecycleMutation():Promise<{id:number;version:number}|null>`: finish sent POST/PATCH; flush queued body/title/Tags; verify persisted identity, saved version and no pending or outcome-uncertain write, `failed`, `conflict` or `paused` phase; then hold further outgoing writes. If not confirmed, return null without pretending success. **Do not hold the existing navigation queue before flush** (that would prevent flush).
- `NoteSaveCoordinator.completeLifecycleMutation(note:NoteDetail|null):void`: accept successful archive/restore's new version and metadata without remounting/resetting TipTap or losing local draft; null denotes confirmed Delete and prevents later writes.
- `NoteSaveCoordinator.cancelLifecycleMutation():void`: release hold after failure; preserve current draft and existing Retry / Keep my version / Load latest version behavior.
- `useNoteAutosave` exposes these methods and `lifecycleBusy`; full-page controls disable Title, Tags, and existing `RichTextEditor disabled` during lifecycle preparation/mutation. If an input event sneaks in during gate startup, save that captured revision before dispatch or cancel; never silently lose it. Use the version returned by `prepareLifecycleMutation`, not stale `initialNote.version`.
- The editor remains mounted on Archive/Restore, focus/caret stay stable and later PATCH uses the acknowledged lifecycle version. Deleting shuts down future autosave only **after** server confirmation. Lifecycle 409 does not trigger automatic Keep/Load or overwrite local edits.

- [ ] **Step 1 — RED coordinator:** tests `lifecycleFlushesDebouncedTextAndTags`, `waitsForInFlightPatchAndUsesAcknowledgedVersion`, `failedOrConflictedSaveBlocksLifecycle`, `archiveResultUpdatesVersionWithoutDraftReplacement`, `cancelReleasesQueuedWrites`, `confirmedDeleteBlocksLateWrites`, `newUntouchedDraftCannotMutateLifecycle`.
- [ ] **Step 2 — RED hook:** tests lifecycle busy, editing disabled, session change while flushing and queued edits during preparation; assert no action call on save failure.
- [ ] **Step 3 — verify RED:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/useNoteAutosave.test.tsx`.
- [ ] **Step 4 — GREEN:** extend **existing** coordinator with gate and safe release; retain optimistic conflict handling, frozen POST/PATCH retries, local draft recovery, session checks, and callbacks.
- [ ] **Step 5 — verify GREEN:** targeted tests plus `NoteEditorNavigationGuard.test.tsx` and `NoteEditorPage.test.tsx`.
- [ ] **Step 6 — commit:** `git add client/src/note && git commit -m "feat(note): serialize lifecycle after autosave"`.

### Task 5: Card/List quick actions with accessible navigation

**Files:** Create `client/src/note/NoteLifecycleActions.tsx`; modify `NoteCard.tsx`, `NoteListRow.tsx`, `NotesWorkspacePage.tsx` only if required; tests `NoteCard.test.tsx`, `NoteListRow.test.tsx`, `NotesRoute.test.tsx`.

**Interface:** `NoteLifecycleActions` props `{target:NoteLifecycleTarget;placement:'card'|'list'|'editor';onDeleted?:()=>void;beforeAction?:(operation:NoteLifecycleOperation)=>Promise<NoteLifecycleTarget|null>}`. Card/List uses the summary's version; editor's beforeAction obtains the version from Task 4's confirmed flush. Menu shows Archive when active / Restore when archived, and Move to Trash in both. All delete actions need a shared accessible confirmation with Cancel.

- [ ] **Step 1 — RED:** card/list tests verify independently focusable menu **sibling** to note-opening `Link` (never nested anchor), no navigation when clicking menu, Archive vs Restore labels, Delete Cancel no API, keyboard Enter/Space/Escape and focus return, pending/error state, stable Card/List mode and origin after action.
- [ ] **Step 2 — verify RED:** `cd client && npm run test -- src/note/NoteCard.test.tsx src/note/NoteListRow.test.tsx src/note/NotesRoute.test.tsx`.
- [ ] **Step 3 — GREEN:** one Note-owned action component using existing Radix/shadcn, approved grayscale tokens, #68 row-major order/440px cap and title fallback. On row removal, place focus on stable next row/header. Do not fetch full documents for lists.
- [ ] **Step 4 — verify GREEN:** targeted tests and existing #70 browsing tests.
- [ ] **Step 5 — commit:** `git add client/src/note && git commit -m "feat(note): add Card and List lifecycle menus"`.
