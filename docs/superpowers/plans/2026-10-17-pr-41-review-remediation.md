# PR #41 — Task Backend Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the two findings raised on PR #41 without changing Horizon issue #16's approved public API, introducing general-purpose frameworks, or adding future task features.

**Architecture:** Keep the Task modular-monolith boundaries, owner-scoped persistence and existing resource controller. Prevent **disjoint concurrent field patches** from overwriting one another by emitting updates only for changed Task columns, and normalize field-specific POST/PATCH input validation through the existing task web mapper and RFC 9457 responses.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Hibernate ORM 7, PostgreSQL 17, Spring MVC/Jackson 3, JUnit 5, Spring Boot Test, PostgreSQL Testcontainers, Maven/Spotless/SpotBugs.

**Spec:** `docs/superpowers/specs/2026-10-17-issue-16-task-backend-design.md`; read the existing issue #16 plan at `docs/superpowers/plans/2026-10-17-issue-16-task-backend-implementation.md` and the inline review comments on PR #41.

## Global Constraints

- Work only on the existing PR branch `feature/issue-16-task-backend`; do not merge or change the issue state.
- Preserve `PATCH /api/v1/tasks/{id}`: omitted field = unchanged; explicit `null` clears only nullable fields; title `null` is invalid.
- Preserve per-user `TASK-N` keys, owner-scoped 404s, JSONB document contract, date-only `LocalDate`, priority values `CRITICAL/HIGH/MEDIUM/LOW`, and shallow list responses.
- Use existing `Task`, `TaskCommandService`, `TaskRequestMapper`, `CreateTaskRequest`, `TaskExceptionHandler`, `GlobalExceptionHandler` and Testcontainers patterns; avoid touching `BaseEntity` or unrelated modules.
- Do **not** introduce `@Version`, row locks, new tables, generic validation frameworks or retries solely for these fixes. For **same-field** concurrent edits, current V1 behavior remains last committed write wins. Raise a separate design decision if stronger conflict detection becomes necessary.
- Favor real PostgreSQL regression tests over mocks for concurrent persistence behavior. All exceptions from invalid input must preserve RFC 9457 shape; malformed JSON syntax itself can retain the global `Malformed JSON Request` response.
- Commit each fix separately and run the full backend verification before reporting completion.

## Review Focus

1. Two concurrent transactions read the same task, then patch **different** fields: both changes must survive (Task 1).
2. A concurrent change to one field must not reset a pre-existing unrelated field, `createdAt`, task key, or owner (Task 1).
3. Invalid `priority` value or JSON type in both POST and PATCH must return `400 Validation Failed` and `errors.priority` (Task 2).
4. Invalid `dueDate` value or JSON type in both POST and PATCH must return `400 Validation Failed` and `errors.dueDate` (Task 2).
5. Valid omitted/null optional fields still work; syntactically malformed body remains 400 and cannot mutate/create a task (Task 2).

---

## Task 1: Prevent lost updates between disjoint concurrent field edits

**Files:**
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java`
- Test: `server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskPersistenceIntegrationTest.java`

**Interfaces:**
- Consumes existing `Task.updatePriority(TaskPriority)`, `Task.updateDueDate(LocalDate)`, `TaskRepository.findByIdAndUserIdAndDeletedAtIsNull(Long,Long)`, `TaskRepository.saveAndFlush(Task)`.
- Produces unchanged Java/application/public HTTP signatures; Hibernate updates only dirty columns for `Task` (plus `updated_at`).

- [ ] **Step 1 — RED:** Add `concurrentDisjointFieldUpdatesPreserveBothChanges()` as a PostgreSQL integration test. Persist one Task with `priority=MEDIUM` and `dueDate=2026-10-20`; retain ID, user ID and readable key. Start two separate `TransactionTemplate` transactions on distinct executor threads (each gets a separate transaction-bound persistence context). Both load the **same original row**; synchronize with a bounded `CountDownLatch`/barrier only **after both reads**. Transaction A changes **only** `priority` to `HIGH`; transaction B changes **only** `dueDate` to `2026-10-21`. Allow both to flush and commit; re-read in a fresh persistence context. Assert `priority == HIGH`, `dueDate == 2026-10-21`, original `id`/`taskKey`/`userId`/`createdAt` unchanged and `updatedAt` advanced. Always close the executor and place timeouts on synchronization/futures to avoid test hangs. This must test real database writes, not just two in-memory Task instances.
- [ ] **Step 2 — Verify RED:** Run `cd server && ./mvnw test -Dtest=TaskPersistenceIntegrationTest#concurrentDisjointFieldUpdatesPreserveBothChanges`. On existing unmodified `Task`, one field should be lost with the default full-column UPDATE; investigate if the test unexpectedly passes rather than assuming coverage.
- [ ] **Step 3 — GREEN:** Annotate the Task JPA entity with `org.hibernate.annotations.DynamicUpdate` (`@DynamicUpdate`). Do not apply it globally. Hibernate should emit only fields dirtied by the transaction, alongside audit `updated_at`. Do not silently substitute `@Version`, pessimistic locking or additional schema changes; those alter conflict semantics and are outside this limited V1 fix.
- [ ] **Step 4 — Verify GREEN:** Rerun the focused test repeatedly (e.g. 5 local runs), then the full `TaskPersistenceIntegrationTest`. Expected: both independent edits survive every time and no context/connection leaks.
- [ ] **Step 5 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskPersistenceIntegrationTest.java && git commit -m "fix(task): preserve concurrent disjoint field updates"`.

## Task 2: Unify field validation for POST and PATCH

**Files:**
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/web/CreateTaskRequest.java`
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/web/TaskRequestMapper.java`
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java`
- Test: `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`
- Modify only if a failing test requires it: `server/src/main/java/com/krishnamurti/horizon/task/web/TaskExceptionHandler.java`

**Interfaces:**
- Preserve `TaskCommandService.create(String, Map<String,Object>, TaskPriority, LocalDate)` and `TaskCommandService.update(Long,TaskPatch)`.
- Change `CreateTaskRequest`'s **internal binding fields only** to `JsonNode priority` and `JsonNode dueDate` (imports from `tools.jackson.databind.JsonNode`), while retaining required `@NotBlank String title` and `Map<String,Object> description`. JSON wire names and values remain identical.
- Reuse `TaskRequestMapper` for parsing both POST metadata and PATCH metadata. Provide `TaskRequestMapper.parsePriority(JsonNode): TaskPriority` and `TaskRequestMapper.parseDueDate(JsonNode): LocalDate` (null/missing -> null; non-string -> `TaskRequestValidationException` on correct field; invalid string -> same exception). Existing `priorityUpdate` and `dateUpdate` should delegate to these methods when present.

- [ ] **Step 1 — RED:** Add `postAndPatchInvalidPriorityReturnSameFieldValidationShape()`: for `{"title":"X","priority":"URGENT"}` on POST and `{"priority":"URGENT"}` on PATCH (against an owned task), assert **status 400**, `title == "Validation Failed"`, and `errors.priority` exists. Add wrong JSON primitive cases (e.g. `priority:42`) with the same assertions; valid enum still accepted.
- [ ] **Step 2 — RED:** Add `postAndPatchInvalidDueDateReturnSameFieldValidationShape()`: `dueDate:"not-a-date"` and `dueDate:42` both produce 400, `Validation Failed`, and `errors.dueDate` on both endpoints. Valid `YYYY-MM-DD` continues to round-trip as a date only.
- [ ] **Step 3 — RED regression:** Add tests verifying POST omitted/null `priority` and `dueDate` remain nullable; PATCH absent remains untouched and explicit null clears; valid POST title still normalizes; malformed JSON syntax remains 400. Ensure invalid input did not persist a new task or change the target task.
- [ ] **Step 4 — Verify RED:** `cd server && ./mvnw test -Dtest=TaskControllerIntegrationTest` — new POST tests must demonstrate existing discrepancy before implementation.
- [ ] **Step 5 — GREEN:** Change the create-only binding of `priority`/`dueDate` to `JsonNode` and call shared `TaskRequestMapper.parsePriority(...)` / `parseDueDate(...)` in `TaskController.create`; reuse those parsers from PATCH mapping. Do not parse invalid business values in Jackson enum/date deserialization, which currently routes to the global `Malformed JSON Request` response. Keep `@NotBlank`, Task's own title/document invariants and the task-scoped exception advice; avoid duplicating parsers.
- [ ] **Step 6 — Verify GREEN:** Focused TaskController integration suite must pass. Confirm both endpoints return equivalent field-error JSON for invalid priority/date while the successful HTTP payloads remain unchanged.
- [ ] **Step 7 — Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/web server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java && git commit -m "fix(task): align create and patch validation errors"`.

## Final verification and handoff

- [ ] Run `cd server && ./mvnw test` and `cd server && ./mvnw verify`; report exact counts, failures, and static analysis findings. If Docker is unavailable, do not assert tests passed.
- [ ] Inspect `git diff master...HEAD` for accidental scope changes; retain all existing accepted issue #16 requirements.
- [ ] Review the actual changed SQL from Task updates (enable targeted Hibernate SQL logging in a test if the concurrency regression is ambiguous): no unrelated editable field should be written by a disjoint PATCH.
- [ ] Request a reviewer pass focused on both regressions, then reply to the two PR review threads with tested commit SHAs and verification outcomes. Do not mark comments resolved merely for adding a plan.
- [ ] Do not merge the PR or attempt to repair SonarCloud's separate 0%-coverage-reporting issue as part of these changes.
