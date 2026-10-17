# Issue #16 — Task Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticated users can create, fetch, partially update, and list only their own persisted Tasks, with immutable per-user `TASK-N` keys and no frontend work.

**Architecture:** Extend the existing Spring Boot modular monolith within `task/{web,application,domain,infrastructure}`. Flyway owns PostgreSQL tables; a Task-owned atomic counter allocates per-user keys; owner-scoped repository methods prevent cross-user data access. Keep the HTTP controller resource-oriented and thin, with command/query services and separate list/detail DTOs.

**Tech Stack:** Java 25; Spring Boot 4.0.6; Spring Security + Spring Session JDBC; Spring Data JPA / Hibernate 7; PostgreSQL 17; Flyway; Jackson 3; JUnit 5, Mockito, MockMvc, PostgreSQL Testcontainers; existing Maven/Spotless/Error Prone/SpotBugs checks.

**Spec:** `docs/superpowers/specs/2026-10-17-issue-16-task-backend-design.md` (approved story-specific contract). Also read `docs/design/tasks-workspace/DESIGN-SPEC.md`, issue #16, PRD-004 and the Constitution.

## Global Constraints

- **Current repo is authoritative:** Existing `server/pom.xml` targets Java 25 / Boot 4.0.6, despite older versions in `HORIZON_STATUS`. Verify the branch before starting.
- **Implementation location:** `server/src/main/java/com/krishnamurti/horizon/task/{web,application,domain,infrastructure}`; do not create new modules or cross into `user` internals. `task/api/` stays empty until a cross-module contract is needed.
- **Architecture:** One resource controller, `TaskCommandService` + `TaskQueryService`, domain-enforced invariants, repository-scoped ownership, authenticated `CurrentUserProvider`, one transaction per use case.
- **Persistence:** Flyway SQL only; JPA schema `validate`; singular `task`, snake_case columns; BIGINT identity; timestamps `TIMESTAMPTZ` and due date `DATE`; structured description `JSONB`; priority `SMALLINT` with explicit code mapping.
- **Identity:** Numeric ID stays canonical. Per-user monotonic `TASK-N` assigned atomically; unique `(user_id, task_key)`; keys and original IDs immutable. Do not build future readable-key URLs.
- **HTTP:** `POST /api/v1/tasks`, `GET /api/v1/tasks/{id}`, `PATCH /api/v1/tasks/{id}`, `GET /api/v1/tasks`; RFC 9457 Problem Details; owner-only access; `404` for non-owned/nonexistent ID.
- **Title:** `strip()`, required/nonblank, maximum 255 normalized characters, preserve inner spacing and casing.
- **JSON:** non-null description must have top-level `type:"doc"` and array `content`; preserve nested JSON, defer full rich-text validation/rendering to #24.
- **PATCH:** omit = preserve; explicit null clears optional; forbidden to patch internal/lifecycle fields; title null/blank invalid; never make PATCH a full replacement.
- **List:** shallow `TaskSummaryResponse`, `{"items": [...]}` envelope, all own non-deleted tasks, `created_at DESC, id DESC`, no filters/pagination/sorting controls now.
- **No speculative functionality:** No frontend, lifecycle actions, tags/checklist, search, Trash UI, attachment storage, activity history, new libraries or generic DTO hierarchy.
- **Execution:** Work on a dedicated feature branch/worktree following the `using-git-worktrees` skill; TDD red-green-refactor, focused commits and review after each task. Do not overwrite user work. If repo contents diverge materially, escalate instead of inventing a replacement architecture.

## Review Focus (tests required in owning tasks)

1. **Two users creating their first task concurrently:** each gets `TASK-1`, neither causes collisions; simultaneous creations for one user receive distinct keys (Tasks 1, 3, 4).
2. **PATCH missing versus null:** omitted description/due date/priority remain unchanged; explicit null clears; null title and unsupported immutable fields return 400 (Tasks 2, 5, 6).
3. **Access after another user's login:** detail and PATCH return identical 404 to nonexistent ID; list never exposes cross-user data (Tasks 3, 5, 6).
4. **Malformed content:** bad doc envelope, wrong priority/date type, blank/long title generate 400 with no insert or partial mutation; JSONB nested document survives roundtrip (Tasks 2, 4, 5, 6).
5. **Key lifecycle and DB consistency:** key/ID/createdAt unchanged on edits and reload; `updated_at` changes on real edits; DB unique constraint and no key reuse after a saved task is soft-deleted later (Tasks 1, 3, 4).

---

## File ownership map

All paths below are relative to the repository root; adjust only if the **current** repository differs, and report the difference before coding.

| File | Responsibility |
|---|---|
| `server/src/main/resources/db/migration/V20261017200000__create_task_and_key_counter.sql` | Task + counter tables, FKs, checks, unique key, owner/list index |
| `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java` | Task aggregate and title/description/metadata invariants |
| `server/src/main/java/com/krishnamurti/horizon/task/domain/TaskPriority.java` | Priority vocabulary + fixed persisted numeric values |
| `server/src/main/java/com/krishnamurti/horizon/task/domain/TaskPriorityConverter.java` | Explicit JPA SMALLINT mapping; never ordinal |
| `server/src/main/java/com/krishnamurti/horizon/task/domain/InvalidTaskException.java` | Domain validation error with field information |
| `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskRepository.java` | JPA persistence and owner-scoped query methods |
| `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskKeyAllocator.java` | Atomic JDBC per-user counter allocation |
| `server/src/main/java/com/krishnamurti/horizon/task/application/TaskCommandService.java` | Create/update transactions |
| `server/src/main/java/com/krishnamurti/horizon/task/application/TaskQueryService.java` | Get/list read-only transactions |
| `server/src/main/java/com/krishnamurti/horizon/task/application/TaskNotFoundException.java` | Indistinguishable nonexistent/non-owned error |
| `server/src/main/java/com/krishnamurti/horizon/task/application/TaskPatch.java` | Typed four-field presence-aware patch contract |
| `server/src/main/java/com/krishnamurti/horizon/task/application/FieldUpdate.java` | Local `record FieldUpdate<T>(boolean present, T value)` (no shared abstraction) |
| `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java` | Four HTTP routes and DTO mapping, one controller |
| `server/src/main/java/com/krishnamurti/horizon/task/web/CreateTaskRequest.java` | Bean-validated create request |
| `server/src/main/java/com/krishnamurti/horizon/task/web/UpdateTaskRequest.java` | Delegating JSON object binding that preserves property presence |
| `server/src/main/java/com/krishnamurti/horizon/task/web/TaskRequestMapper.java` | Validates PATCH keys/types and maps to TaskPatch |
| `server/src/main/java/com/krishnamurti/horizon/task/web/TaskSummaryResponse.java` | Shallow list row |
| `server/src/main/java/com/krishnamurti/horizon/task/web/TaskDetailResponse.java` | Full task representation |
| `server/src/main/java/com/krishnamurti/horizon/task/web/TaskListResponse.java` | Task-specific `{items}` envelope |
| `server/src/main/java/com/krishnamurti/horizon/task/web/TaskResponseMapper.java` | Entity -> response DTO mapping (explicit, no library) |
| `server/src/main/java/com/krishnamurti/horizon/task/web/TaskExceptionHandler.java` | Task-scoped validation/404 -> RFC 9457, consistent with global error convention |
| `server/src/test/java/com/krishnamurti/horizon/task/domain/TaskTest.java` | Domain unit tests |
| `server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskPersistenceIntegrationTest.java` | Flyway/repository/JSONB/identity and concurrent allocation tests |
| `server/src/test/java/com/krishnamurti/horizon/task/application/TaskCommandServiceTest.java` | Command behavior and transaction coordination (unit) |
| `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java` | Session-cookie authenticated HTTP tests |
| Modify `server/src/test/java/com/krishnamurti/horizon/shared/infrastructure/DatabaseMigrationTest.java` | Assert new schema migrates and validates (if redundant, include assertion in TaskPersistenceIntegrationTest instead) |

**Use existing infrastructure:** `BaseEntity` for common id/timestamps, `CurrentUserProvider` for owner ID, `GlobalExceptionHandler` for existing request validation/malformed JSON, Spring Security's protected-by-default filter, established MockMvc auth tests. Keep `TaskExceptionHandler` narrowly scoped/ordered so existing global catch-all does not swallow task-specific 400/404; prove exact HTTP shapes with integration tests. Do not refactor shared code unnecessarily.

## Task 1: Flyway schema and per-user key allocator

**Files:** Create migration and `TaskKeyAllocator.java`; test in `TaskPersistenceIntegrationTest.java`; optionally extend `DatabaseMigrationTest.java`.

**Interfaces:**
- Produces: `TaskKeyAllocator.allocateNextNumber(Long userId): long` (JDBC; called inside an existing transaction; do not start independent `REQUIRES_NEW`).
- SQL shape: `INSERT INTO task_key_counter (user_id,last_allocated) VALUES (?,1) ON CONFLICT (user_id) DO UPDATE SET last_allocated=task_key_counter.last_allocated+1 RETURNING last_allocated`.

- [ ] **Step 1 — RED:** Write PostgreSQL integration tests `migrationCreatesTaskAndCounterTables`, `allocationStartsAtOnePerUser`, `concurrentAllocationsForSameUserAreUnique`, and `rolledBackAllocationIsNotCommitted`. Create user fixtures via current User service or existing repository patterns; use real transactions per concurrent worker (not a test method's shared transaction).
- [ ] **Step 2 — Run failing tests:** `cd server && ./mvnw test -Dtest=TaskPersistenceIntegrationTest` → missing table/allocator failures (Docker required).
- [ ] **Step 3 — GREEN:** Add Flyway migration. `task`: BIGINT identity PK, `user_id` FK, `task_key VARCHAR(64)`, required title, nullable `description JSONB`, `priority_id SMALLINT CHECK (priority_id IN (1,2,3,4))`, `due_date DATE`, `inbox BOOLEAN DEFAULT FALSE NOT NULL`, nullable lifecycle timestamps, required `created_at` / `updated_at`; unique `(user_id,task_key)`; index `(user_id,deleted_at,created_at DESC,id DESC)` only to serve approved list access. `task_key_counter`: `user_id` PK/FK and positive `last_allocated`.
- [ ] **Step 4 — GREEN:** Implement allocator with `JdbcTemplate` (use appropriate PostgreSQL `RETURNING` query); keep it in task infrastructure; return `long`; no `MAX()+1`, locks table-wide, Java synchronized, or extra sequence per user.
- [ ] **Step 5 — Verify:** Rerun the focused test; confirm `spring.jpa.hibernate.ddl-auto=validate` in integration test rather than `create-drop` and ensure concurrency assertions hold.
- [ ] **Step 6 — Commit:** `git add server/src/main/resources/db/migration server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskKeyAllocator.java server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskPersistenceIntegrationTest.java && git commit -m "feat(task): add task schema and per-user key allocation"` (include any touched schema-test file).

## Task 2: Task aggregate, priority, and JSON description invariants

**Files:** Create `Task.java`, `TaskPriority.java`, `TaskPriorityConverter.java`, `InvalidTaskException.java`; tests `TaskTest.java`.

**Interfaces:**
- `Task.create(Long ownerId, String taskKey, String title, Map<String,Object> description, TaskPriority priority, LocalDate dueDate): Task`
- `Task.updateTitle(String title): void`
- `Task.updateDescription(Map<String,Object> description): void`
- `Task.updatePriority(TaskPriority priority): void`
- `Task.updateDueDate(LocalDate dueDate): void`
- `TaskPriority` codes: `CRITICAL=1`, `HIGH=2`, `MEDIUM=3`, `LOW=4` via converter (not enum ordinal).
- Read accessors: `getUserId`, `getTaskKey`, `getTitle`, `getDescription`, `getPriority`, `getDueDate`, `isInbox`, lifecycle timestamp getters and inherited `getId`, `getCreatedAt`, `getUpdatedAt`.

- [ ] **Step 1 — RED:** Write `createTitleOnlyNormalizesAndDefaultsInboxFalse`, `rejectBlankOrOversizeTitle`, `preserveCapitalizationAndInternalSpaces`, `validateDocEnvelopeAndPreserveNestedContent`, `optionalMetadataCanBeCleared`, and `identitySurvivesSupportedDomainOperations`. Prove title-only Task is valid; `description=null` valid; wrong doc envelope invalid.
- [ ] **Step 2 — Run failing tests:** `cd server && ./mvnw test -Dtest=TaskTest` → expected missing type/behavior failures.
- [ ] **Step 3 — GREEN:** Implement Task as JPA aggregate root extending `BaseEntity`, scalar `userId` FK column (do **not** import `user.domain.User`), `taskKey`, title and optional metadata, inbox false on workspace creation, nullable `completedAt`, `archivedAt`, `deletedAt` fields. Do not add public setters for Task-owned identity/owner/lifecycle fields; existing `BaseEntity` already has inherited Lombok setters for `id`/timestamps, so application and web mapping must never use them. **Do not refactor BaseEntity in this story.** Use a protected JPA no-arg constructor and keep existing lifecycle callback semantics.
- [ ] **Step 4 — GREEN:** Map JSONB via Hibernate `@JdbcTypeCode(SqlTypes.JSON)` using `Map<String,Object>` and `columnDefinition="jsonb"`; validate only `type=="doc"` and `content instanceof List<?>`, reject non-object payload at HTTP; copy JSON structure defensively if needed to prevent undetected in-place mutation. Fixed priority mapping must use `AttributeConverter<TaskPriority,Short>`.
- [ ] **Step 5 — Verify:** Focused tests pass, with no additional dependencies or domain dependency on HTTP/infrastructure classes. Add a failing test first for any bug uncovered.
- [ ] **Step 6 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/domain server/src/test/java/com/krishnamurti/horizon/task/domain && git commit -m "feat(task): establish task aggregate and field invariants"`.

## Task 3: Owner-scoped repository and real PostgreSQL round trips

**Files:** Create `TaskRepository.java`; expand `TaskPersistenceIntegrationTest.java`.

**Interfaces:**
- `Optional<Task> findByIdAndUserIdAndDeletedAtIsNull(Long id, Long userId)`.
- `List<Task> findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(Long userId)`.
- For soft-deleted fixture cases use normal JPA persistence and `deletedAt` only in test fixtures/reflection when required; do **not** implement lifecycle commands.

- [ ] **Step 1 — RED:** Add tests `persistAndReloadTitleOnly`, `jsonbAndDueDateRoundTrip`, `sameKeyDifferentOwnersAllowed`, `duplicateKeySameOwnerRejectedByDatabase`, `ownerScopedGetAndListDoNotLeak`, `deletedRecordExcludedFromOrdinaryQueries`, `softDeletedTaskDoesNotRecycleKey`, `newestFirstUsesIdTieBreaker`, and `createdAtRemainsStableOnActualUpdate`. Use `flush` and clear persistence context before reload to ensure actual DB behavior.
- [ ] **Step 2 — Run failing tests:** `cd server && ./mvnw test -Dtest=TaskPersistenceIntegrationTest` → expected repository/roundtrip failure.
- [ ] **Step 3 — GREEN:** Implement only the two owner-scoped query methods. Add any minimal Testcontainers fixtures needed. Do not add a public unscoped task lookup for API use. Avoid `@DataJpaTest(ddl-auto=create-drop)` because this story must verify Flyway-generated PostgreSQL schema.
- [ ] **Step 4 — Verify:** Test schema `validate`, JSONB read/write, numeric priority mapping, date semantics, uniqueness and query ordering; prove two users may both own `TASK-1` while one user's duplicate is rejected.
- [ ] **Step 5 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskRepository.java server/src/test/java/com/krishnamurti/horizon/task/infrastructure && git commit -m "feat(task): add owner-scoped task persistence"`.

## Task 4: Transactional Task application services

**Files:** Create `TaskCommandService.java`, `TaskQueryService.java`, `TaskNotFoundException.java`, `TaskPatch.java`, `FieldUpdate.java`; test `TaskCommandServiceTest.java`.

**Interfaces:**
- `TaskCommandService.create(String title, Map<String,Object> description, TaskPriority priority, LocalDate dueDate): Task`.
- `TaskCommandService.update(Long taskId, TaskPatch patch): Task`.
- `TaskQueryService.get(Long taskId): Task`.
- `TaskQueryService.list(): List<Task>`.
- `record FieldUpdate<T>(boolean present, T value)`; use `FieldUpdate.absent()` and `FieldUpdate.of(value)` helpers.
- `record TaskPatch(FieldUpdate<String> title, FieldUpdate<Map<String,Object>> description, FieldUpdate<TaskPriority> priority, FieldUpdate<LocalDate> dueDate)`.
- Services resolve owner using `CurrentUserProvider.getCurrentUserId()`; they do **not** accept arbitrary owner IDs from HTTP clients. Owner lookup uses `findByIdAndUserIdAndDeletedAtIsNull`.

- [ ] **Step 1 — RED:** Test `createAllocatesKeyOnceAndSavesAsInboxFalse`, `createFailureRollsBack`, `getAndListAlwaysUseCurrentOwner`, `updateOnlyPresentFields`, `explicitNullClearsOptionalField`, `missingOrOtherOwnerThrowsSameTaskNotFound`, `immutableMetadataDoesNotChange`, and `updatedAtOnPersistedChange`. Mock technical collaborators only where appropriate; real persistence behavior remains covered by Task 3.
- [ ] **Step 2 — Run failing tests:** `cd server && ./mvnw test -Dtest=TaskCommandServiceTest` → missing service / behavior failures.
- [ ] **Step 3 — GREEN:** Implement create in a single `@Transactional` boundary: resolve user; allocate counter number; form `TASK-<number>`; create valid domain aggregate; save/flush as appropriate and return. Keep existing ID primary key distinct from readable key. No UserRepository or User domain dependency.
- [ ] **Step 4 — GREEN:** Implement owner-scoped update transaction, applying only present patch fields. Use read-only transactions for query service (`@Transactional(readOnly=true)`). Do not add pessimistic locks, optimistic versioning, arbitrary retries or state machine unless test evidence requires them.
- [ ] **Step 5 — Verify:** Focused application tests pass. Confirm failed Task insert rolls back key allocation and no cross-user path exists through either service.
- [ ] **Step 6 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/application server/src/test/java/com/krishnamurti/horizon/task/application && git commit -m "feat(task): implement authenticated task commands and queries"`.

## Task 5: Create, get, and list HTTP contract with shallow/detail responses

**Files:** Create `TaskController.java`, `CreateTaskRequest.java`, `TaskSummaryResponse.java`, `TaskDetailResponse.java`, `TaskListResponse.java`, `TaskResponseMapper.java`, `TaskExceptionHandler.java`; test `TaskControllerIntegrationTest.java`.

**Interfaces:**
- `POST /api/v1/tasks`: request `CreateTaskRequest(String title, Map<String,Object> description, TaskPriority priority, LocalDate dueDate)` -> `201`, `Location: /api/v1/tasks/{id}`, TaskDetailResponse.
- `GET /api/v1/tasks/{id}` -> `200` TaskDetailResponse or `404`.
- `GET /api/v1/tasks` -> `200` TaskListResponse `{"items":[TaskSummaryResponse...]}`.
- DTO summaries: `id,key,title,priority,dueDate,inbox,completedAt,archivedAt,createdAt,updatedAt`; detail adds `description,deletedAt` and all summary fields.
- `TaskResponseMapper.toSummary(Task): TaskSummaryResponse` and `.toDetail(Task): TaskDetailResponse`.

- [ ] **Step 1 — RED:** Write authenticated MockMvc integration tests `unauthenticatedCallsReturn401`, `createTitleOnlyReturns201LocationIdAndOwnKey`, `optionalFieldsRoundTripInDetail`, `listReturnsEnvelopeAndOmitsDescription`, `listIncludesOwnArchivedAndCompletedButNotDeleted`, `listNewestFirst`, `otherOwnerAndMissingGetReturnSame404`, `blankOrLongTitleReturnsStandard400`, `invalidJsonEnvelopeDoesNotInsert`, `invalidPriorityOrDateReturns400`. Establish **two distinct login session cookies** using the existing `/api/v1/auth/login` testing pattern.
- [ ] **Step 2 — Run failing tests:** `cd server && ./mvnw test -Dtest=TaskControllerIntegrationTest` → expected missing endpoint failures.
- [ ] **Step 3 — GREEN:** Implement one `@RestController @RequestMapping("/api/v1/tasks")`, `@Valid` create DTO, explicit DTO mapping, 201 + Location and separate summary/detail DTOs. Reuse `GlobalExceptionHandler` for `MethodArgumentNotValidException` and malformed JSON; add narrowly scoped/ordered Task handler for domain invalid field and owner-safe 404, consistent with RFC 9457 and with the global catch-all.
- [ ] **Step 4 — Verify:** Integration tests pass; 404 must not distinguish unknown ID from someone else's ID. Ensure list never returns `description`, while detail returns nested document unchanged and owners remain implicit/hidden in response.
- [ ] **Step 5 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/web server/src/test/java/com/krishnamurti/horizon/task/web && git commit -m "feat(task): expose secured create and read task APIs"`.

## Task 6: Presence-aware PATCH endpoint and request validation

**Files:** Create `UpdateTaskRequest.java`, `TaskRequestMapper.java`; modify `TaskController.java` and `TaskControllerIntegrationTest.java`; optionally expand `TaskCommandServiceTest.java`.

**Interfaces:**
- `PATCH /api/v1/tasks/{id}` -> `200` TaskDetailResponse.
- `UpdateTaskRequest` uses `@JsonCreator(mode = DELEGATING)` with `Map<String, JsonNode>` to bind the **top-level JSON object** and preserve `containsKey` even when a property's value is JSON null. For Jackson 3 import `tools.jackson.databind.JsonNode`; Jackson annotation remains `com.fasterxml.jackson.annotation.JsonCreator`.
- `TaskRequestMapper.toPatch(UpdateTaskRequest): TaskPatch`; allowed fields exactly `title`, `description`, `priority`, `dueDate`. For each, present/null/type-check -> `FieldUpdate<T>`; reject unknown keys, no-op `{}`, wrong field types, invalid dates/priorities and non-document description. Explicit `null` clears optional field; title `null` is invalid.

- [ ] **Step 1 — RED:** Add MockMvc integration tests `patchPriorityOnlyPreservesOtherFields`, `patchNullClearsPriorityDueDateDescription`, `patchOmittedDescriptionLeavesItIntact`, `patchTitleStripsWhitespaceAndRejectsBlank`, `patchEmptyObjectOrImmutableFieldReturns400`, `patchMalformedDateOrInvalidPriorityReturns400`, `patchWrongTypeReturns400`, `patchMissingAndOtherOwnerReturnSame404`, `patchUpdatesTimestampPreservingIdKeyCreatedAt`, and `patchOnDeletedTaskReturns404`.
- [ ] **Step 2 — Run failing tests:** `cd server && ./mvnw test -Dtest=TaskControllerIntegrationTest` → PATCH 405/not-found failures.
- [ ] **Step 3 — GREEN:** Add the PATCH handler to existing `TaskController`; implement dedicated presence-aware request DTO + mapper. Use typed application `TaskPatch`, not reflection-driven merging and not a generic API-patch framework. Never pass JSON patch directly to a JPA entity. Ensure `description` is treated as one full JSON document replacement when present.
- [ ] **Step 4 — Verify:** Re-run focused tests, checking the actual request binding distinguishes `{}` from `{"description":null}` and that all validation failures leave DB data unchanged. Correct expected 400 Problem Details fields via existing style (not an invented error envelope).
- [ ] **Step 5 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/web server/src/test/java/com/krishnamurti/horizon/task/web server/src/test/java/com/krishnamurti/horizon/task/application && git commit -m "feat(task): add presence-aware partial task updates"`.

## Task 7: Full gate, handoff evidence, and scope review

**Files:** Touch only missing tests/docs arising from focused review. Do not implement future-issue features while polishing this story.

**Interfaces:** No new API or abstractions.

- [ ] **Step 1 — Tests:** Run `cd server && ./mvnw test` and inspect failures. Address any issue with a reproducing test **before** changing implementation.
- [ ] **Step 2 — Build/static checks:** Run `cd server && ./mvnw verify` (Spotless check, Error Prone, SpotBugs included by current Maven configuration). Run `./mvnw spotless:apply` only for intended formatting edits, then rerun verify. No blanket disabling of checks.
- [ ] **Step 3 — Migration verification:** On a clean PostgreSQL Testcontainers database, ensure Flyway migrations complete and Hibernate `validate` succeeds; existing User and auth integration tests still pass.
- [ ] **Step 4 — Manual authenticated smoke:** With local backend and test database, register/login two users; POST title-only/optional task; GET detail/list; PATCH one field and explicit null; assert second user gets 404 for ID while `TASK-1` independently works for both users; verify no task key mutation on reload. Never log passwords/session cookies.
- [ ] **Step 5 — Review:** Run Superpowers `requesting-code-review` against issue #16 and this spec. Check no `user` domain import, no non-owner list, no accidental PATCH lifecycle support, no frontend changes, no generic wrappers, no extra deps, and no direct SecurityContext use in Task code.
- [ ] **Step 6 — Evidence:** Summarize tests/commands and outcomes, API examples, migration filename, per-user key allocation semantics and any explicitly deferred issue. If a test cannot run due to Docker/environment, report exactly what did and did not execute; do not claim passing.
- [ ] **Step 7 — Commit (if needed):** `git add <only-reviewed-changed-files> && git commit -m "test(task): finalize backend task API verification"`; do not create an empty commit.

## Acceptance criteria -> task mapping

| Issue #16 acceptance criterion | Proven by |
|---|---|
| Title-only creates persisted task with ID, readable key, inbox=false; optional metadata roundtrip | Tasks 2, 3, 4, 5 |
| Empty/blank title rejected without insert | Tasks 2, 5, 6 |
| Owner fetch/update/list; immutable id/key/createdAt; updatedAt changes | Tasks 3, 4, 5, 6 |
| Other user cannot read/edit/list another user's task; inaccessible ID gets 404 | Tasks 3, 4, 5, 6 |
| Key allocation stable/unique under concurrency and reload, documented policy | Tasks 1, 3, 4, 7 |
| Flyway/Testcontainers/repository/authenticated API tests pass | Tasks 1, 3, 5, 6, 7 |

## Stop-and-ask triggers for Luna

Stop **before coding the dependent decision** if: repo contains Task tables/APIs not present in this review; Hibernate JSON mapping does not reliably preserve the agreed envelope on actual PostgreSQL; existing frontend/backend consumers depend on a materially different contract; the migration filename collides; a module boundary or security contract would need changing; or the tests reveal a genuine product-rule ambiguity. Do not silently invent key URLs, editor schema, persistence of future tags/attachments, timezone behavior, sorting/filtering parameters, lifecycle actions or non-approved API conventions.

## Execution handoff

The user selected **Luna as implementer**, not this chat. Luna should review the paired spec and plan, work on an isolated branch/worktree, and follow `superpowers:subagent-driven-development` task-by-task if supported; otherwise use `superpowers:executing-plans`. Review changes and tests after each task and perform an independent whole-branch review before a PR. The execution method is already specified; do not ask the user to choose a different mode. **Do not automatically merge** or change GitHub issue state without a request.
