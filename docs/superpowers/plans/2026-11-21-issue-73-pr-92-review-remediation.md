# Issue #73 / PR #92 — Lifecycle Review Remediation Implementation Plan

> **For Luna / agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`, execute **inline/native without subagents**. Read this plan and the approved [#73 lifecycle design](../specs/2026-11-21-issue-73-notes-lifecycle-design.md), [original #73 implementation plan](./2026-11-21-issue-73-notes-lifecycle.md), `Agents.md`, `client/AGENTS.md`, `server/AGENTS.md`, `docs/ai/INDEX.md` and approved [#68 Notes design](../../design/notes-workspace/DESIGN-SPEC.md). Use `superpowers:receiving-code-review`, `superpowers:test-driven-development` and `superpowers:verification-before-completion`. **Do not use subagents; do not merge/close #73 without owner approval.**

**Goal:** Close verified correctness, recovery, concurrency, and accessibility gaps in the already implemented Note lifecycle PR #92, with minimal Note-owned changes and executable regression evidence.

**Architecture:** Keep the existing Note domain, REST contract, TanStack Query cache, `NoteLifecycleProvider`, `NoteSaveCoordinator`, and full-page editor. Make version-aware mutations (including Undo) mutually exclusive per Note and coordinate active-editor autosave through its existing save gate. Distinguish a definitive server rejection from a genuinely unknown network outcome, and keep draft/server metadata in sync without remounting the editor. Do **not** build a shared/global lifecycle framework.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, Axios, Radix, Vitest/RTL, Playwright; Spring Boot 4.0.6, Java 25, PostgreSQL 17, JUnit/Testcontainers.

**Target PR:** [#92](https://github.com/krishna916/horizon/pull/92); **branch:** `feature/73-notes-lifecycle`. **Re-reviewed implementation baseline:** `10abfa232a3613d28f72833196e3f9f3314e092e` (2026-11-21); **issue:** [#73](https://github.com/krishna916/horizon/issues/73). The baseline is **newer** than the originally reviewed `c8c5455`: it introduced `LifecycleState.note` and `NoteSaveCoordinator.adoptLifecycleVersion()`, plus a browser test for editor controls after Undo. Those are **partial mitigations, not a finished Undo/autosave handshake**. Re-check the latest PR head before changing code; skip a finding only with demonstrated equivalent behavior and a passing regression.

**Approved invariants (no changes authorized by this remediation):**
- No new Note `status` field or migration; `archivedAt` and `deletedAt` remain independent, Inbox/Tags/content preserved, and deleted Notes hidden from ordinary Note reads and Active/Archived lists.
- All four lifecycle commands retain the approved `X-Expected-Version` header, `409` stale-write behavior, and `DELETE 200 {id,version}` receipt. A duplicate DELETE retry must use its **original** expected version; never guess a confirmed deletion version.
- Owner authorization remains repository scoped; generic `404` for foreign/missing Notes; no private data across account/session changes. Observe both owner revision and session epoch.
- Card/List plus full-page actions, separate Active/Archived collections, title fallback, full-page-only edit, origin-aware Back, existing save/navigation guard, permanent **route-scoped** Undo and Trash confirmation all remain. No new modal, new route, global notifications or product workflows without escalation.
- Respect repository `docs/ai/INDEX.md`, `HORIZON_DECISION_SUMMARY.md`, `ENG-001` and `ENG-002`; cross-module calls only via `module.api`. No files/images or permanent cleanup integration in this PR.
- On unexpected requirements conflicts or UI behavior that cannot be resolved within the existing #73 contract, **stop and ask the owner**, instead of inventing product semantics.

## Review-to-task traceability

| Finding | Source | Plan task | Disposition |
| --- | --- | --- | --- |
| Undo and another mutation can overlap | [CodeRabbit 4749](https://github.com/krishna916/horizon/pull/92#discussion_r4651414749) | 1 | P1 fix |
| Mounted editor can have stale autosave version after Undo | [CodeRabbit 4746](https://github.com/krishna916/horizon/pull/92#discussion_r4651414746) | 3 | P1 fix; baseline mitigation is incomplete |
| Editor Retry bypasses prepare/complete, may use wrong operation | [CodeRabbit 4741](https://github.com/krishna916/horizon/pull/92#discussion_r4651414741) | 4 | P1 fix; **do not blindly use `execute(operation)` for failed Delete** |
| Explicit DELETE `409` appears as uncertain delete; stale Retry remains actionable | Independent review / `NoteLifecycleProvider.tsx` `catch` | 2 | P2 fix |
| Unconfirmed DELETE releases editor gate before outcome resolved | Independent review / `NoteEditorPage.tsx` `cancelLifecycleMutation()` | 3 | P2 fix |
| Conflict recovery leaves archived metadata stale | [CodeRabbit 4735](https://github.com/krishna916/horizon/pull/92#discussion_r4651414735) | 4 | P2 fix; latest baseline still lacks conflict-result publication |
| Lost Undo restore response leads to stale repeated Undo | [CodeRabbit 4751](https://github.com/krishna916/horizon/pull/92#discussion_r4651414751) | 2–3 | P2 fix; reconcile, do not auto-rebase |
| Unconfirmed notice dismiss leaves dead inline Retry | [CodeRabbit 4755](https://github.com/krishna916/horizon/pull/92#discussion_r4651414755) | 5 | P2 fix |
| Trash dialog Escape/Cancel loses keyboard focus | [CodeRabbit 4745](https://github.com/krishna916/horizon/pull/92#discussion_r4651414745) | 5 | P3 fix |
| Card removal focus destination never finds `data-note-row` | Independent review / `NoteCard.tsx` | 5 | P3 fix |
| Existing DELETE stale-version test only uses `-1` | CodeRabbit review nitpick | 6 | Regression test |

## Review focus — high-risk sequences to pin down

1. **Undo while a PATCH is in flight:** no overlapping write, no persisted-version downgrade, no silently dropped title/body/Tag edit; subsequent PATCH uses the verified server version (Task 3).
2. **Undo while a second same-Note lifecycle command starts:** one mutation at a time, one cache reconciliation winner; no stale detail resurrection or lost notice (Task 1).
3. **DELETE returns `409` vs response disappears:** 409 is definitive conflict, **no** guessed success/no unconfirmed receipt; lost response remains retryable with the original header (Task 2).
4. **Conflict recovery returns latest archived Note:** editor shows Restore and correct metadata while retaining the mounted draft/caret; no accidental content overwrite (Task 4).
5. **Unknown Delete/Undo outcome in mounted editor or account transition:** no unsafe autosave; keep local draft and recovery affordance, never access or publish private state for a new session (Tasks 1–3).

---

### Task 1: Serialize Undo, run, and owner-scoped reconciliation

**Files**
- Modify: `client/src/note/NoteLifecycleProvider.tsx`
- Test: `client/src/note/NoteLifecycleProvider.test.tsx`

**Interfaces**
- Keep public `run(ownerId,target,operation)` / `undo(noticeId)` / `retryDelete(noticeId)`; introduce one **private**, owner+Note-scoped mutation guard used by all three paths, with a unique token for each dispatch.
- Every dispatch captures current owner ID, `getCurrentOwnerRevision()` **and** `getCurrentSessionEpoch()`. A stale completion may not write notices, cache or state, and may not release a lock acquired by a newer session/operation.
- `undo` must check `notice.pending` and the per-Note lock **before** setting pending or making the REST call; release lock in `finally`, including failures, account transitions and unmount. Keep `pending` / error / notice states in sync.

- [ ] **Step 1 — RED:** Add `undoAndDeleteSameNoteAreMutuallyExclusive` (hold restore promise, invoke Delete: only restore request dispatched; once settled, new action may proceed with fresh server version); `doubleUndoDispatchesOnce`; `pendingUndoBlocksRetryAndArchive`.
- [ ] **Step 2 — RED:** Add `ownerEpochChangeInvalidatesLateUndoWithoutUnlockingNewSessionWork` and `lateMutationCannotResurrectDeletedDetailCache`. Make deferred network promises deterministic; assert cache, notice and call counts, not timers.
- [ ] **Step 3 — verify RED:** `cd client && npm run test -- src/note/NoteLifecycleProvider.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`; verify new cases fail for the expected reason.
- [ ] **Step 4 — GREEN:** Give `run` and `undo` the same private per-note entry/exit helper, with captured owner revision+session epoch and token comparison on release. Keep all owner-specific cache invalidation and detail reconciliation behind the current-request guard. Do not introduce a global mutex/event bus.
- [ ] **Step 5 — verify GREEN:** Re-run the focused test command; inspect racing request order and cache keys; commit only when green.
- [ ] **Step 6 — commit:** `git add client/src/note/NoteLifecycleProvider.tsx client/src/note/NoteLifecycleProvider.test.tsx && git commit -m "fix(note): serialize lifecycle Undo with per-note mutations"`.

### Task 2: Separate definitive conflicts from uncertain transport outcomes; reconcile lost Undo responses

**Files**
- Modify: `client/src/note/NoteLifecycleProvider.tsx`, `client/src/note/NoteLifecycleNoticeList.tsx` if notice copy/disabled state needs adjustment
- Test: `client/src/note/NoteLifecycleProvider.test.tsx`
- Optional existing E2E: `client/e2e/notes-lifecycle.spec.ts`

**Interfaces**
- Add a **Note-local** error classifier `classifyLifecycleError(error: unknown): 'conflict' | 'unavailable' | 'unknown' | 'other'` using Axios response status; no new shared error infrastructure. `409` -> `conflict`, `401/403/404` -> `unavailable`, network/no response and potentially committed `5xx` -> `unknown`, malformed/validation failures -> `other`.
- On definite `409`: expose visible stale-version/manual-review feedback, clear/disable automatic retry intent for that stale mutation, preserve draft and known state. **Never create `delete-unconfirmed` for a returned `409`.** No silent GET→rebase→replay.
- On unknown **DELETE** only: retain `delete-unconfirmed` and original target/version; no Undo until a real server `200 {id,version}` receipt. Retry must send **exact same** expected version. Distinguish known rejection from unknown commit.
- For `undo` when restore returns `409` (especially a response lost after a successful restore), read the Note through the **normal owner-scoped `noteApi.get(id)`**: if server-confirmed state already satisfies the inverse (Archive Undo => `archivedAt === null`; DELETE Undo => Note is normally readable), reconcile its returned version/detail and retire obsolete Undo; otherwise keep visible conflict/manual-review state. A GET failure/404 is *not* proof of successful restore and must not manufacture a result. Do **not** retry Undo at an automatically upgraded version. For unknown restore outcomes, attempt the same safe read; keep actionable notice/error if not conclusive.
- Preserve the backend contract unchanged. If current server idempotent-delete receipt behavior proves ambiguous for a **different tab's** same-version deletion, flag the exact scenario to owner separately; do not silently change the approved header or introduce idempotency keys in this remediation.

- [ ] **Step 1 — RED:** `delete409IsConflictNotUnconfirmed` asserts no Undo, no unknown notice and no replay against stale version; `timeoutDeleteRetriesOriginalHeaderAndRequiresReceipt` asserts same expected header and no fake version.
- [ ] **Step 2 — RED:** `undo409FetchesActualRestoredStateAndClearsStaleNotice`, `undo409StillArchivedDoesNotAutoRebase`, `undoRestoreGet404KeepsRecoveryVisible`, and `unknownUndoOutcomeNeverGuessesSuccess`; include owner isolation.
- [ ] **Step 3 — verify RED:** `cd client && npm run test -- src/note/NoteLifecycleProvider.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`.
- [ ] **Step 4 — GREEN:** Replace broad catch-as-unknown handling with explicit classification; use the existing query API/caches to reconcile only a verified result. Ensure `retryDelete` cannot dispatch without its retained original intent. Keep user-facing error actions consistent with actual retryability.
- [ ] **Step 5 — verify GREEN:** Focused test suite; add a browser assertion that an explicit DELETE `409` does **not** show a timeout-style notice (if not already covered). Commit.
- [ ] **Step 6 — commit:** `git add client/src/note/NoteLifecycleProvider.tsx client/src/note/NoteLifecycleProvider.test.tsx client/src/note/NoteLifecycleNoticeList.tsx client/e2e/notes-lifecycle.spec.ts && git commit -m "fix(note): distinguish lifecycle conflicts from uncertain outcomes"`.

### Task 3: Handshake Undo with the mounted editor and its autosave gate

**Files**
- Modify: `client/src/note/NoteLifecycleProvider.tsx`, `client/src/note/NoteEditorPage.tsx`, `client/src/note/NoteSaveCoordinator.ts`, `client/src/note/useNoteAutosave.ts`
- Test: `client/src/note/NoteSaveCoordinator.test.ts`, `client/src/note/NoteEditorPage.test.tsx`, `client/src/note/NoteLifecycleProvider.test.tsx`, `client/e2e/notes-lifecycle.spec.ts`

**Interfaces**
- The baseline `adoptLifecycleVersion(note)` only copies a number and can run while `inFlight` or `pendingUpdate` exists. **Do not treat that as an acknowledged save or allow stale PATCH acknowledgements to overwrite a newer lifecycle version.** Replace/bound it with the existing `prepareLifecycleMutation()` → `completeLifecycleMutation(serverNote)` / `cancelLifecycleMutation()` protocol for a current-editor Undo.
- Keep the provider as owner of server lifecycle and persistent notices, editor as owner of the local draft/coordinator. Add a **route-local ephemeral bridge** only while editing that exact Note (no cross-module or global event bus):
  - `interface NoteEditorUndoGateway { prepare(): Promise<{ id: number; version: number } | null>; complete(note: NoteDetail): void; cancel(): void }`
  - `registerEditorUndoGateway(noteId: number, gateway: NoteEditorUndoGateway): () => void` on the Note lifecycle context; store at most the currently mounted owner's matching editor, clean up on note switch/unmount/owner revision change. Implement functions as stable callbacks/refs to avoid render-loop registration.
- `undo(noticeId)` under Task 1's lock: if a matching editor is mounted, call gateway.`prepare`, which flushes outstanding title/content/Tags and holds further editor edits/writes; **only send the Undo request when the prepared persisted version equals `notice.version`**. A newer version means the notice is stale; cancel and require manual review, never silently rebase. After confirmed Undo, reconcile cache and invoke gateway.`complete(returnedNote)` before releasing lock; editor remains mounted with same draft/caret and new metadata. On definitive failure, `cancel` without losing draft. For an unknown outcome, verify through Task 2's safe read **before** releasing a write gate to a possibly changed Note.
- For an uncertain **editor-initiated DELETE**, `NoteEditorPage.runLifecycleAction` must **not** unconditionally call `cancelLifecycleMutation()` and resume autosave while the server may have deleted the Note. Maintain a safe blocked/recovery state until either (a) exact-version DELETE retry supplies the receipt and the editor navigates via existing `onBack()`, or (b) a verified, current server Note proves it still exists and the coordinator is reconciled. Do not wipe the draft; do not fabricate Undo or bypass navigation guard. Keep existing persistent notice/Retry as the recovery entry point; if a new UX decision is unavoidable, escalate to owner.
- Do not modify `NoteSaveCoordinator` draft content on metadata-only lifecycle acknowledgment. Only the explicit pre-existing "Load latest version" conflict choice may replace local draft.

- [ ] **Step 1 — RED coordinator:** `undoWaitsForInflightPatchBeforeRestore`, `confirmedUndoNeverRegressesPersistedVersion`, `undoPreservesLocalDraftAndTagSelection`, `staleNoticeAfterAutosaveDoesNotDispatchUndo`. Use deferred PATCH/restore promises and assert exact `expectedVersion`.
- [ ] **Step 2 — RED editor:** `archiveUndoKeepsEditorMountedAndNextAutosaveUsesRestoredVersion`, `undoWhileUnsavedTextFlushesBeforeRestore`, `deleteTimeoutNeverResumesBlindAutosave`, `deleteRetryReceiptNavigatesToTrustedOrigin`, `undoDuringOwnerChangeDoesNotPublishOldDraft`.
- [ ] **Step 3 — verify RED:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/NoteEditorPage.test.tsx src/note/NoteLifecycleProvider.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`.
- [ ] **Step 4 — GREEN:** Bridge only the matching mounted editor to provider Undo, reuse coordinator's gate and enforce prepared version equality; avoid duplicated Note draft state. Safely unblock after verified success/failure; do **not** overwrite draft, stale response, or navigation history.
- [ ] **Step 5 — verify GREEN:** Focused unit tests; add a Playwright path: Archive in editor → Undo in same editor → type another character → PATCH uses restored version and succeeds without conflict. Add a controlled delayed-autosave scenario as above.
- [ ] **Step 6 — commit:** `git add client/src/note client/e2e/notes-lifecycle.spec.ts && git commit -m "fix(note): coordinate Undo and unknown delete with editor autosave"`.

### Task 4: Keep editor metadata canonical after conflict resolution; make Retry operation-aware

**Files**
- Modify: `client/src/note/NoteSaveCoordinator.ts`, `client/src/note/useNoteAutosave.ts`, `client/src/note/NoteEditorPage.tsx`, `client/src/note/NoteLifecycleActions.tsx`
- Test: `client/src/note/NoteSaveCoordinator.test.ts`, `client/src/note/NoteEditorPage.test.tsx`, `client/src/note/NoteLifecycleActions.tsx`'s existing parent Card/List tests as appropriate; `client/e2e/notes-lifecycle.spec.ts`

**Interfaces**
- Expose a hook-level callback `onServerReconciled?: (note: NoteDetail) => void` from `NoteSaveCoordinator`, invoked **only after a successful, current conflict resolution** acknowledged `latest` (including "Load latest version" and successful "Keep my version" paths). `useNoteAutosave` publishes confirmed Note metadata through owner/session-guarded TanStack Query detail cache (reuse existing `publishSavedNote` guard, without claiming a new local content save). Do not let a stale GET overwrite a newer confirmed Note or reset an in-progress draft.
- `ActiveNoteEditor` should derive archive fact, title and displayed updated timestamp from the latest **acknowledged** Note; current `initialNote`/`localLifecycleNote`/`lifecycleState.note` most-recent-version selection is a partial start. After conflict resolution, display Archive vs Restore correctly. Never use a new Note metadata object to rebuild TipTap/replace caret except when the user explicitly selected "Load latest version".
- Current `NoteLifecycleActions.tsx` inline Retry blindly calls `state.retry` for all placements. For editor, retain the actual failed action (`archive`, `restore`, **or `delete`) and route an explicitly safe retry through the editor's coordinator prepare+execute+completion path. **Do not use the component's ordinary `operation` variable for failed Delete** (it only denotes Archive/Restore). For Card/List, keep provider's retained intent with original version only when the failure is genuinely retryable. A `409` instead requires review, not a repeated stale call.
- Honor `disabled` for Retry and while save/lifecycle is busy. A successful retried Delete must complete coordinator deletion and navigate to origin; a successful retried archive/restore must refresh metadata and editor version. Unknown DELETE still follows Task 2–3's exact-version recovery rather than a newly prepared, silently rebased Delete.

- [ ] **Step 1 — RED:** `loadLatestArchivedVersionUpdatesRestoreActionWithoutRemount`, `keepLocalConflictResolutionPublishesConfirmedArchiveFact`; assert no extra PATCH and local selection/caret intact where applicable.
- [ ] **Step 2 — RED:** `editorArchiveRetryUsesPreparedVersionAndUpdatesEditor`, `editorDeleteRetryNeverCallsArchiveOrRestore`, `editorRetryDisabledDuringSave`, `cardListRetryPreservesOriginalVersion`, `conflictNeverRendersStaleRetry`.
- [ ] **Step 3 — verify RED:** `cd client && npm run test -- src/note/NoteEditorPage.test.tsx src/note/NoteSaveCoordinator.test.ts src/note/NoteCard.test.tsx src/note/NoteListRow.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`.
- [ ] **Step 4 — GREEN:** Add the targeted confirmed-metadata callback / cache update; store last failed operation explicitly (per-Note provider state or component handler) and route only safe retries. Keep Action component shared between Card and List; do not add a second autosave implementation.
- [ ] **Step 5 — verify GREEN:** Focused tests plus one editor conflict→Load latest→Restore browser flow; commit.
- [ ] **Step 6 — commit:** `git add client/src/note client/e2e/notes-lifecycle.spec.ts && git commit -m "fix(note): keep editor metadata and lifecycle retries current"`.

### Task 5: Make notice dismissal and keyboard focus deterministic

**Files**
- Modify: `client/src/note/NoteLifecycleProvider.tsx`, `client/src/note/NoteLifecycleActions.tsx`, `client/src/note/NoteCard.tsx`; `client/src/note/NoteLifecycleNoticeList.tsx` only if required
- Test: `client/src/note/NoteLifecycleNoticeList.test.tsx`, `client/src/note/NoteLifecycleProvider.test.tsx`, `client/src/note/NoteCard.test.tsx`, `client/src/note/NoteListRow.test.tsx`, `client/src/note/NoteEditorPage.test.tsx`

**Interfaces**
- `dismiss(noticeId)` must remove the specified notice **and** clear the matching retry intent/inline error if an unconfirmed-Delete notice was dismissed. Do not clear a different Note's state, a newer superseding notice, or an active pending mutation. If a still-open editor is awaiting uncertain-delete reconciliation (Task 3), dismissal must not falsely mark the server outcome as safe or unfreeze queued writes; retain a truthful recoverable editor state.
- Radix Trash `Dialog.Content` lacks a `Dialog.Trigger`. Retain a ref to the **actual** menu opener (including the editor More button) and restore focus in `onCloseAutoFocus` after Cancel/Escape. On **successful** deletion when the opener unmounts, prefer the already captured next/previous row or collection control; never focus an unmounted node. Preserve the current focus-after-row-removal behavior.
- Card view currently renders an `<article>` without `data-note-row` although `captureFocusDestination()` searches for it. Add the marker to cards without changing links, layout, or DOM tab order.

- [ ] **Step 1 — RED:** `dismissUnconfirmedClearsInlineErrorAndDeadRetry`, `dismissOneNoticeDoesNotClearAnotherNote`, `dismissPendingNoticeIsIgnored`.
- [ ] **Step 2 — RED focus:** `cardCancelAndEscapeRestoreOpenerFocus`, `listCancelAndEscapeRestoreOpenerFocus`, `editorCancelAndEscapeRestoreOpenerFocus`, `confirmedCardRemovalFocusesNextConnectedNote`. Run keyboard assertions on actual `document.activeElement`, not only element visibility.
- [ ] **Step 3 — verify RED:** `cd client && npm run test -- src/note/NoteLifecycleNoticeList.test.tsx src/note/NoteLifecycleProvider.test.tsx src/note/NoteCard.test.tsx src/note/NoteListRow.test.tsx src/note/NoteEditorPage.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`.
- [ ] **Step 4 — GREEN:** Implement atomic dismissal cleanup and dialog focus restoration; use existing Radix props and refs, no new dialog package.
- [ ] **Step 5 — verify GREEN:** Focused tests, manual keyboard smoke test in Card/List/editor; commit.
- [ ] **Step 6 — commit:** `git add client/src/note && git commit -m "fix(note): restore lifecycle dialog focus and notice retry state"`.

### Task 6: Prove the server's narrow duplicate-DELETE exception and finish verification

**Files**
- Test: `server/src/test/java/com/krishnamurti/horizon/note/application/NoteCommandServiceIntegrationTest.java`
- Test as necessary: `server/src/test/java/com/krishnamurti/horizon/note/web/NoteControllerIntegrationTest.java`
- Extend: `client/e2e/notes-lifecycle.spec.ts`
- Update delivery notes (implementation evidence only): `.superpowers/sdd/2026-11-21-issue-73-notes-lifecycle/progress.md` or PR discussion, **not** authoritative product documents.

**Interfaces**
- Retain `NoteCommandService.softDelete(id,expectedVersion)`. The test must distinguish a duplicate exact one-increment request from an **older nonnegative stale** version (the current `-1L` assertion only proves the negative guard):
  1. create v0; archive v1; delete v2;
  2. duplicate DELETE with expected v1 returns receipt v2 without further write;
  3. DELETE with expected v0 throws `NoteVersionConflictException`;
  4. verify archived fact unchanged and deleted row not in normal Note listing.
- Do not modify approved REST semantics, introduce new migration, or turn repeated stale writes into successful commands.
- Finish tracing every Review-to-task row to a test and concrete fix or reasoned non-fix; acknowledge partial previous fix from `10abfa2`, don't claim rerun results without local command output.

- [ ] **Step 1 — RED:** Add `olderNonnegativeDeleteVersionConflictsButExactRetryDoesNotAdvanceVersion` and any missing HTTP integration assertion. Execute `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteCommandServiceIntegrationTest test`; if test passes before change, prove it covers the formerly untested case rather than artificially forcing RED.
- [ ] **Step 2 — GREEN:** Add only test support/server fix required to meet existing approved contract; run focused tests.
- [ ] **Step 3 — browser regression:** `cd client && npm run test:e2e -- notes-lifecycle.spec.ts notes-browsing.spec.ts notes-editing.spec.ts notes-tags.spec.ts`. Cover list/card/editor action placement, explicit 409 vs timeout, stale notice, Undo+next edit, dialog focus and account boundaries in realistic routes.
- [ ] **Step 4 — complete frontend gate:** `cd client && npm run verify`. Record exact test counts, any warnings and failure logs.
- [ ] **Step 5 — complete backend gate:** `cd server && ./mvnw -Duser.timezone=UTC verify`. Run `git diff --check`. Record exact results, not historical #92 counts.
- [ ] **Step 6 — self-review:** Compare against the #73 design and all CodeRabbit threads; ensure no stale version rebase, no silent draft loss, no undo while another action is pending, no owner leakage, no new global lifecycle abstraction or unrelated PRD changes.
- [ ] **Step 7 — delivery:** Commit tests/documentation, push on the existing PR branch, leave concise per-thread responses referencing actual fixes or justified non-fixes, and post PR summary with commits, changed files, verification commands and remaining limitations. **Do not resolve threads before their issues are verified. Do not merge or close #73.**

## Explicitly not in scope

- Implementing the full Trash workspace, Notes attachments/images, physical deletion, background sync, cross-device Undo persistence, or Task module changes.
- Introducing a new `Note.status` enum, global lifecycle queue, event bus, Redux/global notifications, extra lifecycle HTTP endpoints, or changing the already approved `X-Expected-Version` / `DELETE 200` contract.
- Automatically retrying stale commands with a freshly fetched version, silently overwriting a draft, masking an unknown Delete as success, or interpreting a GET `404` as a successful restore.
- Product-level behavior changes beyond existing #73 UX without the owner's explicit approval.

## Completion checklist / Luna handoff

- [ ] Every verified CodeRabbit finding has a tested fix or a technically grounded PR-thread response; the test nitpick and two independent findings are addressed.
- [ ] Same-Note lifecycle commands are serialized, including Undo; owner ID, owner revision **and** session epoch gate all cache writes and visible notices.
- [ ] Editor after Undo and after conflict recovery uses the confirmed server version/archive fact, preserves draft/caret and never sends a knowingly stale PATCH.
- [ ] DELETE `409` cannot become an unconfirmed-delete notice; timeout retry uses **original** expected version and waits for confirmed receipt; uncertainty does not release unsafe autosave.
- [ ] Retry is operation-aware, disabled when necessary, and cannot turn failed Delete into Archive/Restore; Dismiss never leaves an inert Retry.
- [ ] Card/List/editor dialog keyboard focus restores correctly; removed card/row directs focus to the next stable item/control.
- [ ] New backend/RTL/Playwright regressions plus full CI-quality checks produce real evidence; code and tests committed on `feature/73-notes-lifecycle`.
- [ ] Luna requests owner review of refreshed PR #92, does not auto-merge, does not close #73.

**Execution:** Work Tasks 1–6 in order, failing test → observed RED → smallest implementation → observed GREEN → commit for each. No subagents, no unrelated refactor. If upstream PR head changes during work, reassess actual findings and update the plan/evidence rather than applying stale patches.
