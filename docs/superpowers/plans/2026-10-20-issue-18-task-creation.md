# Issue #18 — Task Creation Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From `Add a task to Active…`, create a non-Inbox task with only a title required, display its new `TASK-N` key in Active, and replace the creation panel with its detail panel; recover safely from ambiguous POST failures.

**Architecture:** Extend the existing task-owned Spring Boot CRUD and React Tasks workspace, not the static mockup. Add a transactional, per-user PostgreSQL idempotency receipt to the existing POST without changing its JSON/response schema. The React form stays local, TanStack Router owns panel URL/history/blocking, and TanStack Query owns user-scoped list/detail data.

**Tech Stack:** Java 25, Spring Boot 4.0.6, PostgreSQL 17, Flyway SQL, Spring JDBC/JPA, JUnit/Testcontainers, React 19, TypeScript 6, TanStack Router 1.x, TanStack Query 5, React Hook Form 7, Zod 4, Axios, Radix/shadcn, Vitest/RTL, Playwright. Reuse installed packages.

**Spec:** `docs/design/tasks-workspace/DESIGN-SPEC.md`, approved visual screenshots, [issue #18](https://github.com/krishna916/horizon/issues/18); PRD-004 Tasks FR-001–003, SPEC-001 Shared Concepts, PRD-003 Inbox, HORIZON_CONSTITUTION, ENG-002. This plan additionally records the six owner-approved issue #18 decisions below. Base: `master` at `4dd15af36ca863a6cb13b531ab3ad72c0087ae20`; execution branch: `feat/issue-18-task-creation`.

## Global Constraints

- Creation entry text: **Add a task to Active…**; title only required; optional **Description, Priority, Due date**. No checklist (#22), tags (#27), attachment (#30), rich-text editor (#24), post-creation field editing (#20), global Capture, autosave, or fake metadata.
- Creation always has `inbox=false` via existing server `Task.create`; readable `TASK-N` stays server-generated per user, separate from numeric ID.
- **Approved UX:** Explicit **Cancel** immediately discards. Other dirty exits (X, Escape, backdrop, task switch, application route, Back/Forward) ask **Keep editing / Discard draft**. Confirmed Discard resumes the *original* navigation, not a substitute one. Clean exits do not prompt. Browser refresh/tab close uses the native `beforeunload` prompt, which cannot use custom button labels.
- **Approved description:** Plain-text multiline input serialized to existing JSONB document; no Tiptap editor yet.
- **Approved idempotency:** Same authenticated user + request UUID + semantically equivalent body returns the same created task, even under concurrent requests; different body with reused UUID returns 409. Never use a client-only guarantee.
- **Approved navigation:** `/tasks?create=true` is URL-backed; list→create uses push; success replaces creation history entry with `/tasks?task={id}`; draft content never goes into URL or persistent storage.
- **Approved ambiguous-response recovery:** Snapshot body and UUID on valid submit. On network/timeout/ambiguous 5xx, keep submitted inputs read-only and offer **Retry creation** with the original body and UUID. Known field-validation failures preserve input but restore editing; corrected request receives a new UUID. No automatic POST retries.
- Reuse `TaskSplitView`, `TaskPanelShell`, existing overlay, semantic theme tokens, module-owned API, existing user/session isolation. No global navigation framework, generic idempotency middleware, distributed locks, new packages or unrelated refactors.
- Observe `server/AGENTS.md` and `client/AGENTS.md`; run `client/.agents/skills/testing-frontend/SKILL.md` if present. Follow TDD: red → minimal green → focused verification → commit at each task. Before every implementation task inspect the latest actual files; don't blindly apply line numbers from this plan.

## Review Focus

The five highest-risk conditions that need explicit owning tests:

1. **Commit succeeded but response was lost:** subsequent identical retry returns the same ID/key; concurrent duplicate only allocates one `TASK-N` and inserts one task (Tasks 2, 3, 5, 7).
2. **Same UUID, different body or owner:** payload mismatch returns safe 409 with no extra insert; another authenticated user can use the UUID independently (Tasks 1–3).
3. **Edited/deleted task after prior successful create:** retry never silently creates again or exposes another owner's data; deleted original returns a safe reconciliation/conflict response (Tasks 2, 3).
4. **Navigating away while dirty:** Back/Forward, link, task selection, X, Escape, backdrop all preserve the draft on Keep editing and continue the *specific attempted destination* on Discard; Cancel bypasses prompt (Tasks 6, 7).
5. **Account change or stale request completion:** late create response cannot render one user's task in another user's list/detail cache or route; session failure never exposes stale private content (Tasks 5–7).

---

## File map and execution order

| Unit | File(s) | Responsibility |
|---|---|---|
| PostgreSQL receipt | New `server/src/main/resources/db/migration/V20261020200000__create_task_creation_request.sql`; new `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskCreationRequestRepository.java` | Unique per-user UUID claim, fingerprint, final task ID; claim before task-number allocation |
| Fingerprint | New `server/src/main/java/com/krishnamurti/horizon/task/application/TaskCreationFingerprint.java` | Canonicalize semantically equivalent body and compute SHA-256 |
| Transaction orchestrator | New `server/src/main/java/com/krishnamurti/horizon/task/application/IdempotentTaskCreationService.java` | Claim → existing task create → complete receipt; replay without allocating task number |
| HTTP contract | Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java` and `TaskExceptionHandler.java`; new scoped conflict exception | Optional `Idempotency-Key` request header for backward compatibility; 201 replay/409 conflict/400 key validation |
| Frontend encoding/API | Modify `client/src/task/api.ts` and `types.ts`; new `taskDescriptionDocument.ts`, `useCreateTask.ts` | Typed POST and caller-provided key, JSON serializer, user-scoped cache changes |
| Form | New `client/src/task/TaskCreateForm.tsx` and `TaskCreateSurface.tsx` | RHF/Zod, optional fields, immutable recovery attempt, accessible panel/header/footer |
| Navigation & shell | Modify `client/src/routes/_authenticated/tasks.index.tsx`, `client/src/task/taskNavigation.ts`, `TasksListPage.tsx`, `TaskWorkspace.tsx`, `TaskSplitView.tsx`, `TaskOverlay.tsx` | URL mode, history, guard, existing panel reuse and overlay title |
| Tests | Existing `TaskControllerIntegrationTest.java`, new `TaskCreationConcurrencyIntegrationTest.java`, `TaskCreationFingerprintTest.java`; focused Vitest files; new `client/e2e/task-create.spec.ts` | Unit, actual PostgreSQL API/concurrency, router/component, stateful mocked browser flow |

**Contract between tasks:** `IdempotentTaskCreationService.create(UUID requestKey, String title, Map<String,Object> description, TaskPriority priority, LocalDate dueDate): Task`; `taskApi.create(payload: CreateTaskPayload, requestKey: string): Promise<AxiosResponse<TaskDetail>>`; `useCreateTask(userId: number | undefined)` (hook wraps explicit single attempts, no automatic retries); `TaskCreateForm` exposes `onCreated(task: TaskDetail)`, `onDirtyChange(dirty: boolean)`, and `onCancel()`. Preserve these names across tasks unless existing source genuinely conflicts.

### Task 1: Canonical request fingerprint and transactional PostgreSQL receipt

**Files:**
- Create: `server/src/main/resources/db/migration/V20261020200000__create_task_creation_request.sql`
- Create: `server/src/main/java/com/krishnamurti/horizon/task/application/TaskCreationFingerprint.java`
- Create: `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskCreationRequestRepository.java`
- Create: `server/src/test/java/com/krishnamurti/horizon/task/application/TaskCreationFingerprintTest.java`
- Test: `server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskCreationRequestRepositoryTest.java`

**Interfaces:** `TaskCreationFingerprint.compute(String normalizedTitle, Map<String,Object> description, TaskPriority priority, LocalDate dueDate): String` returns lowercase SHA-256 hex. `TaskCreationRequestRepository.claim(Long userId, UUID requestKey, String fingerprint): boolean`; `find(Long userId, UUID requestKey): Optional<TaskCreationReceipt>`; `complete(Long userId, UUID requestKey, Long taskId): void`. The receipt is a small immutable record with `fingerprint` and `taskId`.

- [ ] **Step 1 — Write failing fingerprint unit tests.** Assert `" Task "` and `"Task"` produce identical fingerprints, missing and null optional metadata are equivalent, nested JSON object-key order does not affect the fingerprint, and changing title/description/priority/date does. No full payload or sensitive description in logs.
- [ ] **Step 2 — Verify RED.** From `server/` run `./mvnw test -Dtest=TaskCreationFingerprintTest`; expect test failure for absent implementation.
- [ ] **Step 3 — Implement fingerprint.** Canonical representation has exactly `title` (stripped), `description` (null or stable recursively key-sorted JSON), `priority` (enum name or null), `dueDate` (ISO date or null), then SHA-256 the deterministic UTF-8 encoding. Preserve meaningful description node/list order. Do not normalize text content away.
- [ ] **Step 4 — Write failing receipt persistence test on real PostgreSQL.** Assert `claim(user,uuid,hash)` returns true then false, `complete` makes `find` return task ID, same UUID works for another user, and rollback removes uncommitted claim. Use `@SpringBootTest`/`@Import(TestcontainersConfiguration.class)` and real user/task FK fixtures.
- [ ] **Step 5 — Verify RED; implement migration/repository.** New `task_creation_request` table: `user_id BIGINT NOT NULL`, `request_key UUID NOT NULL`, `request_fingerprint VARCHAR(64) NOT NULL`, `task_id BIGINT` (transiently null within same transaction), optional created timestamp; PK (`user_id`, `request_key`); FK to users and task. `claim` uses `INSERT ... ON CONFLICT (user_id,request_key) DO NOTHING` and returns inserted-row count; `complete` updates exactly one claimed row. No external commits with a null task ID; application transaction must atomically complete the claim.
- [ ] **Step 6 — Verify GREEN and commit.** Run `./mvnw test -Dtest=TaskCreationFingerprintTest,TaskCreationRequestRepositoryTest`; expect PASS. Commit with `git commit -m "feat(tasks): persist idempotent create requests"`.

### Task 2: Atomic owner-scoped create and replay

**Files:**
- Create: `server/src/main/java/com/krishnamurti/horizon/task/application/IdempotentTaskCreationService.java`
- Create: `server/src/main/java/com/krishnamurti/horizon/task/application/TaskCreationConflictException.java`
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskRepository.java` only if an owner-scoped replay lookup is missing
- Test: `server/src/test/java/com/krishnamurti/horizon/task/application/IdempotentTaskCreationServiceTest.java`

**Interfaces:** Uses `TaskCreationRequestRepository` and `TaskCreationFingerprint` from Task 1, `CurrentUserProvider`, existing `TaskCommandService.create(...)` and `TaskRepository.findByIdAndUserIdAndDeletedAtIsNull(...)`. Public method: `@Transactional Task create(UUID requestKey, String title, Map<String,Object> description, TaskPriority priority, LocalDate dueDate)`.

- [ ] **Step 1 — Write failing integration tests.** For authenticated user A and one UUID, first and repeated calls return identical `id`/`TASK-1` and `SELECT count(*) FROM task WHERE user_id = A` equals 1; counter stays 1. Different key creates `TASK-2`; user B can reuse A's UUID independently; same A/key but changed body raises `TaskCreationConflictException`; invalid title rolls back receipt and key counter.
- [ ] **Step 2 — Verify RED.** Run `./mvnw test -Dtest=IdempotentTaskCreationServiceTest`; expect missing orchestration or failing assertions.
- [ ] **Step 3 — Implement transaction.** Resolve authenticated user once; normalize/hash request; attempt claim *before* calling the existing task command. If claimed, invoke existing create (joins same Spring transaction), then complete receipt. If claim lost, load committed receipt, compare hash (409 on mismatch), then load original task by current owner without inserting/allocating anything. If original was soft-deleted/unavailable, raise safe conflict; never recreate. Duplicate concurrent INSERTs wait on PostgreSQL unique conflict until winning transaction commits/rolls back. Do not use a check-then-insert race, in-memory map or a second transaction for receipt creation.
- [ ] **Step 4 — Verify GREEN and commit.** Run `./mvnw test -Dtest=IdempotentTaskCreationServiceTest,TaskCommandServiceTest`; expect PASS, including existing legacy create semantics. Commit `git commit -m "feat(tasks): make keyed creation atomic"`.

### Task 3: Extend HTTP create contract and prove concurrent requests

**Files:**
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java`
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/web/TaskExceptionHandler.java`
- Test: `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`
- Create: `server/src/test/java/com/krishnamurti/horizon/task/web/TaskCreationConcurrencyIntegrationTest.java`

**Interfaces:** `POST /api/v1/tasks` accepts optional `Idempotency-Key: <UUID>` in addition to unchanged `CreateTaskRequest` JSON. First keyed POST and replay return `201 Created`, same `Location: /api/v1/tasks/{id}` and `TaskDetailResponse` (current resource state). Reused UUID with different payload returns `409 application/problem+json`. Invalid/empty header returns `400`. Missing header keeps original non-keyed behavior for older clients. Never accept another owner's lookup or leak their task ID.

- [ ] **Step 1 — Write failing HTTP tests.** Assert first/replay identical `$.id`/`$.key` and `Location`, `$.inbox == false`; missing header retains 201 behavior; header empty/garbled returns 400; same-user mismatched body returns 409 ProblemDetail; owner B can use same UUID; malformed description/priority/date, blank title and unauthenticated requests preserve existing error semantics.
- [ ] **Step 2 — Write failing concurrent API test.** Use two simultaneous bounded `MockMvc` requests with same authenticated session cookie/key/body against PostgreSQL; assert both 201, same ID/key, one inserted task and counter increment exactly once. Also assert a failed/rolled-back request leaves key reusable, and a replay after soft deletion does not create another row. No sleeps or unbounded executor.
- [ ] **Step 3 — Verify RED.** Run `./mvnw test -Dtest=TaskControllerIntegrationTest,TaskCreationConcurrencyIntegrationTest`; new tests must fail before adding keyed controller behavior.
- [ ] **Step 4 — Implement smallest web extension.** Parse header as UUID (distinguish absent from supplied blank), map valid keyed requests through `IdempotentTaskCreationService`, and preserve current `TaskCommandService.create` for no-header calls. Return unchanged response mapper/Location. Map conflict to RFC 9457 409; header invalid to 400. Keep request parsing/validation before receipt commit and authenticated protections unchanged.
- [ ] **Step 5 — Verify GREEN and commit.** Run same classes plus `./mvnw test`; expect PASS. Verify Flyway + Hibernate `ddl-auto=validate` on Testcontainers. Commit `git commit -m "feat(tasks): expose idempotent create API"`.

### Task 4: Plain-text description, typed create API and user-scoped mutation

**Files:**
- Create: `client/src/task/taskDescriptionDocument.ts`
- Create: `client/src/task/taskDescriptionDocument.test.ts`
- Modify: `client/src/task/types.ts`, `client/src/task/api.ts`
- Create: `client/src/task/useCreateTask.ts`, `client/src/task/useCreateTask.test.tsx`

**Interfaces:** `toTaskDescriptionDocument(text: string): Record<string,unknown> | null`; `CreateTaskPayload = { title: string; description?: Record<string,unknown> | null; priority?: TaskPriority | null; dueDate?: string | null }`; `taskApi.create(payload: CreateTaskPayload, requestKey: string): Promise<AxiosResponse<TaskDetail>>`. Mutation hook exposes explicit asynchronous submit, not hidden retries; success reconciles `['tasks', userId]` and `['tasks', userId, 'detail', id]`.

- [ ] **Step 1 — Write failing serializer tests.** `toTaskDescriptionDocument('   ') === null`; `toTaskDescriptionDocument('Hello')` yields `{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Hello'}]}]}`; multi-line maps to ordered paragraphs and round-trips via existing `getTaskDescriptionText`; HTML-like text remains literal text. Preserve paragraph meaning within what the current read-only renderer supports.
- [ ] **Step 2 — Verify RED.** From `client/` run `npm run test -- taskDescriptionDocument`; expect missing module/failing tests.
- [ ] **Step 3 — Implement serializer and API typing.** Keep empty description null, no priority/date defaults, date `YYYY-MM-DD` unchanged without timezone conversion. `taskApi.create` passes Axios third argument `{headers:{'Idempotency-Key':requestKey}}`; do not add global headers.
- [ ] **Step 4 — Write failing hook/API tests.** Assert exact JSON/UUID header, no automatic retry, success writes only authenticated user's detail cache, list has one summary of new ID, and invalidates server-owned list without duplicating rows. Late response from user A after account changes must not populate B's cache/route (guard against obsolete session/user identity).
- [ ] **Step 5 — Implement hook, verify and commit.** Run `npm run test -- taskDescriptionDocument useCreateTask`; expect PASS. Commit `git commit -m "feat(tasks): add typed creation API and description encoding"`.

### Task 5: Accessible form, validation and immutable uncertain-result recovery

**Files:**
- Create: `client/src/task/TaskCreateForm.tsx`, `client/src/task/TaskCreateSurface.tsx`
- Create: `client/src/task/TaskCreateForm.test.tsx`, `client/src/task/TaskCreateSurface.test.tsx`

**Interfaces:** `TaskCreateForm` accepts `userId: number`, `onCreated(task: TaskDetail): void`, `onDirtyChange(dirty: boolean): void`, `onCancel(): void`; wraps Task 4's `useCreateTask`. `TaskCreateSurface` provides header `Create task`, X dismissal callback, and existing `TaskPanelShell`, with form/footer embedded; no full-page icon or placeholder task key before success.

- [ ] **Step 1 — Write failing component tests.** Title required after trimming; whitespace and >255 characters never POST; title-only payload omits optional defaults; priority values map to `CRITICAL/HIGH/MEDIUM/LOW` or none; date remains `YYYY-MM-DD`; server field ProblemDetail appears beside corresponding field without clearing typed values; keyboard submit occurs only explicitly, never on blur.
- [ ] **Step 2 — Write failing recovery tests.** Valid submit generates exactly one UUID and snapshots body; double-click/pending cannot issue two concurrent POSTs. Network rejection/timeout/ambiguous 5xx shows **Retry creation**, freezes all submitted fields, and resends identical body and key; successful retry calls `onCreated` once. Known 400 field validation allows editing and next valid attempt uses new UUID. 401 must not bypass session protection.
- [ ] **Step 3 — Verify RED.** Run `npm run test -- TaskCreateForm TaskCreateSurface`; expect failing tests for missing form/surface.
- [ ] **Step 4 — Implement using RHF + Zod.** Choose existing installed shadcn input/textarea/select controls and semantic theme. Explicit footer **Create / Cancel**; pressing Cancel immediately calls `onCancel` regardless of dirtiness. Expose `formState.isDirty` with `onDirtyChange`; do not duplicate form state in router. Generate UUID only after successful client validation, not on mount/rerender. Treat response-loss as a possible committed creation: abandonment must not promise a server rollback; when feasible reconcile list afterward.
- [ ] **Step 5 — Verify GREEN and commit.** Run focused tests and `npm run typecheck`; expect PASS. Commit `git commit -m "feat(tasks): add guarded creation form and retry recovery"`.

### Task 6: URL-backed creation mode, original-navigation continuation and panel integration

**Files:**
- Modify: `client/src/routes/_authenticated/tasks.index.tsx`
- Modify: `client/src/task/taskNavigation.ts`
- Modify: `client/src/task/TasksListPage.tsx`, `client/src/task/TasksListPage.test.tsx`
- Modify: `client/src/task/TaskWorkspace.tsx`, `client/src/task/TaskWorkspace.test.tsx`
- Modify: `client/src/task/TaskSplitView.tsx`, `client/src/task/TaskOverlay.tsx`, relevant existing tests

**Interfaces:** Add `{kind:'create'}` to `TaskSelection`; add typed `create?: true` to search validation (recognize `create=true`); creation and detail are mutually exclusive in application-produced URLs. `TaskWorkspace` receives `onOpenCreate()`, `onCreationDirtyChange(boolean)`, `onCancelCreate()`, `onCreated(TaskDetail)` plus existing task-detail props. Reuse `TaskCreateSurface` from Task 5. Use Router `useBlocker({shouldBlockFn, withResolver:true, enableBeforeUnload})` with `status/proceed/reset` (verify installed version signature). Do not invent a second routing state machine.

- [ ] **Step 1 — Write failing route tests in existing memory router.** `/tasks`→click **Add a task to Active…** pushes `?create=true`; Back→`/tasks`; Forward→`?create=true`; direct creation URL opens blank form; clicking Add while detail panel already open switches panel to create (replace selection); both `task` and `create` input prioritizes valid task; malformed task never triggers GET; success replaces creation entry with `?task={id}`; existing trusted-list close/back semantics and split ratio survive.
- [ ] **Step 2 — Write failing guard tests.** Clean X/Back closes without modal; dirty explicit Cancel discards immediately. Dirty X, task selection, app navigation, Back/Forward, overlay Escape/backdrop open **Keep editing / Discard draft**. Keep editing calls blocker `reset()` and leaves URL/input unchanged; Discard calls `proceed()` and reaches the *original destination* (not always `/tasks`). Browser unload guarded natively; external navigation custom text not promised. No duplicate prompts from Radix `onOpenChange`.
- [ ] **Step 3 — Verify RED.** Run `npm run test -- TasksListPage TaskWorkspace TaskOverlay TaskSplitView`; expect new route/guard assertions to fail.
- [ ] **Step 4 — Implement routing and visual integration.** Centralize create/detail selection parsing. Opening create from bare list pushes a trusted `creation-from-list` history marker; opening from selected panel replaces without multiplying entries. Closing a trusted create entry returns Back to list; direct URL without trusted origin replaces to `/tasks`. On success, safely bypass the form blocker and replace with detail (preserve trusted list provenance as existing `panel-from-list` marker where applicable). Use `useBlocker` resolver `proceed/reset` for route transitions, not manual navigation after Discard. Explicit Cancel bypasses the blocker. Unmounting creation clears transient values; browser Forward reopening starts a fresh blank draft.
- [ ] **Step 5 — Reuse shell and accessible overlay.** Render creation in `TaskSplitView` using existing 60/40 and responsive overlay. Adjust overlay `aria-label`/`Dialog.Title` to **Create task** or **Task details**, focus title on open and restore sensible focus on close. Ensure the creation entry exists in both centered and split list views and does not cause list row selection.
- [ ] **Step 6 — Verify GREEN and commit.** Run `npm run test -- TasksListPage TaskWorkspace TaskOverlay TaskSplitView TaskCreateForm` and `npm run typecheck`; expect PASS. Commit `git commit -m "feat(tasks): connect creation panel to history and dirty guards"`.

### Task 7: Playwright create→detail flow and full verification

**Files:**
- Create: `client/e2e/task-create.spec.ts`
- Modify only if required: targeted test fixtures or code from prior tasks; no unrelated enhancements

**Interfaces:** Build on existing `client/e2e/task-detail.spec.ts` mocking style. Route `GET /api/v1/users/me`, `GET /api/v1/tasks`, `POST /api/v1/tasks`, `GET /api/v1/tasks/{id}` through a **stateful** fixture that returns the created task in the list and detail. This tests browser behavior; PostgreSQL exactly-once semantics stay proven by Task 3.

- [ ] **Step 1 — Write failing browser flow.** Starting `/tasks`, click **Add a task to Active…**, assert `/tasks?create=true`, enter only Title, click Create once, assert POST with a valid UUID header and no unwanted defaults; fixture returns `201` with `id`/`TASK-N`/`inbox=false`, then assert `/tasks?task={id}`, title visible in Active and detail, Back returns list not create.
- [ ] **Step 2 — Extend browser coverage.** Optional description/priority/date round-trip; failed POST network simulation and **Retry creation** uses unchanged payload/key; dirty Back Keep editing retains draft; dirty task selection Discard visits selected task; Escape/backdrop on narrow layout opens confirmation and maintains accessible focus; explicit Cancel skips confirmation and list unchanged. Test direct query creation URL and refreshing clears unsaved form.
- [ ] **Step 3 — Verify RED before wiring any missed behavior.** Run `npm run test:e2e -- task-create.spec.ts`; if failure is a genuine uncovered behavior, fix the owning slice and rerun.
- [ ] **Step 4 — Verify complete backend and frontend.** From `server/`: `./mvnw test` and `./mvnw verify` (quality gates; consult actual Maven configuration). From `client/`: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:e2e`, `npm run build`. Expect exits 0. If infrastructure (Docker, browsers) unavailable, report that specifically; do not claim PASS.
- [ ] **Step 5 — Self-review and commit.** Audit all six decisions and issue acceptance criteria; inspect diff for changes outside task ownership and accidental mockup copying. Commit `git commit -m "test(tasks): verify issue 18 end-to-end creation"`. Run independent code review using Superpowers review workflow, address verified findings, and document final commands/results in PR or issue.

## Acceptance gate

- [ ] `Add a task to Active…` opens real production create panel in existing split/overlay.
- [ ] Title-only creates one Active `TASK-N` task with `inbox=false`; list and same-side detail panel display it immediately.
- [ ] Optional plain-text description is valid JSONB doc, round-trips safely; none priority/date stay absent/null.
- [ ] Invalid title, domain failures and 400 field errors preserve input and permit correction.
- [ ] Ambiguous response preserves immutable payload/UUID and read-only recovery; concurrent same-key POSTs persist one task and return same identity; mismatch 409 and isolation tested.
- [ ] Cancel discards without prompt; all other dirty dismissals confirm; confirmed Discard completes original navigation; Back/Forward, direct URL and create-success replace work.
- [ ] Detail mode, account isolation, resizable panel, accessible overlay and existing backend clients retain prior behavior.
- [ ] Java tests against real PostgreSQL, frontend unit/router tests, one Playwright create→detail flow and appropriate quality gates verified.
- [ ] No autosave, new generic frameworks or out-of-scope Tasks stories.

## Luna execution handoff

1. Start from `feat/issue-18-task-creation` (branch contains this plan only). First read the linked issue, approved workspace design/screenshots, ``AGENTS.md``, this plan and current source; validate that HEAD hasn't moved since preparation.
2. Use **superpowers:subagent-driven-development** or **superpowers:executing-plans** with **superpowers:test-driven-development**, executing Tasks 1→7 one at a time and committing independently. If a check fails, use **superpowers:systematic-debugging** before changing code.
3. Keep interfaces/ownership as above. New **product-level** ambiguity → ask the owner; ordinary implementation choices → favor simplicity and existing conventions. Do not revisit the six approved decisions without concrete evidence.
4. At the end use **superpowers:verification-before-completion**; submit a PR to `master` referencing **Closes #18**, with changed files, test commands/results, deviations and remaining limitations. Do not mark acceptance criteria complete unless evidence supports them.

**Planning-only branch state:** This document commits no application code and makes no claim that product tests have run.
