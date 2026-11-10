# PR #86 Final Edge-Case Remediation — Implementation Plan

> **For Luna / agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`, **inline only**. **No subagents or delegated execution.** Red test → minimal implementation → green test → small commit, one task at a time. This is a narrowly scoped follow-up to the existing #71 and PR #86 plans, not a redesign.

**Goal:** Close the three remaining review edge cases—sign-out debounce race, reused new-Note editor identity, and ambiguous restored POST—then triage the six new SonarCloud findings before merging PR #86.

**Architecture:** Keep the existing `NoteSaveCoordinator`, `useNoteAutosave`, `NoteEditorNavigationGuard`, `NotesRoute` and owner-bound memory recovery. Add only the lifecycle state needed to make pending-save decisions safe and the active editor identity unambiguous. No new dependencies, backend endpoints, browser draft persistence, Tag flows or general-purpose state manager.

**Tech Stack:** React 19 / TypeScript / TanStack Router and Query / Tiptap / Vitest / Testing Library / Playwright; existing Note APIs.

**Spec:** `docs/superpowers/plans/2026-11-09-notes-rich-editing-autosave.md`, `docs/superpowers/plans/2026-11-10-pr86-notes-review-remediation.md`, issue #71 (approved memory-only recovery, explicit 409 and same-user session expiry), and approved Notes design `docs/design/notes-workspace/DESIGN-SPEC.md`.

**Reviewed baseline:** PR https://github.com/krishna916/horizon/pull/86 at `19547483422fff202ac67fac03476d87bc0b21d0`, 2026-11-10. Check latest head before coding; if anything was already fixed, demonstrate it with a test and skip duplicate changes.

## Global constraints and invariants

- **Sign-out honesty:** A save already dispatched to the server may commit even after local cancellation/disposal. Only **unsent** changes can be safely discarded. In-flight, failed/ambiguous or newly acknowledged writes must never be described as fully undone. Keep the previously approved two-step explicit sign-out-anyway acknowledgment for uncertain outcomes; do not add revert/delete APIs.
- **Navigation hold:** A blocked navigation/sign-out decision must not allow a queued debounce to silently transition from “unsent” to “sent” while the user considers a discard. **Do not reuse `NoteSaveCoordinator.pause()` blindly** for this: its current pending-request completion guards ignore acknowledgments when `paused` is true, so a distinct *navigation decision hold* is needed. Existing in-flight acknowledgments and version reconciliation must continue.
- **Editor identity:** One owner + one logical Note editing session owns one coordinator and one Tiptap instance. A successful `/notes/new` → `/notes/{createdId}` route replacement preserves that identity. Every **subsequent** visit to `/notes/new` starts a *new* session even when visited directly from the just-created Note; a different saved Note ID also starts a new session.
- **Create replay:** A recovered frozen POST with the previous idempotency UUID/body represents an **ambiguous already-issued write**, not merely an unsent draft. Preserve its exact payload/key across verified same-owner retry, never issue a new UUID to “fix” uncertainty, and never promise it can be undone by local discard.
- **#71 scope stays closed:** #72 owns Tags and atomic Note–Tag association; #78/#79 own media. All existing #68 editor, owner isolation, conflict handling, #70 browse and Task editor tests remain green. No subagents.
- **Sonar findings:** The latest SonarCloud quality gate passes but reports **six new issues** (and the GitHub SonarCloud Code Analysis check exposes six annotations). Their individual rules/path/lines are *not established* by the current review access; inspect them individually from SonarCloud or GitHub check annotations before choosing any fix. Do not invent rules or silence analysis globally.

## File responsibility map

| File | Responsibility |
| --- | --- |
| `client/src/note/NoteSaveCoordinator.ts`, `NoteSaveCoordinator.test.ts` | Separate navigation decision hold from auth pause; current dispatched/ambiguous write state; frozen POST recovery |
| `client/src/note/useNoteAutosave.ts`, `useNoteAutosave.test.tsx` | Expose coordinator hold/release/synchronous state to navigation guard; terminate discarded draft without restash |
| `client/src/note/NoteEditorNavigationGuard.tsx`, `NoteEditorNavigationGuard.test.tsx` | Hold queued work while blocked; truthful sign-out choices and guard transition |
| `client/src/note/NotesRoute.tsx`, `NotesRoute.test.tsx` | Fresh per-new-entry identity and single permitted create→ID promotion |
| `client/src/note/NoteEditorPage.tsx`, `NoteEditorPage.test.tsx` | Confirm identity key propagation and no editor-state remount at permitted promotion |
| `client/e2e/notes-editing.spec.ts`, `client/e2e/notes-browsing.spec.ts` | Browser coverage of dialog dwell time, second-new-Note identity, same-owner replay and no account leakage |
| SonarCloud PR #86 and check annotations | Individual issue triage; targeted fixes/tests only if valid |

## Review focus

1. **Sign-out dialog stays open longer than 900 ms:** no previously unsent PATCH/POST is dispatched on its own; choosing Stay resumes saving, while discard stops it.
2. **Mutation already in flight as dialog opens:** its acknowledgment is still processed; dialog copy/actions never claim that already-sent work was discarded—even if the write finishes while the dialog remains open.
3. **New → first created ID → another new Note:** no old title/content, no PATCH to prior ID; new note gets a distinct creation key and POST.
4. **Session expires during first POST, then same owner returns:** retained frozen key/body are classified uncertain and retried idempotently only after verification; a different owner cannot see/replay it.
5. **Six Sonar findings:** each has a recorded rule, path/line, triage result and evidence; no blanket style-only refactor or global rule disable.

---

### Task 1 — Hold *queued* autosaves during a navigation/sign-out decision

**Files:** Modify `client/src/note/NoteSaveCoordinator.ts`, `useNoteAutosave.ts`, `NoteEditorNavigationGuard.tsx` and corresponding Vitest tests.

**Interfaces (focused addition):**
- Add `holdQueuedWritesForNavigation(): void` and `releaseQueuedWritesForNavigation(): void` to `NoteSaveCoordinator`. The hold cancels a debounce and prevents any **new** POST/PATCH while the navigation decision is pending; it **does not** mark an existing request's acknowledgment stale or make the owner/session unauthenticated. The release schedules currently pending unsent work (normal debounce) if the user chooses **Stay**.
- Add `getNavigationSaveStateNow(): { writeInFlight:boolean; outcomeUncertain:boolean; hasUnsavedChanges:boolean; persistedNoteId:number|null }` or reuse the existing `snapshot()` behind an equivalent synchronous hook method. This check must occur at the **moment of action**, not solely from rendered/possibly stale props.
- Add corresponding hook callbacks `holdQueuedWritesForNavigation`, `releaseQueuedWritesForNavigation` and `getNavigationSaveStateNow` to `useNoteAutosave`. The guard invokes the hold when the blocker enters `blocked`; release on **Stay** and when explicitly choosing **Wait/Retry for save**, before invoking the existing `flush()/retry()`. Terminal discard must stop all unsent work and bypass recovery restash.
- Treat `writeInFlight` and `outcomeUncertain` as authoritative for sign-out decisions. If a write **has been issued or acknowledged during this decision**, keep a decision-local “previously sent” flag so a subsequent render never suggests *all* recent edits can be reversed. The user can discard only remaining unsent edits with accurate copy, or wait for reconciliation.
- The hold only concerns user-triggered navigation decisions; do not hold mandatory auth redirects indefinitely, skip current owner checks, or alter normal 900 ms save behavior outside the dialog.

- [ ] **1. Write failing coordinator tests:** queued unsent title/body → hold → advance fake timers well beyond 900 ms → zero POST/PATCH; release → normal save resumes; hold while PATCH is already in-flight → its success ACK still advances version and does not produce a phantom 409; hold does not erase new edits.
- [ ] **2. Run red:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts`. Confirm tests fail for the missing hold behavior.
- [ ] **3. Implement the minimal hold state** separately from the existing `paused` auth state; ensure `flush` when requested by the explicit Wait action can proceed after release, not hang on an old in-flight Promise.
- [ ] **4. Write failing guard/hook tests:** clicking Sign out while autosave is still debounced enters held state; after a >900 ms dwell the offered discard remains safe, and discard causes zero future writes; choosing Stay restores debounce; Wait-for-save sends work and navigates only after confirmed save; a write that races with dialog opening changes the action/copy to truthful uncertain/sent semantics. Test completed ACK while dialog remains open.
- [ ] **5. Run red:** `cd client && npm run test -- src/note/NoteEditorNavigationGuard.test.tsx src/note/useNoteAutosave.test.tsx`.
- [ ] **6. Implement guard integration** using existing `useBlocker` and `useNoteModal`, preserving keyboard focus/Escape, synchronous `canLeaveNow` check and the existing two-stage “sign out anyway” acknowledgment. Verify a failed logout cannot resurrect an intentionally discarded draft.
- [ ] **7. Run green:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/NoteEditorNavigationGuard.test.tsx src/note/useNoteAutosave.test.tsx`; expect PASS.
- [ ] **8. Commit:** `git add client/src/note && git commit -m "fix(notes): hold queued autosave during sign-out decisions"`.

### Task 2 — Reset editor identity for every *new* Note after a create promotion

**Files:** Modify `client/src/note/NotesRoute.tsx` and `NotesRoute.test.tsx`; change `NoteEditorPage.tsx` only if its `identityKey` handoff requires it.

**Interfaces / identity rules:**
- Replace the current “`promotedCreatedNote` sourceIdentity reused whenever pathname is `/notes/new`” behavior with a **fresh new-draft session identity for each distinct entry into `/notes/new`**. A minimal monotonic in-memory entry counter/session token in `NotesRoute` is sufficient. The promoted mapping may keep the *current* new-draft identity until its exact created ID is reached; do not preserve it as the identity of a **later** new draft.
- Reset/retire the promotion when leaving the matching created Note for the workspace, a different Note, or any new-draft entry that is not the in-progress original. Do not reset between the original `new` and its own confirmed `createdId` replacement; keep Tiptap/caret intact.
- A new draft must not inherit `initialNote`, the old `NoteSaveCoordinator`, a stale `frozenCreateRequest`, recovery data or a prior `persistedNoteIdNow()`. Different Note IDs must never cross-dispatch writes; preserve existing owner-key boundaries.

- [ ] **1. Write failing route/unit tests:** enter new Note session A → create ID 501 → URL replace retains editor identity A → navigate directly to `/notes/new` (without visiting workspace) → identity B differs; new editor blank, coordinator has null persisted ID, and a meaningful edit sends POST for B, never PATCH `/notes/501`.
- [ ] **2. Run red:** `cd client && npm run test -- src/note/NotesRoute.test.tsx src/note/NoteEditorPage.test.tsx`.
- [ ] **3. Implement small identity-lifecycle correction** in `NotesRoute`, avoiding route leaf component remount on the sanctioned create→ID replacement; tests should inspect behavior, not only the computed string.
- [ ] **4. Add regression tests:** new A→501→workspace→new B; direct A→501→new B; create A→501→another existing 502; browser Back/origin/scroll unchanged. Verify Tiptap DOM equality only across A→501, inequality for B/new or 502.
- [ ] **5. Run green:** `cd client && npm run test -- src/note/NotesRoute.test.tsx src/note/NoteEditorPage.test.tsx src/note/NoteEditorNavigationGuard.test.tsx`.
- [ ] **6. Commit:** `git add client/src/note && git commit -m "fix(notes): use a fresh editor session for each new Note"`.

### Task 3 — Mark a restored in-flight Note creation as uncertain

**Files:** Modify `client/src/note/NoteSaveCoordinator.ts` and `NoteSaveCoordinator.test.ts`, add hook/guard tests if necessary. Existing `NoteDraftRecoveryProvider` should already carry `frozenCreateRequest`; avoid broad changes there unless evidence requires one.

**Interfaces / behavior:**
- In `restorePendingCreate()`, when `recovery.frozenCreateRequest` exists and `initialNote` is null, set `outcomeUncertain=true` until the same UUID + frozen original payload resolves through successful create/reconciliation. If an explicit definitive server result establishes no creation, handle that result distinctly; never infer “unsent” simply from absence of a persisted Note ID.
- Don't mint a new idempotency key or change the frozen request body while the user continues typing. On verified same-owner recovery, retry the frozen request once under the existing coordinator retry rules; later edits become a versioned PATCH after the created ID is confirmed. Another user/account cannot trigger replay.
- The same logout decision policy from Task 1 must show the **may already have been saved** warning for this restored uncertain create, even before a retry starts. No durable local recovery store.

- [ ] **1. Write failing coordinator recovery test:** session A dispatches POST UUID `K` with title `first`, response is lost/401, memory recovery captures frozen key/body; a freshly constructed same-owner coordinator reports `outcomeUncertain:true` before sending; local draft may now be `first plus more` but retry uses **K + original frozen body**, then sends newer draft only as a PATCH. Exactly one server Note ID is created.
- [ ] **2. Run red:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts`.
- [ ] **3. Implement explicit restored-create ambiguity classification**; preserve POST idempotency behavior and stop uncertainty only on a grounded outcome.
- [ ] **4. Add regression tests:** uncertain recovered creation + sign-out dialog has no ordinary “discard unsent” promise; owner switch/explicit logout discards memory and never sends POST; fresh unrelated `/notes/new` generates a new key.
- [ ] **5. Run green:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/NoteDraftRecoveryProvider.test.tsx src/note/NoteEditorNavigationGuard.test.tsx`.
- [ ] **6. Commit:** `git add client/src/note && git commit -m "fix(notes): classify recovered Note creation as uncertain"`.

### Task 4 — Browser regression, SonarCloud triage and merge gate

**Files:** Extend `client/e2e/notes-editing.spec.ts` and `notes-browsing.spec.ts`. Make only targeted Sonar-relevant source/test changes proven necessary by inspected issues.

- [ ] **1. E2E sign-out dwell time:** type existing Note title, click Sign out while debounce remains pending, keep modal open for `>900 ms`, assert **zero** Note mutations until explicit choice. Stay then autosave eventually persists. Repeat with discard then sign-out: zero Note mutations. Add case where PATCH already issued and ack arrives while modal open; it is never described as discardable.
- [ ] **2. E2E multiple-new-Note identity:** create A (e.g. ID 501), then navigate directly to `/notes/new` and create B (ID 502) without a workspace round trip. Assert distinct POST idempotency keys, no PATCH to 501, blank title/body when B opens, and no Tiptap instance remount on each new→its own created ID.
- [ ] **3. E2E recovered POST ambiguity:** simulate interrupted create request, verified same-owner resume, exact-key/body replay and safe follow-up PATCH; different owner cannot resume it; navigation sign-out copy remains truthful. Use controlled request promises/Playwright network interception rather than sleeps.
- [ ] **4. Run targeted browser tests:** `cd client && npm run test:e2e -- notes-editing.spec.ts notes-browsing.spec.ts`; expect PASS. Keep prior explicit 409, existing Note editing, #70 browse and Task editor regressions green.
- [ ] **5. Triage each of the six SonarCloud issues** from the exact PR head: open https://sonarcloud.io/project/issues?id=krishna916_horizon&pullRequest=86&issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true (or the GitHub SonarCloud Code Analysis check annotations), record **rule key, file+line, severity, finding, true/false positive, impact and action** in the PR comment. Current GitHub Sonar check summary confirms six but does **not** provide exact rule details in this plan; do not guess them.
- [ ] **6. Fix only confirmed actionable Sonar findings** (especially bugs/security/correctness). Add matching tests, run red/green, keep unrelated stylistic cleanup out of scope. For low-value informational findings, document why deferred/accepted; do not globally suppress rules. If issue detail is inaccessible, explicitly flag it rather than claim all six resolved.
- [ ] **7. Run full gates:** `cd client && npm run verify && npm run test:e2e`; inspect GitHub check run results, SonarCloud reanalysis (if source changed), CodeRabbit as available. Existing passing CI is baseline, not proof of new tests. If backend untouched, avoid backend migration/code changes.
- [ ] **8. Commit E2E/tests/targeted fixes:** `git add client && git commit -m "test(notes): cover final autosave and editor identity races"`; if valid Sonar changes are distinct, commit each focused change separately.
- [ ] **9. Update PR #86** with task→commit→test evidence, a SonarCloud six-item triage summary, and remaining known limitations. Re-run the original manual three failures as regression checks. The Tag reports remain deferred to #72.

## Final acceptance

- [ ] The sign-out confirmation cannot silently convert previously unsent changes into server writes while awaiting user choice; behavior remains honest if a request was already issued.
- [ ] Re-entering `/notes/new` always initializes a fresh coordinator/draft, while the intentional first-create ID replacement preserves the live Tiptap instance.
- [ ] A restored frozen POST is classified uncertain, retried with exactly its original UUID/body and only for the verified original owner.
- [ ] Six SonarCloud issues are individually triaged; any valid correctness/security issues are fixed and tested, optional style noise explicitly explained.
- [ ] All relevant unit, Playwright, quality and ownership/Tags-scope checks pass.

**Handoff:** Continue on PR #86's existing branch (`feat/71-notes-rich-editing-autosave`). Execute this plan inline, **NO SUBAGENTS**. This plan is a **documentation-only addition**; no production fixes were implemented by the reviewer when saving it.
