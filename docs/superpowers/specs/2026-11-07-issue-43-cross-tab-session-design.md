# Issue #43 — Cross-Tab Authentication Session Hardening

**Approved design specification**  
**Date:** 2026-11-07  
**Issue:** https://github.com/krishna916/horizon/issues/43  
**Intended repo path after approval:** `docs/superpowers/specs/2026-11-07-issue-43-cross-tab-session-design.md`  
**Status:** Approved by owner on 2026-11-07; implementation awaits plan review.

## 1. Intent

Close the client-side privacy window in which an inactive Horizon tab can continue displaying data for account A after another tab replaces the shared same-origin Spring session with account B. The receiving tab must stop exposing private data as soon as it observes a session-change notification, verify the authoritative session, and then adopt the verified account without requiring a second login.

This is **frontend session-coordination hardening**, with one closely related **backend registration correction** approved by the owner. It is *not* evidence of a server-side authorization bypass; existing owner-scoped backend access remains in place.

## 2. Sources and reconciliation

- GitHub issue #43 and merged PR #42; existing `TaskSessionBoundary.test.tsx` demonstrates that focus revalidation hides stale Task content **after focus**, not proactively on cross-tab login.
- `HORIZON_CONSTITUTION.md`: session-based auth, ownership-based authorization, TanStack Query for server state, React-local UI state, modular monolith, and explicit boundaries.
- `PRD-004 Tasks`: Task lifecycle uses `completed_at`, `archived_at`, and `deleted_at` facts to derive views; issue #43 neither changes this nor introduces a task `status` column/enum.
- `SPEC-001 Shared Concepts`, `PRD-003 Inbox`: review, archive, trash, and lifecycle metadata are separate from authentication. No change is intended.
- `ENG-002 Frontend Engineering Guide`: application composes, features own behavior; shared technical coordination belongs at the application/authentication boundary.
- Verified implementation (`master`, inspected 2026-11-07): `['me']` revalidates on window focus (`staleTime: 0`); Tasks data is keyed under `['tasks', userId]`; Task workspace/detail and notices hide during current-user refetch; login and registration invalidate `['me']`; logout sets it to `null` and invalidates; Tasks draft navigation guard can block route transitions.
- **Mismatch discovered:** backend `UserCommandService.register()` creates an account but does not establish a Spring Security session, despite the registration UI navigating to authenticated Home. Owner chose to fix this as part of #43.

No relevant PRD defines a contradictory cross-tab authentication workflow. No changes to task status/lifecycle semantics are approved or necessary.

## 3. Owner-approved decisions

1. **Registration auto-signs in:** A successful registration establishes a new authenticated Spring Security session, analogous to login. An unsuccessful registration must not produce an authenticated session-change notification.
2. **Account changes auto-switch tabs:** After authoritative verification, receiving tabs adopt the now-authenticated account and preserve the current route where possible.
3. **Invalid vs. temporarily unverifiable session:** A confirmed HTTP 401/invalid session hides private UI and redirects to `/login`. A network failure or HTTP 5xx hides private UI, retains the route, and offers Retry; it does not infer logout.
4. **Notification transport:** Use a small `localStorage` session-change marker plus `storage` listener, not `BroadcastChannel`, polling, an additional dependency, or stored credentials/account IDs.
5. **Inaccessible selected task:** For `/tasks/{id}` and `/tasks?task={id}`, if the newly verified account cannot access that task (confirmed 404), replace the route with `/tasks`; keep unrelated valid routes. Temporary task-fetch failures do not cause a 404 fallback.
6. **Unsaved drafts:** During verification, hide A's drafts but preserve their local state provisionally. Restore drafts if verification confirms A; discard them, their queued actions, and their navigation blockers if verification confirms B. Invalidated/logout sessions must not expose stale drafts.

## 4. User-visible behavior and invariants

### 4.1 Successful login / registration / logout in the originating tab

- Finish the server operation successfully before announcing a cross-tab change. Failed login, failed registration, and failed logout **do not** publish a change.
- Update the originating tab's own auth/query state directly; `storage` events do not fire in the tab that writes them.
- Write a **non-sensitive, opaque, changed-on-each-success marker** to one versioned `localStorage` key. It represents only “revalidate the session,” never the identity, operation, credentials, cookie, access token, or session ID.
- Successful login/registration proceeds to authenticated Home, subject to existing navigation rules. Successful logout proceeds to Login.

### 4.2 A receiving tab detects a new marker

- In the notification handler, **invalidate trust in the displayed account immediately**, before initiating async network work. Render a neutral verifying view rather than private task rows, task details, draft controls, user email, sidebar/account-specific notices, or other authenticated content.
- Prevent user interaction with stale account-scoped commands and navigation actions while the session is unverified.
- Cancel applicable in-flight private **queries** and prevent their late results from restoring old UI. Use a generation/epoch check or equivalent to ensure only verification for the latest observed marker can re-enable display.
- Fetch `/api/v1/users/me` from the server; do not accept the cached `['me']` result as proof of identity. On success, expose only the newly verified account's data and re-evaluate the current route. Existing per-owner Task query keys remain required.
- On confirmed account change, discard old-owner private cached queries and local ephemeral UI/draft state. On same-owner revalidation, preserve drafts and refresh server data as needed.

### 4.3 Suspended or newly resumed tabs

- Listen for `storage` while the page is running, and also compare the marker on `visibilitychange`/window focus (and at initialization as appropriate), because suspended tabs may process events late.
- Keep the existing focus-driven `/users/me` revalidation for changes not initiated by Horizon UI (for example, idle session expiry or invalidation elsewhere).
- A frozen/suspended tab cannot run JavaScript immediately: “immediately” means **on delivery/observation of the marker**, not a promise to clear a frozen tab before the browser resumes it.
- Storage access can be unavailable in some browsing contexts. It must not crash the application; verification on focus/request remains a fallback. This is a documented limitation of Option B.

### 4.4 Invalid session, temporary failure, recovery

- Any authoritative session-check `401` (and any existing equivalent unauthenticated response required by app security) clears trusted identity, hides private content, and navigates to Login. Other authenticated API `401` responses must not leave private UI exposed; distinguish authenticated-resource auth failure from ordinary owner-scoped `404`.
- Network errors, timeouts, and HTTP `5xx` during `/users/me` do **not** cause an automatic logout. Show a neutral failure state and Retry on the same route. Retry must make a fresh `/users/me` request, and content stays hidden until it succeeds.
- A stale or cancelled response from a preceding session epoch cannot restore A's content after B has been verified, or restore content following logout/401.
- Do not indiscriminately purge draft state on transient failure if the same user may be confirmed on retry; keep that state inaccessible while trust is unresolved.

### 4.5 Routes and task drafts

- Preserve `/tasks`, `/today`, `/inbox`, `/`, and other valid routes when the verified identity changes. Let the appropriate feature reload under the new identity.
- On a selected Task route, issue an owner-scoped detail request. Keep the old detail hidden while it resolves. A confirmed `404` after account change replaces `/tasks/{id}` or `/tasks?task={id}` with `/tasks`, clearing task-selection navigation state. Do not redirect for `5xx` or network errors; retain the route with the appropriate retry/error view.
- Account-driven route changes must **not** be stopped by an A-owned unsaved-draft navigation blocker. Discard A's blockers/queued saves/undo actions once B is confirmed; ordinary same-account edits retain their usual navigation protection.
- Do not force task-detail fallback merely because an ID has not yet been verified. Account B may legitimately own an existing matching ID, and the backend is authoritative.

## 5. Approved engineering shape (not an executable plan)

- **A single auth/session coordinator** near `client/src/App.tsx` / authenticated route boundary owns the marker subscription, trust/verification state, and latest-generation protection. Avoid adding synchronization code individually to `TaskWorkspace`, `TaskDetailSurface`, and future features.
- **A private-content visibility boundary** covers all authenticated surfaces, including shell/profile UI, while preserving provisional same-account drafts. This boundary must make old content non-visible, non-interactive, and unavailable to assistive-technology navigation during verification. On an account change it resets owner-scoped state rather than reusing A's component tree under B.
- **User/auth hooks** (`useLoginUser`, `useRegisterUser`, `useLogoutUser`) publish only after successful server operations; centralize publication to avoid different meanings for the same marker.
- **TanStack Query:** keep `['me']` and existing owner-keyed Task queries; session changes must perform authoritative verification instead of relying solely on `invalidateQueries`. Cancelling/invalidating queries does not guarantee an already-dispatched mutation was cancelled server-side; prevent late UI/cache writes by verifying owner **and session generation**.
- **Backend:** refactor the existing login session-establishment behavior into one shared internal path reused by successful registration. Preserve session-fixation safeguards and security context persistence. No authentication endpoint shape or task backend contract changes are proposed.
- **Route reconciliation:** at an application/task routing integration boundary after verified owner change, reuse existing Task `404` behavior while adding the approved replace-to-list fallback. Do not bypass normal draft guards for routine same-account navigation.

No new global state-management library, persisted user ID, polling, backend messaging infrastructure, task status enum, or Task database migration.

## 6. Alternatives considered

| Option | Benefit | Cost / reason not selected |
| --- | --- | --- |
| `BroadcastChannel` | Direct cross-tab communication | User preferred localStorage marker for current scope |
| **`localStorage` marker + existing server revalidation (selected)** | Small, dependency-free, no persisted identity, easy to inspect | Browser suspension and restricted storage still require focus fallback |
| Hybrid marker plus BroadcastChannel | Additional delivery path | Extra coordination complexity not justified for V1 |
| Poll `/users/me` periodically | Detects silent session expiration eventually | Adds traffic, doesn't guarantee privacy during background suspension, and is unnecessary for this issue |

## 7. Tests and acceptance evidence required of Luna

1. **Backend integration:** Register returns the new account and valid `SESSION` cookie; the cookie authenticates `/users/me`; session is fresh when registration replaces an existing account session; duplicate/invalid registration does not emit a successful authentication event or incorrectly switch identity.
2. **Two-tab frontend integration:** A task list/detail is visible in tab A; successful B login/registration in tab B changes marker; tab A hides all A-private content **before** its `/users/me` resolution; then shows only B data. Test logout similarly.
3. **Focus recovery:** A tab that misses/delays a storage event notices the changed marker when visible/focused. Existing focus revalidation still handles expired sessions with no marker.
4. **Failure handling:** A `401` redirects to Login with no private content; network/`5xx` leaves a hidden, retryable shell; successful Retry confirms identity before restoring content. Failure to write/read `localStorage` does not crash login/logout/registration.
5. **Race handling:** Two rapid session changes or an old `/users/me`/Task response resolving late cannot revive A content or poison B's caches. Failed auth operations must not broadcast.
6. **Drafts:** A dirty task draft is hidden during verification, restored on same-A confirmation, discarded on B confirmation; no old-owner save/undo/retry or draft blocker is actionable under B.
7. **Routes:** After B verification, valid routes persist. Inaccessible selected task yields a confirmed `404` and is replaced with `/tasks`; `5xx` retains the route and offers retry. Cover full-page and query-parameter side-panel routes.
8. **Browser check:** Use two actual same-origin tabs (prefer a real backend session with two test accounts) plus deterministic Vitest/React Testing Library and Playwright where practicable. Record any live-environment limitation explicitly; do not claim a real two-account browser reproduction based solely on mocks.
9. **Verification:** Run the existing frontend test, typecheck, lint, format-check, build, and relevant backend integration suites. Keep all tests in the owning modules; no unrelated refactor.

## 8. Risks, boundaries, and operational limitations

- A browser tab may remain frozen with old pixels visible in its compositor until the browser wakes it; client-side storage events cannot overcome browser suspension. The design protects content on observation/resume and continues server-side owner checks.
- The issue is a visual/interaction privacy boundary, not a guarantee that previously fetched private values disappear from every browser memory allocation immediately. During same-owner revalidation, provisional draft state remains held but inaccessible; on a confirmed owner change, it is discarded.
- Session invalidation from an already-sent mutation cannot always abort the backend operation. Protect post-response UI/cache updates, and keep backend authorization authoritative.
- Avoid confusing a task-ownership `404` with a lost session `401` or with transient network/`5xx` failures.
- The shared authenticated shell currently derives profile UI from `useCurrentUser`; an auth guard that covers only Task rows would leave a privacy gap.
- Existing Task navigation guards can intercept redirects; account-switch transitions need an explicit safe reset/bypass path, limited to this case.

## 9. Ownership and handoff

This design spans the **user/auth frontend**, the **application authentication boundary**, **small Task routing/draft integrations**, and **backend registration session establishment**. It should be implemented as one focused issue with test-first, reviewable commits—not as a new generalized authentication framework.

Executable Superpowers plan: `docs/superpowers/plans/2026-11-07-issue-43-cross-tab-session-implementation.md`. It contains exact files, interfaces, failing tests, commands, and sequential steps for **Luna to execute inline**. Commit the handoff artifacts; do not start product-code implementation automatically.