# SDD ledger — plan: docs/superpowers/plans/2026-11-21-issue-73-notes-lifecycle.md

Base: 06ffc0f (approved lifecycle design and wire contract)

Pre-flight: Task 1 produces the four Note lifecycle transitions and `lockOwnedIncludingDeleted`; Tasks 2–3 consume these in lifecycle HTTP endpoints and recovery API. Task 1 implements the approved transitions with optimistic version checks and owner-scoped locks; no interface conflict found.

Task 1: RED verified — added domain and integration tests failed compilation because lifecycle methods were absent.
Task 1: complete — `./mvnw -Duser.timezone=UTC -Dtest=NoteTest,NoteCommandServiceIntegrationTest test` → 22 tests passed (0 failures/errors). Verified PostgreSQL version increments, no-op semantics, duplicate delete retry, stale conflicts, owner hiding, and archive/Inbox/content preservation. `git diff --check` clean.

Task 2: RED verified — lifecycle endpoint test failed as expected with `404` for the missing archive route.
Task 2: complete — `./mvnw -Duser.timezone=UTC -Dtest=NoteControllerIntegrationTest,NoteQueryServiceIntegrationTest test` → 17 passed; adjacent Tag/persistence command → 5 passed. No lifecycle migration or status field added. `git diff --check` clean.

Task 3: complete — `npm run typecheck` passed; targeted API/provider/query tests → 12 passed; private-query isolation tests → 4 passed; final combined verification → 16 passed. Cache writes use returned Note details/DELETE receipt versions; delete retry retains the original expected version. Commit: d6c11e3.

Task 4: RED verified — lifecycle coordinator tests initially failed because the preparation API was absent. Added a flush-and-hold gate that waits for in-flight autosaves, rejects blocked/uncertain saves, and requires progress; full-page Archive/Restore/Trash actions use the prepared server version and disable draft controls until completion. Verified `npm run typecheck`, focused frontend tests (66 passed), ESLint on changed files, and `git diff --check`. A test fixture initially omitted canonical server Tags and caused repeated saves; corrected the fixture and added a no-progress guard.

Task 5: RED verified — new Card/List assertions failed because no lifecycle action menus were rendered. Added shared Note-owned Archive/Restore/Trash actions with Radix keyboard menu and confirmation, keeping controls outside the navigation Link; action runs use the provider's current owner and Note summary version. Confirmed actions focus the next row or collection controls after removal. Updated standalone workspace/routing test wrappers for their lifecycle provider boundary. Verified `npm run typecheck`, focused Card/List/workspace/provider/route suites → 27 passed, ESLint with one existing Fast Refresh warning, and `git diff --check`.
