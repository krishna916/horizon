# Issue #57 — Tag API and Suggestions Implementation Plan

> **For Luna (agentic worker):** REQUIRED SUB-SKILL: use **superpowers:executing-plans** inline, task-by-task. **Do not dispatch subagents.** Use RED → GREEN verification and focused commits. No implementation work was done while preparing this plan.

**Goal:** Deliver owner-safe public Tag resolution/lookup contracts and authenticated suggestions HTTP API, ready for Task tagging in #27.

**Architecture:** Extend the existing `tag` module from #56. Publish separate `tag.api` Command/Query interfaces returning immutable references; use private application services and PostgreSQL JDBC repositories for atomic create/reuse and suggestions, and a thin HTTP read adapter. Preserve the caller's transaction and ownership isolation.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Spring Data JPA, Spring JDBC, PostgreSQL 17, Testcontainers, MockMvc, JUnit 5, Maven, Spotless/other existing verification gates.

**Spec:** [Approved design](../specs/2026-11-01-issue-57-tag-api-design.md). [GitHub issue #57](https://github.com/krishna916/horizon/issues/57). [#56 persistence design](../specs/2026-10-31-issue-56-tag-persistence-design.md).

## Global constraints (all tasks)

- Start from `feature/57-tag-api`, not `master`. Preserve any existing working-tree changes and follow root `Agents.md`, `server/AGENTS.md`, `.agents/skills/align-context`, `docs/ai/INDEX.md` and ENG-001.
- Only `tag.api` is a public cross-module surface. Do not import Tag domain, application or infrastructure from Tasks/Notes. Do not expose entities or repositories in public DTOs.
- Keep existing Tag schema, `Tag.create`, tag ownership, `uk_tag_user_name_ci`, display casing, validation and timestamps from #56. No Task/Note relationship migrations or UI.
- Public API: `TagCommandApi.resolveByName(Long,String): TagReference`; `TagQueryApi.findById(Long,Long): Optional<TagReference>`; `TagQueryApi.suggest(Long,String): List<TagReference>`; `TagReference(Long id,String name)`; `InvalidTagNameException` in `tag.api`.
- Create-or-reuse: `Propagation.MANDATORY`, caller's `READ_COMMITTED` transaction; native `INSERT ... ON CONFLICT DO NOTHING` and a **separate** owner-scoped read statement. No `REQUIRES_NEW`, uniqueness exception retry in aborted transaction, or advisory locks.
- Suggestions: input edge-trim, Unicode/ISO-control rules from #56, max 100 Unicode code points; empty/space-only => empty; case-insensitive literal-prefix; `lower(name)` ordering, stable tie breakers, fixed max 10.
- HTTP: **GET `/api/v1/tags/suggestions?q=hor` only**; return `{"items":[{"id":12,"name":"Horizon"}]}`. Authenticated user from `CurrentUserProvider`; no userId input. Missing q/invalid q => Problem Details 400; present blank q => 200 empty; unauthenticated => 401.
- TDD: tests first, run focused tests after each step, then `./mvnw -Duser.timezone=UTC verify` under `server/`. Only report green if actually executed. No subagents, no autonomous merge.
- Reconcile: SPEC-002/SPEC-001 and PRD-004 describe Tags as independent; Task `Status` is a derived filter, **not a Tag field**. Task assignment/HTTP and association storage belong to #27. #57 cannot fully exercise 'remove final association' until #27; verify #56's persistence of unreferenced Tags here.

## File map

```text
server/src/main/java/com/krishnamurti/horizon/tag/
  api/
    TagCommandApi.java                 new, stable write interface
    TagQueryApi.java                   new, stable read interface
    TagReference.java                  new, immutable id/name
    InvalidTagNameException.java       new, stable validation contract
  domain/
    Tag.java                           modify only to share existing name rules
    TagNamePolicy.java                 new, internal input normalization
  application/
    TagCommandService.java             new, MANDATORY service
    TagQueryService.java               new, read/query service
  infrastructure/
    TagResolutionRepository.java       new, JDBC conflict-safe insert/select
    TagSuggestionRepository.java       new, parameterized literal-prefix SQL
    TagRepository.java                 unchanged, owner-scoped ID lookup
  web/
    TagController.java                 new, authenticated GET only
    TagSuggestionsResponse.java        new, items envelope
    TagRequestValidationException.java new, HTTP query error
    TagExceptionHandler.java           new, Problem Details for q
server/src/test/java/com/krishnamurti/horizon/tag/
  domain/TagNamePolicyTest.java                   new
  application/TagCommandServiceIntegrationTest.java new
  application/TagQueryServiceIntegrationTest.java   new
  web/TagControllerIntegrationTest.java           new
```

A tiny helper can be folded into an existing class if readability improves, but **do not change public signatures or behavior**. Avoid a generic tag-management abstraction. #56's Flyway migration is unchanged.

## Review focus — failure modes to prove

1. Two independent transactions resolving `Horizon`/`horizon` concurrently: both return the same ID and one row, without 23505 leaking (Task 2).
2. A newly created Tag followed by an assignment transaction rollback: no Tag row survives (Task 2).
3. Prefix `h%`, `h_`, `h\\` or `h!` must match literal text, never broaden search via `LIKE` metacharacters (Task 3).
4. Owner 1 must never see owner 2's names or IDs, including ID lookup and HTTP suggestions (Tasks 3–4).
5. Exact 10-result boundary and case-insensitive tie ordering must be deterministic; zero/one-character, 100/101-code-point and supplementary Unicode inputs must behave as specified (Tasks 3–4).

---

### Task 1 — Public contracts and reusable name policy

**Files**
- Create `server/src/main/java/com/krishnamurti/horizon/tag/api/TagCommandApi.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/api/TagQueryApi.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/api/TagReference.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/api/InvalidTagNameException.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/domain/TagNamePolicy.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/tag/domain/Tag.java`
- Create `server/src/test/java/com/krishnamurti/horizon/tag/domain/TagNamePolicyTest.java`

**Interfaces**
- Produces exactly `TagCommandApi.resolveByName(Long,String): TagReference`, `TagQueryApi.findById(Long,Long): Optional<TagReference>`, `TagQueryApi.suggest(Long,String): List<TagReference>`, `TagReference(Long id,String name)`.
- Public `InvalidTagNameException(String field,String message)` with `getField()` and message. Internal `TagNamePolicy.normalizeRequiredName(String): String` and `normalizeSuggestionPrefix(String): String` (suggestion variant returns `""` for valid blank input). Both throw internal `InvalidTagException` for invalid values. Application layer translates them into public exception.
- `Tag.create(userId,name)` must retain #56 behavior by delegating to the shared internal normalization.

- [ ] **Step 1: Write failing `TagNamePolicyTest`** asserting `"  Horizon  "` => `"Horizon"`; `" Horizon "` (NBSP) trims; `"A B"` internal space preserved; `"😀".repeat(100)` accepted, 101 rejected; null/ISO controls rejected; blank allowed only for suggestion prefix; `Tag.create` regression checks still pass.
- [ ] **Step 2: Run RED** from `server/`: `./mvnw -Duser.timezone=UTC -Dtest=TagNamePolicyTest test`. Expected: compilation/test failure before implementation.
- [ ] **Step 3: Add records/interfaces/exception and extract only the already-approved normalization** from `Tag` into `TagNamePolicy`. Check ISO controls *before* edge trimming; count code points after trim. Do not modify domain rules or introduce status fields.
- [ ] **Step 4: Run GREEN**: `./mvnw -Duser.timezone=UTC -Dtest=TagNamePolicyTest,TagTest test`. Expected: all targeted tests pass.
- [ ] **Step 5: Commit**: `git add server/src/main/java/com/krishnamurti/horizon/tag/{api,domain} server/src/test/java/com/krishnamurti/horizon/tag/domain && git commit -m "feat(tag): define public contracts and name policy"`.

### Task 2 — Transactional single-name create-or-reuse

**Files**
- Create `server/src/main/java/com/krishnamurti/horizon/tag/application/TagCommandService.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/infrastructure/TagResolutionRepository.java`
- Create `server/src/test/java/com/krishnamurti/horizon/tag/application/TagCommandServiceIntegrationTest.java`

**Interfaces**
- Consumes `TagCommandApi`, `TagReference`, `TagNamePolicy.normalizeRequiredName` and existing `Tag` schema with index `uk_tag_user_name_ci`.
- `TagCommandService implements TagCommandApi` with `@Transactional(propagation = Propagation.MANDATORY)` on `resolveByName(Long userId,String name)`.
- Internal `TagResolutionRepository.resolve(Long userId,String validatedName): TagReference`: insert with `JdbcTemplate` using `INSERT INTO tag (user_id,name,created_at,updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`; then a **separate** `SELECT id,name FROM tag WHERE user_id=? AND lower(name)=lower(?)`; if the supposedly present row is absent, fail explicitly rather than fabricate a Tag ID.

- [ ] **Step 1: Write failing integration tests** using `@SpringBootTest`, `@Import(TestcontainersConfiguration.class)`, PostgreSQL 17, and `TransactionTemplate` explicitly set to `Isolation.READ_COMMITTED`: fresh name inserted and returned; resolving `Horizon` then `horizon` returns same ID and first casing; different owners have different IDs; invalid name yields `InvalidTagNameException` with `field="name"`; calling without active transaction throws `IllegalTransactionStateException`; throwing after resolve forces rollback and leaves no row; reusing an existing Tag does not alter `created_at`/`updated_at`.
- [ ] **Step 2: Run RED**: `./mvnw -Duser.timezone=UTC -Dtest=TagCommandServiceIntegrationTest test`. Expected: missing implementation or failed assertions.
- [ ] **Step 3: Implement minimal command service and private JDBC repository**. Catch only `InvalidTagException` and translate to `tag.api.InvalidTagNameException`; keep unforeseen SQL errors intact. Use JDBC-bound parameters; explicitly require non-null trusted `userId`. Do **not** add a public HTTP creation route.
- [ ] **Step 4: Run GREEN** same targeted command; expected all happy-path/rollback/MANDATORY tests pass.
- [ ] **Step 5: Add a concurrency test FIRST**: two worker threads with separate `READ_COMMITTED` `TransactionTemplate` transactions, coordinated by latches, each resolving `Horizon` / `horizon`; assert both return exactly the same ID, first display spelling persists, and DB count for owner/lower(name) = 1. Include bounded wait/timeouts and cleanup. Also test re-resolution after winner commits. This must run against Testcontainers, not mocks/H2.
- [ ] **Step 6: Run concurrency test** with `./mvnw -Duser.timezone=UTC -Dtest=TagCommandServiceIntegrationTest test`; inspect actual result. If failing, fix the INSERT/SELECT transaction mechanics rather than catching 23505 within the aborted transaction. Expected final GREEN.
- [ ] **Step 7: Commit**: `git add server/src/main/java/com/krishnamurti/horizon/tag/application/TagCommandService.java server/src/main/java/com/krishnamurti/horizon/tag/infrastructure/TagResolutionRepository.java server/src/test/java/com/krishnamurti/horizon/tag/application/TagCommandServiceIntegrationTest.java && git commit -m "feat(tag): resolve names atomically in caller transaction"`.

### Task 3 — Owner-scoped ID lookup and deterministic suggestions

**Files**
- Create `server/src/main/java/com/krishnamurti/horizon/tag/application/TagQueryService.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/infrastructure/TagSuggestionRepository.java`
- Create `server/src/test/java/com/krishnamurti/horizon/tag/application/TagQueryServiceIntegrationTest.java`
- Reuse existing `server/src/main/java/com/krishnamurti/horizon/tag/infrastructure/TagRepository.java` without exposing it.

**Interfaces**
- `TagQueryService implements TagQueryApi`, with read-only transaction semantics; consumes owner-scoped `TagRepository.findByIdAndUserId(tagId,userId)` and maps `Tag` to `TagReference`.
- `TagSuggestionRepository.suggest(Long userId,String normalizedPrefix): List<TagReference>` uses parameterized PostgreSQL query. SQL semantics: `user_id=? AND lower(name) LIKE lower(?) ESCAPE '!'`, ordered by `lower(name) ASC, name ASC, id ASC`, `LIMIT 10`. Construct bound pattern from prefix by escaping literal `!` => `!!`, `%` => `!%`, `_` => `!_`; append the one intended `%` for prefix matching. With explicit `ESCAPE '!'`, backslash is ordinary literal input.
- `TagNamePolicy.normalizeSuggestionPrefix` applied in query service before repository; blank returns empty list without SQL. Invalid prefix translated to `InvalidTagNameException` with meaningful field `prefix`.

- [ ] **Step 1: Write failing `TagQueryServiceIntegrationTest`**: owner ID resolves to id/name, nonexistent and foreign-owner IDs both `Optional.empty()`; prefix `hor` matches `Horizon`/`HorizonBackend` but not `MyHorizon`; `h` works, case-insensitivity preserved; edge spaces trimmed; `""` and ordinary spaces => empty; controls rejected; 100/101 supplementary code-point threshold; literal `%`, `_`, `\\`, `!` matched only when stored literally; other user Tag never shown; unused Tag returned; 12 matching names => alphabetically first 10 in stable order. Create test data directly in Tag repo/JDBC with distinct users, not via a fake Task association.
- [ ] **Step 2: Run RED**: `./mvnw -Duser.timezone=UTC -Dtest=TagQueryServiceIntegrationTest test`. Expected failure before code.
- [ ] **Step 3: Implement query service and private suggestion repository** with exact owner filter, normalization and literal SQL matching; never read another user's rows then filter in Java; never expose JPA entities.
- [ ] **Step 4: Run GREEN** same targeted command; expected all tests pass, including wildcard/Unicode/10-result cases.
- [ ] **Step 5: Commit**: `git add server/src/main/java/com/krishnamurti/horizon/tag/application/TagQueryService.java server/src/main/java/com/krishnamurti/horizon/tag/infrastructure/TagSuggestionRepository.java server/src/test/java/com/krishnamurti/horizon/tag/application/TagQueryServiceIntegrationTest.java && git commit -m "feat(tag): expose owner-scoped lookup and suggestions"`.

### Task 4 — Authenticated suggestions HTTP endpoint

**Files**
- Create `server/src/main/java/com/krishnamurti/horizon/tag/web/TagController.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/web/TagSuggestionsResponse.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/web/TagRequestValidationException.java`
- Create `server/src/main/java/com/krishnamurti/horizon/tag/web/TagExceptionHandler.java`
- Create `server/src/test/java/com/krishnamurti/horizon/tag/web/TagControllerIntegrationTest.java`

**Interfaces**
- `TagController`: `@RequestMapping("/api/v1/tags")`, only `@GetMapping("/suggestions")`, query param `q`; obtain authenticated `userId` via `CurrentUserProvider`, then call `TagQueryApi.suggest(userId,q)`. No `userId` query/request/header parameter. `TagSuggestionsResponse(List<TagReference> items)` makes a defensive `List.copyOf(items)`.
- `TagRequestValidationException(String field,String message)` for missing HTTP `q`. `TagExceptionHandler` scoped to `TagController`; translate this and `InvalidTagNameException` into 400 RFC 9457 `ProblemDetail` with `errors.q`. Follow the existing `TaskExceptionHandler` shape but write a query-accurate detail instead of copying its “request body” message. Authentication failures remain 401 via the existing security filter.

- [ ] **Step 1: Write failing MockMvc integration tests** using `@SpringBootTest`, `@AutoConfigureMockMvc`, `@Import(TestcontainersConfiguration.class)`, real User registration + login cookie from the existing TaskControllerIntegrationTest pattern. Assert GET with no session => 401; `?q=hor` returns 200 `items` containing only current user's id/name; same q under another session yields different/empty results; missing q => 400 Problem Details; present q empty or spaces => 200 empty array; tab/newline q and 101 Unicode code points => 400; 100 allowed; special literal prefixes; no userId override; POST `/api/v1/tags` and GET `/api/v1/tags/{id}` are not exposed. Avoid asserting a specific 404/405 for absent routes unless repo routing makes it stable—assert no creation/ID access succeeds.
- [ ] **Step 2: Run RED**: `./mvnw -Duser.timezone=UTC -Dtest=TagControllerIntegrationTest test`. Expected failure before endpoint.
- [ ] **Step 3: Add thin web adapter and scoped advice**. Ensure controller only maps/coordinates, with all suggestion rules in TagQueryService. Map missing q and invalid prefix into RFC 9457 400 with `errors.q`. Follow existing server session security conventions; do not introduce additional security configuration for an authenticated-by-default endpoint.
- [ ] **Step 4: Run GREEN** same command, expected all status/response/owner tests pass.
- [ ] **Step 5: Commit**: `git add server/src/main/java/com/krishnamurti/horizon/tag/web server/src/test/java/com/krishnamurti/horizon/tag/web && git commit -m "feat(tag): add authenticated suggestion endpoint"`.

### Task 5 — Boundary audit and release gate

**Files**: no new application files expected; update plan or test files only if the audit finds real issues. Do not edit PRDs, Constitution, migrations or unrelated Task/Note modules as part of #57.

- [ ] **Step 1: Read the approved design and issue #57 acceptance criteria again.** Map each criterion to an actual passing test. Explicitly note that post-unassignment Tag persistence is already guaranteed by #56 and end-to-end Task disassociation awaits #27.
- [ ] **Step 2: Check imports and exposed signatures.** Search production code outside `tag` for imports of `com.krishnamurti.horizon.tag.(domain|application|infrastructure|web)`; expected none. Confirm `TagCommandApi`/`TagQueryApi` expose only `TagReference`/`Optional`/`List` and public validation exception. Confirm no standalone Tag CRUD, entity leak or Task/Note join table.
- [ ] **Step 3: Run focused Tag suite** from `server/`: `./mvnw -Duser.timezone=UTC -Dtest=TagTest,TagNamePolicyTest,TagRepositoryIntegrationTest,TagSchemaIntegrationTest,TagCommandServiceIntegrationTest,TagQueryServiceIntegrationTest,TagControllerIntegrationTest test`. Expected all pass against real PostgreSQL Testcontainers.
- [ ] **Step 4: Run full backend quality gate** from `server/`: `./mvnw -Duser.timezone=UTC verify`. Expected `BUILD SUCCESS`; record actual exit/status. If failures originate outside this work, document reproduction and blocker without claiming success. No frontend implementation or UI verification is part of #57.
- [ ] **Step 5: Review git diff and quality gates**, preserve unrelated changes, document any nontrivial implementation correction, and commit only legitimate fixes with targeted tests. Keep final branch ready for PR.
- [ ] **Step 6: Push branch and open a PR** targeted to `master` with `Closes #57`, evidence of tests and references to both plan and design; do **not merge**. If blocked or a genuine requirement conflict emerges, stop and ask the owner.

## Final acceptance checklist

- [ ] Name variations reuse ID; distinct owners remain independent; new Tag appears in later suggestions.
- [ ] No automatic cleanup of unused Tags; #27 will verify last-association removal.
- [ ] Concurrent collision returns one identity to both callers with one row; rollback and mandatory transaction proven.
- [ ] ID lookup absent/cross-owner yields identical `Optional.empty()`; no Task code reaches Tag internals.
- [ ] Suggestions satisfy literal-prefix, Unicode, ordering, 10 cap, no cross-owner leakage, blank/error handling.
- [ ] Authenticated HTTP response uses `items` envelope; 401 for no session, 400 for missing/invalid q.
- [ ] Existing Tag tests, new tests, Maven quality gates pass with actual evidence; no PR merge without owner review.
