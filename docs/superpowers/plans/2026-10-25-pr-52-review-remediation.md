# PR #52 — Review Remediation Implementation Plan

> **For Luna:** Follow `superpowers:executing-plans` and `superpowers:test-driven-development` directly in the **existing checkout**, on `feature/25-task-history-archive-visibility`. **No isolated worktree, no subagent implementation.** Check off each step, run actual tests, make small commits, push to the existing PR; **do not open a replacement PR or merge**.

**Goal:** Address the verified date-classification edge case, strengthen the completion-retention E2E regression, and triage reported SonarCloud findings without expanding issue #25 scope.

**Architecture:** Keep the existing pure client-side classifier, one owner-scoped task list query, browser-local day semantics and Tasks-route temporary state. Change the minimum necessary code/tests; treat SonarCloud metrics and minor coupling feedback independently rather than adding infrastructure to this feature.

**Tech Stack:** TypeScript, React 19, Vitest, React Testing Library, Playwright, existing TanStack Router/Query; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-issue-25-task-history-visibility-design.md`

**Original plan:** `docs/superpowers/plans/2026-10-25-issue-25-task-history-visibility.md`

**PR:** https://github.com/krishna916/horizon/pull/52
**Base:** `master`
**Existing head branch:** `feature/25-task-history-archive-visibility`
**Review scope:** Review of PR head `f45bd35bb985369ad372a5bd1282ad7e07f843c4` on 2026-10-25, subject to checking the live diff again before editing.

## Global Constraints

- **Use the existing feature branch in the normal repository checkout.** `git fetch origin && git switch feature/25-task-history-archive-visibility && git pull --ff-only`. Inspect `git status --short` first; do not overwrite local edits.
- No worktrees, no subagent implementers, no separate PR, no merge. All code changes by Luna in this session. Read-only independent review is allowed, but not necessary if unavailable.
- The approved issue #25 design governs behavior; preserve existing Active retention, archived precedence, derived status, local timezone, and temporary view-state lifecycle.
- Never modify backend, schema, API, sorting, preferences or global state for this remediation.
- Verify each review concern **against current code** before changing it. Fix only still-valid defects. Record reasons for skipped/accepted/deferred items; do not blindly trust review or Sonar warnings.
- RED → GREEN tests for behavioral fixes; run formatting, type checking, build and full frontend tests before push. Make incremental commits.
- Product decisions already approved; do not silently re-interpret them. Escalate genuinely new product ambiguities rather than assume.

## Review Focus

- A **tomorrow-local-date** `completedAt` must *not* be revealed by a switch described as **Completed history**.
- **Today-local-date** completions remain eligible even if their timestamp is later on the same day than `now` (clock skew); the boundary is the **local calendar day**, not the current instant.
- Older completions still appear under history regardless of UTC date; malformed timestamps remain excluded. Archived-completed entries never enter Completed.
- Playwright's frozen **browser clock** does not automatically freeze `new Date()` in the Node-side mocked API; use a deterministic server completion timestamp.
- A newly completed task moves from temporarily retained Active into today's Completed **after full-page navigation**, with **Completed history still off**.

---

### Task 1 — Correct future-local-day inclusion in the pure classifier (required)

**Files**
- Modify: `client/src/task/task-view.ts`
- Modify: `client/src/task/task-view.test.ts`

**Interfaces**
- Preserve the existing exported `classifyTasks(tasks, now, retainedCompletedIds?, effectiveCompletedById?, visibility?)` signature and `TaskSections` result.
- Preserve `isSameLocalDay`, browser-local calendar-day classification and existing input ordering. No new public state or dependency.

- [ ] **Step 1 — RED:** Add `completedHistoryExcludesFutureLocalDays` in `task-view.test.ts`, with e.g. `now = new Date(2026, 9, 26, 12)`, yesterday `2026-10-25T12:00` in local time, today `2026-10-26T15:00` local (later *today*), and tomorrow `2026-10-27T09:00` local. With history off expect only today. With history on expect yesterday and today but not tomorrow. Assert order preserved and no mutation. Add an `Asia/Kolkata` offset example around the 18:30Z local midnight as an additional assertion in the existing offset test. Keep invalid timestamps excluded and archive precedence covered.
- [ ] **Step 2 — Verify RED:** From `client/`: `npm run test -- src/task/task-view.test.ts`. Expected: the new tomorrow-date assertion fails on the current implementation specifically because `showCompletedHistory` includes it.
- [ ] **Step 3 — GREEN:** In `task-view.ts`, compute **start of the current browser-local day** from `now.getFullYear()`, `now.getMonth()`, `now.getDate()` using local `new Date(year, month, day)`; include a non-archived valid completion iff `isSameLocalDay(completedAt, now)` **or** (`showCompletedHistory` and `completedAt.getTime() < startOfLocalDay.getTime()`). Avoid comparing simply `completedAt < now`, which would wrongly exclude later-today completions. Keep the existing optimistic-null timestamp fallback and retained Active precedence intact.
- [ ] **Step 4 — Verify GREEN:** `npm run test -- src/task/task-view.test.ts`. Expected: all existing and new tests pass.
- [ ] **Step 5 — Commit:** `git add client/src/task/task-view.ts client/src/task/task-view.test.ts && git commit -m "fix(tasks): exclude future completions from history"`.

### Task 2 — Strengthen browser regression for retained completions (required)

**Files**
- Modify: `client/e2e/task-history-visibility.spec.ts`

**Interfaces**
- Keep the existing `installTaskApi(page, initialTasks)` mocking pattern, Playwright `timezoneId: 'Asia/Kolkata'`, `page.clock.install`, and existing task navigation.
- Where a mocked `POST /tasks/:id/complete` response is exercised under frozen browser time, provide an **explicit deterministic completion timestamp** to the mock instead of relying on Node-side `new Date()`.

- [ ] **Step 1 — RED:** Extend test `releases temporary Active completion retention on a full-page trip` so **Completed history remains off** throughout the test. After completing, assert the task is in Active but not in Completed; after opening the task panel, canonical full-page route and returning to the list, assert it is absent from Active and visible in Completed **by default**. Assert the switch is still off and the completion's archived state unchanged. Existing independent visibility/navigation test continues to cover history on.
- [ ] **Step 2 — Verify RED:** `npm run test:e2e -- task-history-visibility.spec.ts`. Under the existing Node-generated completion timestamp, the newly strengthened test may fail because test-server and browser clocks differ; if it already passes, record evidence rather than manufacturing a failure.
- [ ] **Step 3 — GREEN:** Align the fixture: for this test the browser time is `2026-10-26T06:30:00.000Z` (local `2026-10-26 12:00 Asia/Kolkata`). Make the mocked completion response return a stable same-local-day timestamp (for example that same UTC instant). Prefer a small optional `completionTimestamp` parameter to `installTaskApi` over changing every test's setup. Keep other tests' behavior unchanged.
- [ ] **Step 4 — Verify GREEN:** `npm run test:e2e -- task-history-visibility.spec.ts`. Expected: all its tests pass and the new assertions prove **default-history-off** behavior across the retention boundary.
- [ ] **Step 5 — Commit:** `git add client/e2e/task-history-visibility.spec.ts && git commit -m "test(tasks): verify today completion after full-page navigation"`.

### Task 3 — Triage SonarCloud findings; fix only verified, relevant issues (required review activity; conditional code changes)

**Files**
- Read: [SonarCloud PR #52 dashboard](https://sonarcloud.io/dashboard?id=krishna916_horizon&pullRequest=52) and [new issues](https://sonarcloud.io/project/issues?id=krishna916_horizon&pullRequest=52&issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true)
- Read: `.github/workflows/ci.yml`, `client/package.json`, relevant Sonar config and issue-specific source files as discovered.
- Modify: **only** the files implicated by still-valid in-scope findings. Do **not** automatically rewrite CI or add coverage tooling for this feature.

**Interfaces**
- No new public interfaces required. Preserve existing eslint/prettier/toolchain and tests.

- [ ] **Step 1 — Investigate:** SonarCloud reported **5 new issues** and **0.0% coverage on new code** at the reviewed head, while its quality gate passed. Retrieve each current issue's **rule key, severity, exact path/line and message** from the Sonar dashboard/API if accessible. Verify against actual current code. If inaccessible, say **unverified**, link findings and avoid inventing details/fixes.
- [ ] **Step 2 — Classify:** For each issue record `fix now` (confirmed correctness/security/accessibility or high-confidence in-scope defect), `defer` (minor cosmetic/maintainability beyond #25), `already fixed`, or `not reproducible/false positive` with brief evidence. Do not claim a finding resolved merely because quality gate is green.
- [ ] **Step 3 — Fix selectively:** For confirmed in-scope defects, first write/adjust a focused regression test, verify RED where applicable, minimally fix, verify GREEN, then commit with an accurate `fix:` message. If a finding requires an unapproved new product behavior or significant CI redesign, **do not silently do it**—record as follow-up and flag to owner.
- [ ] **Step 4 — Diagnose coverage signal:** `client/package.json` has `@vitest/coverage-v8`, but `npm run test` currently uses `vitest run`; `.github/workflows/ci.yml` runs tests/build without an evident frontend LCOV publish step. Inspect the actual Sonar configuration before concluding the cause. **0.0% measured new-code coverage is not the same as zero tests.** Record cause (or limitation) in PR and recommend a separate quality-tooling follow-up unless a tiny, safe configuration-only fix is plainly in scope.
- [ ] **Step 5 — Report:** Summarize current issue count and disposition in the PR, including links and exact findings that could not be accessed. Do not add blanket suppressions, abandon required tests, or invent Sonar rule IDs. A remaining minor Sonar issue is not automatically a merge blocker; disclose its impact.

### Task 4 — Final validation, scope gate, and update existing PR (required)

**Files**
- No product files expected beyond Tasks 1–3.
- Update PR #52 description or add a concise PR comment reporting remediation (do not modify the original issue scope).

- [ ] **Step 1 — Validate:** From `client/`, run `npm run test`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm run test:e2e`. Read full outputs and exit codes; no success claim without evidence.
- [ ] **Step 2 — Review:** Inspect `git diff origin/master...HEAD` and `git diff` for unintended changes, duplicate classifications, local-day boundaries, archive precedence, new persistence or dependencies. Ensure the original issue #25 accepted behaviors remain intact.
- [ ] **Step 3 — Defer explicitly:** **Do not** extract `TaskViewState` / `DEFAULT_TASK_VIEW_STATE` out of `TasksRouteLayout.tsx` merely for aesthetic coupling; the current import is a minor, functional, local dependency and is not a merge blocker. Defer unless an actual cycle or concrete testability problem is found. Do not tackle global Sonar/coverage tooling here unless clearly necessary and approved.
- [ ] **Step 4 — Commit and push:** Commit any remaining deliberate fixes; ensure clean working tree; `git push origin feature/25-task-history-archive-visibility`.
- [ ] **Step 5 — PR update:** Keep **existing non-draft PR #52** targeting `master`, still containing `Closes #25`. Append a remediation summary with commits, regression proof, 6 command results, Sonar issue-by-issue triage, limitations/deferred work. Re-check PR CI on the newly pushed head. **Do not create another PR or merge.**

## Completion criteria

1. A future-local-day completion does not appear in Completed, even with Completed history on; previous local-day completions do.
2. Same-day completions (even later within the same local calendar day) and all already approved lifecycle behavior remain unchanged.
3. E2E proves completion retained in Active before and moved to Completed after a canonical-page round trip, **without enabling history**; frozen browser/mock-server clocks are aligned.
4. Sonar findings are actually examined or explicitly identified as inaccessible; no invented or unverified fixes.
5. Frontend tests, lint, formatting, typecheck, build and E2E pass on the final branch; fresh CI is checked after push.
6. The existing PR is updated and awaits owner review; no merge.
