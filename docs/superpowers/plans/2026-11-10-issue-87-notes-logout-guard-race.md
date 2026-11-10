# Horizon #87 — Fix the unsaved-Note sign-out navigation race

| Field | Value |
| --- | --- |
| Status | **Implementation plan approved** — not yet implemented |
| Date | 2026-11-10 |
| Issue | https://github.com/krishna916/horizon/issues/87 |
| Origin | PR #86, Notes rich editing and autosave, merged to `master` |
| Priority | P1 — regression / data-integrity UX |
| Scope | Frontend; existing saved Notes and all Note navigation |

## 1. Objective

When a user edits a saved Note and immediately attempts to navigate away—especially via the real Sidebar **Sign out** button—the application must evaluate the Note's **current, synchronous save state** and block navigation while unsent changes exist. While the user considers the dialog, previously unsent writes must remain unsent. An explicit **Discard unsent changes and sign out** must not send those changes or restore the discarded draft after logout.

Preserve the established distinction between an **unsent** edit and an **already-dispatched or outcome-uncertain** write: an issued PATCH may still commit and cannot be promised to be undone by a client-side discard.

## 2. Confirmed owner decisions

1. **Guard scope:** Use synchronous coordinator state for **all Note navigation**, including sidebar links, Back, direct route navigation, Sign out, and browser unload checks. Do **not** build a logout-only exception.
2. **Logout API failure after Discard:** Keep the current logout-failure navigation/error behavior; the explicitly discarded changes **remain discarded**. Do not re-stash or recover them solely because the logout API failed.

## 3. Investigation and root-cause hypothesis

Code inspected on `master`:

- `client/src/note/NoteEditorPage.tsx`: title/body edits call `edit()` from `useNoteAutosave`.
- `client/src/note/useNoteAutosave.ts`: `coordinator.edit()` changes the coordinator immediately and publishes React state asynchronously; `canLeaveNow()` already reads `coordinator.snapshot()` synchronously.
- `client/src/note/NoteEditorNavigationGuard.tsx`: `useBlocker.shouldBlockFn` and `enableBeforeUnload` currently consult render-time `canLeave`. The guard already has a hold/release mechanism and synchronous state callbacks.
- `client/src/note/NoteSaveCoordinator.ts`: already implements a 900 ms debounce, navigation decision hold, in-flight/uncertain state and synchronous `snapshot()`.
- `client/src/app/layout/AppSidebar.tsx`: navigates to `/login` first and invokes logout only if navigation succeeds.
- `client/e2e/notes-editing.spec.ts`: current unsent-discard coverage primarily exercises `/notes/new`, not the reported immediate-click flow on a saved Note.

**Leading hypothesis, not yet proven:** The change is present in the coordinator, but the click that initiates navigation arrives before React commits the new render. The blocker evaluates stale `canLeave === true`, permits navigation, and never calls the queued-write hold. Confirm using a failing test **before** applying the code change. If the test does not reproduce, investigate route/blocker lifecycle and the Sidebar logout transition instead; do not force the hypothesized patch.

## 4. Scope boundaries

**In scope:** the Note navigation predicate; current synchronous coordinator access; preserving navigation holds and existing decision choices; focused unit/integration/browser tests; coverage for saved Note title and rich-text body; logout failure after an explicit discard; regression checks for `/notes/new`, route promotion, navigation, in-flight writes and session isolation.

**Out of scope:** backend/database/API changes; changing the 900 ms autosave interval; automatic undo/revert of issued PATCHes; new auth/logout infrastructure; global state libraries; draft persistence in browser storage; Note Tags (#72); other unrelated PR #86 partial manual checks; broad refactors.

## 5. Implementation tasks (red → minimal fix → green)

### Task 1 — Prove the stale-render navigation race

**Primary file:** `client/src/note/NoteEditorNavigationGuard.test.tsx`.

1. Add a red test that renders the guard with **stale rendered clean state** (`canLeave = true` in the existing interface), but `canLeaveNow()` reads **dirty current coordinator state** (`false`). Trigger `shouldBlockFn` from an existing Note route such as `/notes/7` to `/login`. Assert that it blocks and invokes `holdQueuedWritesForNavigation()` exactly once. The test should fail on current `master`.
2. Assert the same synchronous predicate protects a non-logout route and `enableBeforeUnload()`. Preserve clean navigation and the explicitly allowed first `/notes/new` → `/notes/{persistedId}` replacement.
3. Keep a focused unit case for an in-flight save, including behavior when the save is acknowledged during an open decision.
4. Run the focused test and capture the expected red result. Do not change production code until the failure demonstrates the defect.

### Task 2 — Fix the navigation predicate, not the logout workflow

**Primary files:** `client/src/note/NoteEditorNavigationGuard.tsx`, `client/src/note/NoteEditorPage.tsx`, and affected guard tests.

1. In `shouldBlockFn`, replace the render-time `if (canLeave) return false` check with `if (canLeaveNow()) return false`.
2. In `enableBeforeUnload`, evaluate `!canLeaveNow()` rather than the render-time value.
3. Keep the existing **first confirmed create-to-ID promotion** exception and all other navigation decisions intact.
4. Remove `canLeave` from the guard's public props and its `NoteEditorPage` call site if it is now unused. Do not remove the hook's exported `canLeave` unless repository usage confirms it is safe; prefer a minimal API cleanup.
5. Continue invoking the existing `holdForDecision()` **before** returning `true` from a blocked navigation decision; do not move the hold into a later effect or dialog render.
6. Preserve the existing `Stay`/hold release, `Wait`/`flush`, retry, discard, in-flight warning and two-step sign-out-anyway behavior. Do not change `NoteSaveCoordinator` or `useLogoutUser` unless a new red test proves another defect.

**Illustrative decision predicate:**

```tsx
shouldBlockFn: ({ current, next }) => {
  if (canLeaveNow()) return false;

  // Preserve the existing authorized /notes/new → /notes/{id} promotion.
  if (
    current.pathname === '/notes/new' &&
    persistedNoteIdNow() !== null &&
    next.pathname === `/notes/${persistedNoteIdNow()}`
  ) return false;

  holdForDecision();
  return true;
},
enableBeforeUnload: () => !canLeaveNow(),
```

Use the repository's formatting and existing helper style. This is a sketch, not a mandate to duplicate existing code or call the ID getter more often than needed.

### Task 3 — Add the real saved-Note browser regression

**Primary file:** `client/e2e/notes-editing.spec.ts`.

Create a deterministic browser test that uses the **real Sidebar Sign out button**, an **existing saved Note** (`/notes/{id}`), a controlled 900 ms debounce, and intercepted GET/PATCH/logout requests.

**Initial red scenario:**

1. Open a seeded saved Note with an original title and version.
2. Type a changed title, then immediately click Sidebar **Sign out** while the write is still debounced.
3. Assert the sign-out decision dialog appears; the current route is **not** `/login`; logout requests = 0; PATCH requests = 0.
4. Keep the dialog open past 900 ms (use Playwright clock control); assert PATCH requests = 0 and logout requests = 0.
5. Choose **Discard unsent changes and sign out**; assert logout is called **once**, route becomes `/login`, no later PATCH is dispatched, and no draft is re-stashed.
6. Simulate same-user re-login and reload the Note; assert that the server-backed original title remains unchanged.

Build the regression so it fails before the fix and passes after it. Avoid arbitrary sleeps, relying instead on controlled requests, clock advancement and observable state.

### Task 4 — Cover decision outcomes and edge cases

Extend focused Vitest and Playwright tests (reuse existing infrastructure, not a new test harness):

| Situation | Required result |
| --- | --- |
| Saved Note title edit → immediate Sign out | Dialog shown before logout/PATCH |
| Saved Note rich-text body edit → immediate Sign out | Same dialog and write hold |
| Decision dialog remains open longer than 900 ms | Previously unsent PATCH stays unsent |
| **Stay** | Remains in editor with edit intact; hold releases; normal autosave resumes |
| **Wait for save and sign out** | Queued edit saves; navigate/log out only after confirmed save |
| Save fails or remains unresolved | Do not silently proceed or call successful save |
| PATCH already dispatched | Accurate in-flight/uncertain wording; no false discard promise; two-step sign-out-anyway preserved |
| ACK arrives while decision is open | Preserve “previously sent” warning; no retroactive promise of discard |
| `/notes/new` and create-to-ID promotion | Existing guards/exception unchanged |
| Sidebar/non-logout/Back navigation | All use fresh synchronous save-state decision |
| Explicit Discard followed by logout API failure | Preserve existing logout error/back-navigation behavior; discarded draft stays discarded and is not restashed |
| Session verification/owner switch | Existing authenticated-session isolation and recovery rules unchanged |

Note: the issue reports only one confirmed failure. Do not label the separate partially verified PR #86 scenarios as newly discovered bugs.

### Task 5 — Verification and delivery

Run from `client/`:

```bash
npm run test -- src/note/NoteEditorNavigationGuard.test.tsx src/note/useNoteAutosave.test.tsx src/note/NoteSaveCoordinator.test.ts
npm run test:e2e -- notes-editing.spec.ts
npm run verify
npm run test:e2e
```

Perform the exact manual reproduction from issue #87 using a real authenticated local session, including same-user re-login, Note reload, and confirmation that the server title/body did not change on Discard. Also smoke-check normal saved Note edits, direct Notes navigation, `/notes/new`, sign-out with a clean Note, and an in-flight PATCH.

Before marking done, document: the red test failure; the minimal code change; focused and full test results; manual reproduction result; any environment-only test limitations; and any genuine follow-up issues found. Do not claim tests passed unless run.

## 6. Acceptance criteria / definition of done

- [ ] A saved Note edited just before Sign out always triggers the decision dialog while dirty, without navigating to `/login` first.
- [ ] No logout API call and no previously unsent PATCH while the dialog awaits a decision, even after debounce time passes.
- [ ] Discard cancels unsent writes, logs out exactly once, prevents restash, and leaves the original server Note unchanged after same-user re-login and reload.
- [ ] Stay retains edits and resumes autosave; Wait signs out only after a confirmed save.
- [ ] Issued or uncertain writes retain honest messaging and the existing two-step sign-out-anyway path.
- [ ] Both title and rich-text body edits are covered.
- [ ] Shared Note navigation and `beforeunload` use current coordinator state; `/notes/new`, create promotion, Task navigation and session isolation do not regress.
- [ ] Logout API failure after explicit Discard preserves existing failure navigation while leaving discarded edits discarded.
- [ ] Red regression demonstrated, then focused tests, full client `verify` and Playwright suite pass (or failures are explicitly reported).
- [ ] No unrelated architecture, backend, dependency or product-scope changes.

## 7. Handoff instructions for Luna

- Work **inline only**, without subagents or delegated execution.
- Begin from the current default branch and inspect current source before editing; reconcile any changes that occurred after this plan was written.
- Follow **red test → minimal production change → green tests → full verification**, one focused task at a time.
- Treat the **synchronous-state hypothesis as unconfirmed until the test fails**. If it is disproven, investigate the actual navigation chain and report the evidence rather than implementing an ungrounded fix.
- Keep the change narrowly scoped. Prefer existing hooks, coordinator and router contracts, preserving the current issue #87 acceptance criteria and both owner-approved decisions.
- Do not create a new abstraction or alter backend APIs without a newly demonstrated need and explicit design approval.
- After implementing, provide the diff summary, verification evidence and remaining risks for review. This plan itself authorizes planning, **not** a repository modification performed in this conversation.