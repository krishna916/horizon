# PR #42 — Tasks List Review Remediation Plan

> **For Luna / implementing agent:** This is a focused review-fix plan that supplements, but does not replace, the approved [Issue #17 specification](../specs/2026-10-18-issue-17-task-list-design.md) and [implementation plan](./2026-10-18-issue-17-task-list-implementation.md). Follow repository `AGENTS.md`, `client/AGENTS.md`, and test-first conventions. Work in the existing checkout on `feat/issue-17-task-list`; **no worktree or new feature branch required**.

**PR:** https://github.com/krishna916/horizon/pull/42  
**Review baseline:** head `4a0e03fd6a0c74f8d226d50dd9c5db23afc3460c`, inspected 2026-10-18. Re-check latest code before each fix.  
**Goal:** Make the read-only Tasks workspace reliably readable and visually faithful; prove its session-isolation behavior; close verification gaps without expanding #17 into later feature stories.

## Review findings and decisions

| Priority | Finding | Required outcome |
| --- | --- | --- |
| P2 — fix in PR | `TaskRow.tsx` truncates long task titles with Tailwind `truncate`; approved mockup wraps titles | Every title remains readable, including very long/unbroken words, at desktop and narrower widths |
| P2 — verify / adjust in PR | `TaskWorkspace.tsx` uses `max-w-5xl`, a smaller/heavier heading, and spacing potentially different from approved `01-list.jpg`; live browser check was blocked by `/users/me` HTTP 502 | Compare a running authenticated Tasks page with approved reference in light/dark, make only focused styling corrections, report screenshots or concrete evidence |
| P1 risk — investigate, then disposition | Task queries are scoped to `['tasks', userId]`, but current-user cache has a five-minute stale time; authentication changes in another browser tab can leave the first tab displaying the previous user's already-rendered tasks | Reproduce/prove actual risk; if confirmed, implement a minimal, tested identity-change guard that works across tabs **or** raise a dedicated auth-hardening issue and get explicit owner acceptance of the outstanding privacy limitation **before merge**. Never mark the risk fixed merely because the query key includes `userId` |
| Quality visibility — inspect | SonarQube Cloud currently reports five new issues and 0.0% new-code coverage even though Vitest passes | Triage actual Sonar issues, fix relevant findings; distinguish missing coverage-report ingestion from missing tests and avoid incidental tooling changes without justification |

### Scope and non-goals

- This plan is **not** permission to add task detail, creation, editing, completion, archive, sort, history toggles, tags or attachments; those are separate issues.
- Do not change Task API, backend authorization, Flyway migrations, or the `TaskSummaryResponse` contract.
- Preserve browser-local completed-today classification, midnight rollover, user-scoped queries, conditional Completed section and Active empty state.
- Do not copy the standalone mockup's DOM/CSS wholesale; match visual intent via existing Tailwind/theme tokens.
- Do not silently introduce `BroadcastChannel`, local-storage synchronization, polling, interceptors, global cache clearing, or new dependencies without first confirming the reproduction and assessing scope.

## Task 1 — Make full task titles visible (required before merge)

**Files:** `client/src/task/TaskRow.tsx`, `client/src/task/TaskRow.test.tsx`.

- [ ] Write an RTL test using (a) a multi-sentence task title and (b) a very long unbroken token. Assert the full text is present and the title is **not** styled with `truncate`, `text-ellipsis`, `overflow-hidden` or `whitespace-nowrap`; verify suitable wrapping classes or behavior. Keep assertions semantic and robust.
- [ ] Run the focused test and confirm it fails on current code.
- [ ] Replace `truncate` with normal wrapping / `break-words` or `[overflow-wrap:anywhere]`; preserve completed title strikethrough and text treatment.
- [ ] Check the row grows rather than clips or overlaps its metadata. Verify both long-line and unbroken-text cases in a real browser where available.
- [ ] Run focused tests and commit only related changes.

**Acceptance:** Complete title is readable without a clickable detail view (#19 not yet available); the row remains inert, with title then key/priority/due date on the second line.

## Task 2 — Verify and align actual appearance (required before merge)

**Files:** Inspect/adjust only `client/src/task/TaskWorkspace.tsx`, `TaskSection.tsx`, `TaskRow.tsx` and directly related component tests if needed.

- [ ] Compare **`docs/design/tasks-workspace/screenshots/01-list.jpg`** and `DESIGN-SPEC.md` against the real authenticated `/tasks` route inside the existing AppShell. Distinguish intentional differences (no fake controls) from incorrect layout.
- [ ] Resolve the reported local `/users/me` HTTP 502 from **environment/API startup, proxy, session or backend configuration** first; do not mock production tasks or change auth behavior just to produce a pleasing screenshot. If the environment cannot be restored, explain the blocker and provide equivalent repeatable verification evidence before requesting final sign-off.
- [ ] Verify desktop content width/alignment, heading size and weight, top/section spacing, row density, section count presentation, key style, priority badge, and due-date icon/style. In particular, inspect the interaction between global `h1` margins and feature Tailwind classes.
- [ ] Verify **light and dark modes** using the live Horizon theme provider, including nonempty and empty Active, Completed Today visible/absent, and a wrapped long title.
- [ ] Make the smallest styling changes required for approved fidelity. Do not impose an arbitrary new maximum width or change AppShell; avoid speculative redesign.
- [ ] Capture screenshots when possible, record deviations/intentional omissions, and rerun the focused/full frontend tests.

**Acceptance:** A reviewer can compare actual app output to the approved initial design; cosmetic differences are either corrected or explicitly explained with evidence.

## Task 3 — Reproduce and disposition cross-tab session isolation (privacy-sensitive)

**Relevant existing paths:** `client/src/user/hooks/useCurrentUser.ts`, `useLoginUser.ts`, `useLogoutUser.ts`, `client/src/routes/_authenticated.tsx`, `client/src/task/useTaskList.ts` and `TaskWorkspace.tsx`. Do not edit all of them automatically.

- [ ] First document the auth behavior: `['me']` current-user cache with `staleTime: 5 minutes`; login invalidates `['me']`; logout sets it to `null` then invalidates; Task data is keyed by user ID; `beforeLoad` uses `ensureQueryData`. Check how **another tab's** successful logout/login affects a still-mounted Tasks view and how returning focus/route navigation interacts with stale query data.
- [ ] Reproduce with two tabs sharing the same browser origin/session: authenticate as A in tab 1 and load A's tasks; switch to B in tab 2; return to tab 1 before `['me']` naturally refreshes. Check whether A's private rows are still rendered while the server session now belongs to B. Also verify same-tab logout/login and pending `['me']` responses.
- [ ] Add a deterministic regression test at the appropriate **authentication/session boundary**, not a test that merely rerenders `useTaskList(1)` as `useTaskList(2)` manually. Use a test harness simulating actual shared session changes or documented browser integration. Verify the existing user-scoped query itself already works; don't duplicate tests to claim cross-tab safety.
- [ ] If the issue is confirmed and a narrow correction is possible, design and implement a **session-identity revalidation and private-cache visibility guard** (including cancellation/clearing of stale private-query views as warranted) using existing mechanisms. Verify timing: no A data becomes visible under B, including when `/users/me` refetch is pending, failed, or responds after an earlier request.
- [ ] If the fix would require a broad cross-tab auth coordination architecture or materially changes user/session behavior, **do not expand #17 silently**. Create a dedicated GitHub security/auth-hardening issue with reproduction, risk and proposed remedy, and ask the owner to decide whether to block merging #42 or explicitly accept this pre-existing limitation for the short term.
- [ ] Document actual observed result and disposition in the PR. Never claim the risk resolved purely from `['tasks', userId]` or tests mocking user-ID changes.

**Acceptance:** Either a tested correction prevents stale cross-tab private-data display, or the issue is explicitly tracked with an owner-approved merge disposition. No unrelated authentication refactor.

## Task 4 — Quality checks and final review

- [ ] Inspect SonarQube Cloud's **five new issues** on PR #42; fix valid relevant issues. Record why any remaining issues are deferred or false positives.
- [ ] Understand the **0% new-code coverage** metric: verify whether `client` Vitest coverage is collected/forwarded to Sonar. Do not confuse this metric with the reported **54 passing tests**. Keep configuration work to a follow-up if out of scope, unless it blocks existing required quality gates.
- [ ] Run from `client/`: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`. Re-run timezone tests per the approved implementation plan; check GitHub CI after pushing fixes.
- [ ] Review `git diff master...HEAD` for unrelated changes; confirm behavior unchanged beyond approved corrections and verified auth safeguards.
- [ ] Update PR conversation with exact remediation, evidence (including visual screenshots if produced), test counts, unresolved risks and references to any newly created follow-up issue.
- [ ] **Do not merge PR #42 automatically.** Request follow-up review once the plan is complete.

## Completion report template

| Review item | Outcome / evidence |
| --- | --- |
| Title wrapping | Test + code diff + browser evidence |
| Approved visual match | Light/dark screenshots, explained deviations |
| Cross-tab session risk | Reproduction result, test, fix OR linked auth issue + explicit owner disposition |
| Sonar findings | Five findings triaged; coverage-ingestion explanation |
| CI and local checks | Actual commands and outcomes |
| Scope | Confirm no future Tasks stories implemented |

**Handoff:** Perform fixes in the **existing** `feat/issue-17-task-list` checkout using test-first steps, make small commits, and push the same PR branch. Escalate only material scope/auth decisions. Keep the PR unmerged for review.
