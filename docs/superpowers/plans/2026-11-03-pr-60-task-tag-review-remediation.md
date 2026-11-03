# PR #60 — Task Tag Review Remediation Implementation Plan

> **For Luna (agentic worker):** REQUIRED SUB-SKILL: use **superpowers:executing-plans** **inline, task-by-task**. **DO NOT dispatch subagents.** Follow RED → GREEN → focused commit for each task; no autonomous merge. This plan fixes the verified review observations; it does **not** authorize redesigning Issue #27.

**Goal:** Fix all five inline PR #60 review findings, add browser-level Task Tag regression coverage, and investigate/disposition SonarCloud's eight new issues and missing coverage measurement without introducing unnecessary infrastructure.

**Architecture:** Keep the approved Task-tag design unchanged: Task-owned associations, public \`tag.api\`, create-on-Task-Save, atomic replacement, user-scoped caches, independent Inbox and lifecycle states. Remediate small frontend cache, pending-edit, combobox, sorting, and accessibility concerns in their existing feature modules. Treat SonarCloud findings as a verification workstream, not as permission for blanket refactors.

**Tech Stack:** React 19 / TypeScript / TanStack Query v5 / Axios / Vitest / Testing Library / Playwright / Tailwind/shadcn, existing Java 25 / Spring Boot 4.0.6 / Maven / PostgreSQL 17 integration suite.

**Spec:** [Owner-approved Issue #27 design](../specs/2026-11-03-issue-27-task-tags-design.md); [original implementation plan](./2026-11-03-issue-27-task-tags.md); [approved Tasks workspace design](../../design/tasks-workspace/DESIGN-SPEC.md); [PR #60 and inline review](https://github.com/krishna916/horizon/pull/60).

## Global constraints

- Work **on the existing PR branch** \`feature/27-task-tags-assignment\`; do not create a competing feature branch. Baseline reviewed HEAD: \`26858f1e849805b9b9d6c58658a6a2169286b81b\` on 2026-11-03. First fetch and verify current HEAD/review threads; if it has advanced, reconcile each finding against current code before changing anything.
- Follow \`Agents.md\`, \`client/AGENTS.md\`, \`server/AGENTS.md\`, \`.agents/skills/align-context\`, \`docs/ai/INDEX.md\`, ENG-001/ENG-002 and the repo's \`testing-frontend\` / \`testing-spring-integration\` skills. For UI changes honor \`DESIGN.md\` / existing design context.
- **Do not use subagents**, merge, modify the eight approved product decisions, edit V1 PRDs speculatively, add a new tag endpoint, add a new dependency for ordinary UI behavior, or change backend database/domain/contracts unless a **confirmed** regression proves it necessary.
- Preserve **create Tag only on Task Save**. Tagging **must never change Inbox**; persisted Tags survive unassignment; Task lifecycle and ownership rules stay unchanged.
- Maintain owner-scoped \`['tags','suggestions',userId,prefix]\` caches, no cross-owner data exposure, no Tag POST on chip selection; existing Task creation retry snapshot and idempotency semantics stay intact.
- Fix only reproducible problems; avoid broad stylistic refactors. Where a finding was invalidated by newer commits, document the specific current evidence and skip it.
- Browser tests are Playwright **route-mocked contract/UX coverage** (the existing repo convention), not proof that the real backend persists changes. Keep PostgreSQL/Testcontainers integration tests as the backend proof.
- Use existing client commands from \`client/\`: \`npm run test -- src/task/<file>.test.tsx\`; \`npm run test\`, \`npm run typecheck\`, \`npm run lint\`, \`npm run format:check\`, \`npm run build\`, \`npm run test:e2e\`. Server from \`server/\`: \`./mvnw -Duser.timezone=UTC verify\` (on Windows \`mvnw.cmd\`). Only report checks actually executed.

## Review focus: failure modes to pin with tests

1. Previously cached empty prefix suggestions must refresh **after** a successfully saved new Tag (both POST and PATCH), but **not** on a failed save or in another user's cache — Task 1.
2. A delayed POST/PATCH from user A/task X must not block new user B/task Y editing or later reset its pending/error/edit state, even if old response resolves after a *new* save started — Task 2.
3. Tab, focus to another field, pointer click-away, Escape, and pointer selection must leave a sensible combobox state; active-descendant/controls must reference real nodes — Task 3.
4. Visually compact list rows must remain keyboard/open-action safe and provide tag context to assistive technologies without breaking existing accessible button names — Task 4.
5. Alphabetical presentation must not reorder the actual submitted selection set or accidentally remove the wrong ID/name when a sorted chip is clicked — Task 5.

## File map

\`\`\`text
client/src/task/useCreateTask.ts             modify: owner-scoped suggestion cache invalidation after successful create
client/src/task/useUpdateTask.ts             modify: owner-scoped suggestion cache invalidation after successful tag patch
client/src/task/useCreateTask.test.tsx       modify: cache freshness, owner and failure cases
client/src/task/useUpdateTask.test.tsx       modify: cache freshness, owner and failure cases

client/src/task/useTaskTagsEdit.ts           modify: generation-scoped pending/reset and stale completion guards
client/src/task/useTaskTagsEdit.test.tsx     create: deferred PATCH + task/user change race
client/src/task/TaskDetailView.test.tsx      modify only if needed for editor/blocking integration

client/src/task/TaskTagSelector.tsx          modify: focus dismissal, robust ARIA, sorted presentation only
client/src/task/TaskTagSelector.test.tsx     modify: Tab/click-away/keyboard/pointer/ARIA/ordering/removal

client/src/task/TaskRow.tsx                  modify: approved metadata order and accessible tag description
client/src/task/TaskRow.test.tsx             modify: order, overflow, accessible description and existing actions

client/e2e/task-tags.spec.ts                 create: stateful route-mocked tagging flow across create/reuse/edit/reload

.github/workflows/ci.yml                    inspect; modify ONLY if verified SonarCloud coverage reporting needs it
server/pom.xml                              inspect; modify ONLY if verified minimal JaCoCo integration is warranted
client/vitest.config.ts / package.json      inspect; modify ONLY if minimal frontend coverage integration is warranted
sonar-project.properties                    create ONLY if a concrete scanner configuration path is established and needed
\`\`\`

No modifications are expected to Task Java domain/Tag APIs/association migration for the five review findings.

---

### Task 1 — Refresh owner-scoped suggestions after a successful tag save [P2]

**Files:** Modify \`client/src/task/useCreateTask.ts\`, \`client/src/task/useUpdateTask.ts\`, \`client/src/task/useCreateTask.test.tsx\`, \`client/src/task/useUpdateTask.test.tsx\`.

**Interfaces:** Existing \`QueryClient.invalidateQueries({ queryKey: ['tags','suggestions',ownerId] })\` targets every prefix for exactly that owner. No new public API. Keep existing \`onSuccess\` owner identity guard. Only invalidate after a successful mutation whose request **contains at least one \`{name:string}\` tag choice**, because only these operations can create previously unknown suggestion rows. If the existing result indicates an already-existing case-insensitive name, invalidation is harmless.

- [ ] **RED:** Add \`createWithNewTagInvalidatesOnlyOwnersSuggestionPrefixes\`: seed two cached prefixes for owner 1 (including empty results), and a prefix for owner 2; issue POST with \`tags:[{name:'Architecture'}]\`; assert owner-1 entries are invalidated and owner-2 entry remains fresh. Test an ordinary POST without names does not invalidate. Test a rejected POST never invalidates.
- [ ] **RED:** Add \`patchWithNewTagInvalidatesOwnerSuggestionsWithoutChangingOtherOwner\`: seed cached prefix \`arch\`; successful \`PATCH {tags:[{name:'Architecture'}]}\` invalidates owner 1's prefixes; PATCH by IDs only, rejected PATCH and owner-switch late response do not invalidate owner 2. Re-query active/inactive cached \`arch\` and prove it fetches instead of reusing stale \`[]\`.
- [ ] Run \`cd client && npm run test -- src/task/useCreateTask.test.tsx src/task/useUpdateTask.test.tsx\`; expect the new tests to fail for missing invalidation.
- [ ] **GREEN:** Extend both existing mutation success handlers, **after** the present matching-owner guard, with targeted prefix invalidation. Preserve existing Task list/detail cache writes and non-blocking result semantics (do not \`await\` background refetch or convert a successful Task save into failure).
- [ ] Rerun focused tests and confirm new tests pass, including existing late-owner response coverage.
- [ ] Commit: \`git add client/src/task/useCreateTask.ts client/src/task/useUpdateTask.ts client/src/task/useCreateTask.test.tsx client/src/task/useUpdateTask.test.tsx && git commit -m "fix(task): refresh tag suggestions after successful name assignment"\`

### Task 2 — Make pending Task Tag edits safe across task/user identity changes [P2]

**Files:** Modify \`client/src/task/useTaskTagsEdit.ts\`; create \`client/src/task/useTaskTagsEdit.test.tsx\`; adjust \`client/src/task/TaskDetailView.test.tsx\` only for an actual integration gap.

**Interfaces:** Keep the existing \`TaskTagsEditState\` API unchanged. Use an internal monotonically increasing \`generationRef\` tied to \`task.id\` and \`userId\`, matching the existing pattern in \`useTaskDescriptionEdit\`. Every asynchronous continuation/finally must verify its captured generation **and** identity before altering any new session's state.

- [ ] **RED:** Add \`changingTaskWhilePatchPendingReleasesNewEditors\`: start editing Task 7, make \`taskApi.update\` return an unresolved promise, click Save, rerender with Task 8/same user, assert edit can immediately activate and pending=false. Resolve the old Task 7 promise afterwards; Task 8 editor/pending/draft must remain unchanged.
- [ ] **RED:** Add \`changingOwnerWhilePatchPendingIgnoresOldFailureAndAllowsNewSave\`: old owner 1/task 7 PATCH hangs; rerender owner 2/task 7; begin a new edit and pending save; then reject old PATCH. Assert old failure does not put an error on owner 2 or clear owner 2's pending state. Finish new request and verify clean completion. Also exercise A→B→A so an old A response cannot match a revived owner+task identity by accident.
- [ ] Run \`cd client && npm run test -- src/task/useTaskTagsEdit.test.tsx\`; expect failures before the fix.
- [ ] **GREEN:** On identity change increment generation, clear \`pendingRef.current\`, \`pending\`, \`editing\`, draft and error for the **new** task/user. In \`save\` capture generation and identity; limit \`setEditing\`, \`setError\`, \`pendingRef.current=false\`, \`setPending(false)\` to the same generation. Stale save should not report success for a no-longer-current editor. Do not change \`useUpdateTask\`'s existing owner-scoped cache protections.
- [ ] Rerun focused tests and any affected \`TaskDetailView.test.tsx\` integration cases; ensure leaving a *current* pending edit continues to be blocked by \`TaskDraftNavigationGuard\`.
- [ ] Commit: \`git add client/src/task/useTaskTagsEdit.ts client/src/task/useTaskTagsEdit.test.tsx && git commit -m "fix(task): isolate tag edit saves across owner and task switches"\` (include extra integration test only if changed).

### Task 3 — Close autocomplete on focus leave and repair ARIA references [P2]

**Files:** Modify \`client/src/task/TaskTagSelector.tsx\`, \`client/src/task/TaskTagSelector.test.tsx\`.

**Interfaces:** Keep \`TaskTagSelectorProps\` unchanged. \`isOpen\` should be false after Escape, Tab leaving the widget, clicking elsewhere, selecting an option, or disabling the selector. Preserve pointer selection by ensuring dismissal does not run *before* a suggestion click is processed. \`aria-expanded=true\` must imply a mounted listbox node with matching \`aria-controls\`; \`aria-activedescendant\` must only name an existing option.

- [ ] **RED:** Test typing a prefix then Tab to the next form field and pointer click outside; suggestions close and aren't left onscreen. Re-focus with retained query should allow reopening.
- [ ] **RED:** Test pointer click on suggested existing Tag and on explicit Create still selects correctly; keyboard ArrowDown/Up, Enter, Escape still work. Ensure Enter with no actionable option does not accidentally submit the Task form.
- [ ] **RED:** Use DOM assertions to verify whenever the input advertises expanded state, the \`aria-controls\` ID exists (loading, no matches, query error and populated options); \`aria-activedescendant\` exists only when that option exists. If query result count decreases, active index must reset/clamp.
- [ ] Run \`cd client && npm run test -- src/task/TaskTagSelector.test.tsx\`; expect new assertions to fail.
- [ ] **GREEN:** Add minimal blur/focus-leave handling to the existing widget and consistent rendered listbox/ARIA state. Avoid new dropdown/combobox dependencies and avoid altering selection API, Tag validation or saving behavior. Leave the input in control of keyboard focus and ensure no nested interactive control failures.
- [ ] Rerun focused tests and \`npm run lint\`.
- [ ] Commit: \`git add client/src/task/TaskTagSelector.tsx client/src/task/TaskTagSelector.test.tsx && git commit -m "fix(task): dismiss tag suggestions and keep combobox ARIA valid"\`

### Task 4 — Restore approved Task row metadata order and accessible tag descriptions [P2]

**Files:** Modify \`client/src/task/TaskRow.tsx\`, \`client/src/task/TaskRow.test.tsx\`.

**Interfaces:** Preserve existing row opener button and stable \`aria-label="Open TASK-7: …"\` so earlier tests/assistive tech references continue to work. Use a unique ID (\`useId()\` if needed) plus \`aria-describedby\` pointing to an associated visually hidden description when tags are present. Keep tags themselves noninteractive.

**Approved row metadata order:** **Task key → due date → priority → first two Tags → +N overflow**.

- [ ] **RED:** Add \`rendersMetadataInApprovedOrder\` with due date, priority and 3 tags; compare the actual descendant positions inside the existing row opener (not simply element presence).
- [ ] **RED:** Add \`describesAllTagsAccessiblyWhileShowingOnlyTwo\`: 5 Tags produce only two visible chips plus \`+3\`; verify row opener's accessible description conveys tag names and remaining count, with no nested button; assert row-open, completion and menu behaviors unchanged.
- [ ] Run \`cd client && npm run test -- src/task/TaskRow.test.tsx\`; expect failures.
- [ ] **GREEN:** Move the existing tag chip markup **after** priority/due-date sections. Provide a visually hidden description via \`aria-describedby\` on the opener for the full Tag set/overflow; **do not change the opener's existing \`aria-label\`**, to minimize collateral churn. No new icon/button/tooltips or feature scope.
- [ ] Rerun focused tests, including existing Task list and navigation tests if accessible descriptions affect snapshots/selectors.
- [ ] Commit: \`git add client/src/task/TaskRow.tsx client/src/task/TaskRow.test.tsx && git commit -m "fix(task): align row metadata order and tag accessibility"\`

### Task 5 — Sort draft chips alphabetically without changing selection semantics [P3]

**Files:** Modify \`client/src/task/TaskTagSelector.tsx\`, \`client/src/task/TaskTagSelector.test.tsx\`.

**Interfaces:** Existing \`value: TaskTagSelection[]\`, \`onChange\` and selection persistence stay unchanged. Sort **only a presentation projection** of \`value\` by resolved/persisted display names, case-insensitively with stable tie-breaks (display spelling/ID). Retain each original selection identity/index for removals.

- [ ] **RED:** Start editor with \`Backend\` ID; add draft \`Architecture\` by name and assert rendered chip order is \`Architecture\`, \`Backend\` before Save. Add mixed-case equal-prefix names and an existing ID; verify stable sorting.
- [ ] **RED:** Click Remove on alphabetically first chip when that chip was **last** in original array; assert \`onChange\` drops that specific draft and retains the Backend ID. Assert the array sent on Save remains a legitimate full-set selection, not a fabricated sorted-ID mapping.
- [ ] Run \`cd client && npm run test -- src/task/TaskTagSelector.test.tsx\`; expect failures.
- [ ] **GREEN:** Build one \`displaySelections\` array with original index, resolved name and selection; render sorted projection. Use original index or exact selection identity for removal. Keep existing duplicate detection (including name-vs-ID) and don't persist ordering metadata.
- [ ] Rerun selector and TaskDetailView focused tests.
- [ ] Commit: \`git add client/src/task/TaskTagSelector.tsx client/src/task/TaskTagSelector.test.tsx && git commit -m "fix(task): keep draft tag chips alphabetically ordered"\`

### Task 6 — Add one browser-level tagging contract regression flow

**Files:** Create \`client/e2e/task-tags.spec.ts\` (reuse existing browser test patterns from \`task-create.spec.ts\` and \`task-edit.spec.ts\`; do not retrofit unrelated E2E fixtures).

**Interfaces:** Playwright route-mocked stateful backend must implement these existing paths: \`GET /api/v1/tags/suggestions?q=…\`, \`GET/POST /api/v1/tasks\`, \`GET/PATCH /api/v1/tasks/:id\`, and \`GET /api/v1/users/me\`. Requests must mirror actual \`{id}\`/ \`{name}\` Tag references; POST/PATCH responses return canonical \`tags:[{id,name}]\`, kept in an in-memory task/tag store.

- [ ] **RED:** Write browser test \`createDraftCancelThenSaveAndReuseTag\`: select explicit Create "Architecture" while creating a Task; Cancel and assert no POST/tag persistence in route fixture; create a Task with the draft, confirm the POST has \`{name:"Architecture"}\`, server returns a Tag ID, and the new Task's detail/row shows it. Open creation of another Task, search \`arch\` (pre-seed stale empty suggestion cache if feasible), assert **existing Architecture appears** and selection sends \`{id:<savedId>}\`.
- [ ] **RED:** Write browser test \`editFullTagSetAndReload\`: Task has \`Backend\` and \`Architecture\`; remove one, add one existing/new chip, confirm no PATCH until Save, save one complete tag array, reopen/reload and verify server-chosen alphabetical metadata and row overflow \`+N\` when >2; Cancel draft does not PATCH. Ensure all tags remain visible in details and Inbox isn't mutated by the mock.
- [ ] Run \`cd client && npm run test:e2e -- task-tags.spec.ts\`; expect failures until supporting Task 1–5 fixes and mock are in place. New tests must fail for a meaningful behavior or missing contract, not because the mock endpoints weren't initialized.
- [ ] **GREEN:** Use deterministic, stateful \`page.route\` mocks as existing E2Es do. Avoid sleeps and dependence on live network/backend. Cover at least one keyboard selection and one focus-leave interaction without bloating the test into a second unit suite.
- [ ] Run targeted Playwright command, then existing \`npm run test:e2e\`; note this is browser/contract coverage, with backend persistence already covered by existing server integration tests.
- [ ] Commit: \`git add client/e2e/task-tags.spec.ts && git commit -m "test(task): cover tag creation reuse editing and reload in browser"\`

### Task 7 — Triage SonarCloud findings, verify coverage instrumentation, and run final gates

**Files:** Inspect [PR #60's SonarCloud report](https://sonarcloud.io/dashboard?id=krishna916_horizon&pullRequest=60), [the eight new issues](https://sonarcloud.io/project/issues?id=krishna916_horizon&pullRequest=60&issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true), \`.github/workflows/ci.yml\`, \`server/pom.xml\`, \`client/vitest.config.ts\`, \`client/package.json\`, existing scanner configuration and project quality settings. Modify config/source files **only after confirming the actual finding and its ownership**.

**Current evidence (2026-11-03):** GitHub Actions \`backend\` and \`frontend\` succeeded on \`26858f1\`; PR reports 235 server and 474 client tests. SonarCloud bot reports **8 new issues**, **0 security hotspots**, and **0.0% new-code coverage**, yet the **Quality Gate passed**. Existing GitHub \`ci.yml\` runs Maven verify / Vitest / Playwright but does not explicitly publish JaCoCo XML or frontend LCOV. A missing or misconfigured report must **not** be described as 0% actual test coverage.

- [ ] **Inventory:** Retrieve all eight actual SonarCloud issue keys, affected paths/lines, severity, rule and message. Compare each with the *latest* PR code; classify **fix valid / explain false positive / existing unrelated / blocked access**. Fix still-valid PR-scope issues with minimal changes and regression assertions where behavior changes. Do not blindly suppress findings or claim unknown issues have been reviewed.
- [ ] **Coverage diagnosis:** Identify how SonarCloud scans this repository (Automatic Analysis vs CI-driven scanner), whether coverage XML/LCOV is generated, and whether the scanner has access to those reports. Validate the public report's “0.0% on new code” against real test files and actual published scanner measures.
- [ ] **Remediate only when grounded:** If straightforward and warranted, add minimal existing-ecosystem tooling/report flags (e.g., Maven JaCoCo XML and Vitest v8 coverage via the already-installed coverage provider), and wire their paths into the **actual SonarCloud scanning path**. Test report creation and scanner ingestion. Do **not** introduce a speculative scanner pipeline or modify quality thresholds to force green; if integration requires unavailable organization configuration/access, leave a precise blocker and proposed follow-up, not a bogus green result.
- [ ] **Run frontend gates:** \`cd client && npm run test && npm run typecheck && npm run lint && npm run format:check && npm run build && npm run test:e2e\`.
- [ ] **Run backend gate if relevant source/config changed; ideally rerun for full regression:** \`cd server && ./mvnw -Duser.timezone=UTC verify\` with PostgreSQL Testcontainers available.
- [ ] **PR self-review:** inspect \`git diff <PR-base>...HEAD\` for changes outside review scope; re-check all eight original #27 decisions, owner cache isolation, pending navigation guard, idempotency, no tag creation before Task Save, and no Inbox/lifecycle mutations. Confirm CI workflow success on the new PR head.
- [ ] **Review-thread disposition:** Reply to **all five** existing inline review threads with commit/test evidence; resolve threads only when verified fixed. Post an explicit disposition for each SonarCloud issue and the coverage-report state, including access blockers.
- [ ] **Commit:** Commit any *verified* Sonar/coverage fix separately, e.g. \`git commit -m "build: report existing test coverage to SonarCloud"\`; **do not create an empty or speculative commit**.

## Done criteria

- [ ] All five reviewed code issues have tests demonstrating red before and green after the fix; each review thread has a response and appropriately resolved state.
- [ ] Suggestions are fresh after Task Save; owner 2 caches remain untouched; failed saves do not invalidate.
- [ ] Old in-flight responses cannot pollute or block current Task/owner edit state.
- [ ] Combobox passes focus, pointer, keyboard and ARIA reference tests.
- [ ] Approved row metadata order and assistive tag description; two-chips-plus-\`+N\` preserved.
- [ ] Editing chips remain alphabetically ordered and Remove targets the correct selection.
- [ ] Browser route-mocked Task Tag journey passes; backend persisted-association tests remain green.
- [ ] Every SonarCloud issue individually dispositioned and coverage reporting verified or precisely documented as blocked; no ungrounded claims.
- [ ] Client and backend CI green on the new head, no unapproved product/architecture change, **no automatic merge**.

## Luna completion message for PR #60

On the existing PR, report a short per-finding table with **fix commit + test + thread**, a separate eight-issue SonarCloud disposition, the coverage measurement outcome, all actual commands/results, and any genuine blockers or new product decisions requiring owner approval. Do not leave findings marked resolved without a test or current-code proof.
