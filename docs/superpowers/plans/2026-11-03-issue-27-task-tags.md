# Issue #27 — Task Tags Assignment and Suggestions Implementation Plan

> **For Luna (agentic worker):** REQUIRED SUB-SKILL: use **superpowers:executing-plans** **inline, task-by-task**. **Do not use subagent-driven-development or dispatch subagents.** Check each task as complete only after RED → GREEN verification and a focused commit. This document is a plan, not implemented product code.

**Goal:** Let Tasks assign/reuse/create user-owned Tags on Save, edit complete Tag sets, show autocomplete and compact row metadata, while preserving independent Inbox review and lifecycle behavior.

**Architecture:** Task owns the `task_tag` association and save transaction. Task application code calls **only** `tag.api` for owner-scoped ID/name resolution and batched tag reads; Tag retains ownership of Tag records and suggestions. React uses a shared chip selector in Task creation and detail editing, with the existing Task draft navigation guard, Axios client and TanStack Query caches.

**Tech stack:** Java 25, Spring Boot 4.0.6, Maven, Spring Data JPA/JDBC, PostgreSQL 17, Flyway, JUnit 5/Testcontainers/MockMvc; React 19, TypeScript, TanStack Query v5, React Hook Form, Vitest/Testing Library, Tailwind/shadcn.

**Spec:** [Owner-approved #27 design](../specs/2026-11-03-issue-27-task-tags-design.md). Also [issue #27](https://github.com/krishna916/horizon/issues/27), [Tasks visual baseline](../../design/tasks-workspace/DESIGN-SPEC.md), [#56](../specs/2026-10-31-issue-56-tag-persistence-design.md), [#57](../specs/2026-11-01-issue-57-tag-api-design.md).

## Global constraints

- **Start from `feature/27-task-tags-assignment`**, created from `master` with this design and plan; read both documents before modifying code. Preserve unrelated working-tree changes; do not implement against `master` or merge autonomously.
- Follow `Agents.md`, `server/AGENTS.md`, `client/AGENTS.md`, `.agents/skills/align-context`, `docs/ai/INDEX.md`, ENG-001/ENG-002, and repository testing skills `testing-spring-integration` and `testing-frontend` when applicable. Read `DESIGN.md` and the required frontend design context before UI work.
- **No subagents.** Implement and self-review inline. Keep changes confined to #27; no unrelated refactors, new dependencies, Tag admin, Note tagging, Search by Tag or Task filter UI (#29).
- This issue's owner decision **supersedes PRD-003's optional wording**: tagging must never set/unset `inbox`, even for captured Inbox items. Existing completion/archive/deletion facts must remain unchanged; no Tag/Task status fields.
- Task uses only `tag.api`; no `tag.domain`, `tag.application` or `tag.infrastructure` imports, no cross-module JPA associations, no duplicate Tag entities. Batch query extension to `TagQueryApi` is specifically approved.
- Tag name policy, uniqueness and reuse are inherited from #56/#57: `lower(name)` per owner; edge trim; reject ISO controls/blank/over-100-Unicode-code-points; preserve first stored display name. No standalone Tag creation endpoint.
- Request: `tags?: ({id:positiveInteger}|{name:string})[]`. POST omitted => `[]`. PATCH omitted => unchanged, `[]` => clear association, null => **400**. Every element has exactly one property, no extras. Deduplicate by resolved ID. Missing/foreign tag IDs => **404**, malformed or invalid name => **400** RFC 9457 (`errors.tags`). Return `tags:[{id,name}]` on Task summary and detail.
- Create new names only inside Task save's `READ_COMMITTED` transaction by existing `TagCommandApi.resolveByName` with MANDATORY propagation. Failed Task save rolls back newly inserted Tags and links. Tag creation on chip click is prohibited.
- Sort all associated Tags case-insensitively by stored name with deterministic name/ID tie-breakers. No persisted order. Rows show first two plus noninteractive `+N`; detail/editor show all.
- Preserve existing create retry snapshot + idempotency key; fingerprint includes tag selection set. No-op updates should avoid rewriting links. Any **actual** association update advances Task `updated_at`, not Inbox or lifecycle facts. Preserve associations across complete/reopen/archive/soft-delete/restore.
- Backend tests under `server/`: `./mvnw -Duser.timezone=UTC -Dtest=<ClassName> test`; full `./mvnw -Duser.timezone=UTC verify`. Client tests under `client/`: `npm run test -- <test-path>`; full `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`. On Windows use `mvnw.cmd`; use existing UTC/Testcontainers setup. Report only checks actually executed.

## File map and responsibilities

```text
server/src/main/resources/db/migration/
  V20261103000000__create_task_tag.sql           CREATE Task-owned association + constraints/index
server/src/main/java/com/krishnamurti/horizon/tag/
  api/TagQueryApi.java                            add findAllByIds
  application/TagQueryService.java               owner-scoped implementation
  infrastructure/TagRepository.java              batch owner lookup method
server/src/main/java/com/krishnamurti/horizon/task/
  infrastructure/TaskTagAssociationRepository.java  new JDBC scalar-ID link CRUD/batch reads
  infrastructure/TaskRepository.java                owner-scoped lock for tag replacement
  application/TaskTagSelection.java                 new typed existing-ID/new-name selection
  application/TaskTagAssignmentService.java         new transactional resolution + set reconciliation
  application/TaskTagQueryService.java              new owner-scoped batched response lookup
  application/TaskPatch.java                       presence-aware tag field
  application/TaskCommandService.java              create/update transaction integration, touch timestamp
  application/IdempotentTaskCreationService.java   carry tags through idempotent creation
  application/TaskCreationFingerprint.java         include canonical tag selection set
  domain/Task.java                                 explicit metadata-change touch method
  web/CreateTaskRequest.java                       optional tags field
  web/TaskRequestMapper.java                       validate/parse tags in POST/PATCH
  web/TaskController.java                          existing endpoints only, map tag summaries/details
  web/TaskTagResponse.java                         new Task-owned {id,name} DTO
  web/TaskSummaryResponse.java                     tags list
  web/TaskDetailResponse.java                      tags list
  web/TaskResponseMapper.java                      map tags into DTOs
  web/TaskExceptionHandler.java                    translate tag name validation into errors.tags
client/src/
  tag/api.ts                                       new module-owned GET suggestions client + types
  task/types.ts                                    TaskTag/TagSelection, payload and response shapes
  task/TaskTagSelector.tsx                         new reusable chip/combobox draft selector
  task/TaskTagsField.tsx                           new detail read/edit surface
  task/useTaskTagsEdit.ts                          new save/cancel/error/dirty state
  task/TaskCreateForm.tsx                          integrate tag draft + idempotent snapshot
  task/TaskDetailView.tsx                          integrate field + draft guard / editor exclusion
  task/useUpdateTask.ts                            list/detail tags cache consistency
  task/TaskRow.tsx                                 two badges + overflow (inside row open control)
tests:
  server/src/test/java/com/krishnamurti/horizon/tag/application/TagQueryServiceIntegrationTest.java
  server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskTagAssociationRepositoryIntegrationTest.java (new)
  server/src/test/java/com/krishnamurti/horizon/task/web/TaskRequestMapperTest.java (new if absent)
  server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java
  server/src/test/java/com/krishnamurti/horizon/task/application/TaskCreationFingerprintTest.java
  server/src/test/java/com/krishnamurti/horizon/task/application/IdempotentTaskCreationServiceTest.java
  client/src/task/TaskTagSelector.test.tsx (new)
  client/src/task/TaskCreateForm.test.tsx
  client/src/task/TaskDetailView.test.tsx
  client/src/task/useUpdateTask.test.tsx
  client/src/task/TaskRow.test.tsx
```

**Review existing caller constructors/tests** before changing Java records and TS types; update every affected test fixture in the same task. No unnecessary new `TagController` / `TaskTagsController` or generic shared tag manager. Smaller implementation-local helper files are allowed when necessary.

## Review focus — five high-risk failure classes

1. **Cross-user or unknown ID in a mixed batch:** respond 404, do not leak name, do not alter old links or persist draft names. Pin in Task 4.
2. **New name persisted then later transaction failure:** Tag and all associations roll back. Pin in Task 4 with a failing later element/forced failure.
3. **Concurrent replacements of one Task's tags:** serialize owned Task writes; no interleaved half-sets or duplicate PK errors. Pin in Task 4.
4. **Uncertain create response / retry:** same idempotency key and tag set returns one Task with original association; altered set returns 409, including after reload. Pin in Task 5 / Task 7.
5. **Suggestions race during typing or account/task switch:** old owner's results never render in new owner's form, stale prefix results are ignored; unsaved chips never create persisted Tags. Pin in Task 6 / Task 8.

---

### Task 1 — Extend the public Tag batch-read contract

**Files**
- Modify `server/src/main/java/com/krishnamurti/horizon/tag/api/TagQueryApi.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/tag/application/TagQueryService.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/tag/infrastructure/TagRepository.java`
- Modify `server/src/test/java/com/krishnamurti/horizon/tag/application/TagQueryServiceIntegrationTest.java`

**Interfaces**
- Produces `List<TagReference> findAllByIds(Long userId, Collection<Long> ids)` on `TagQueryApi`. Duplicate IDs should produce one result per persisted Tag; empty IDs => empty; result contains only requested owner-owned tags. Keep `findById` and `suggest` unchanged.

- [ ] **RED:** Add `batchIdLookupFiltersForeignTagsAndReturnsEmptyForEmptyInput`: create owner A/B, two A tags and one B tag; query IDs containing all three and a nonexistent ID; assert only A's two ID/name pairs; empty collection => empty. Assert owner B cannot fetch A tags.
- [ ] **Verify RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=TagQueryServiceIntegrationTest test` fails for missing method.
- [ ] **GREEN:** Add the public method and owner-filtered repository `findAllByUserIdAndIdIn(Long userId, Collection<Long> ids)` (or Spring Data equivalent). Call it once, never loop over `findById`. Return immutable `TagReference` values.
- [ ] **Verify GREEN:** Repeat focused command; all TagQueryServiceIntegrationTest cases pass, including #57 suggestions.
- [ ] **Commit:** `git add server/src/main/java/com/krishnamurti/horizon/tag server/src/test/java/com/krishnamurti/horizon/tag/application/TagQueryServiceIntegrationTest.java && git commit -m "feat(tag): support owner-scoped batch reference lookup"`

### Task 2 — Persist Task-owned associations without crossing Tag internals

**Files**
- Create `server/src/main/resources/db/migration/V20261103000000__create_task_tag.sql`
- Create `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskTagAssociationRepository.java`
- Create `server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskTagAssociationRepositoryIntegrationTest.java`

**Interfaces**
- `Map<Long,List<Long>> findTagIdsByTaskIds(Long userId, Collection<Long> taskIds)`: one owner-scoped association query; no Tag table name read, empty IDs => empty.
- `Set<Long> findTagIdsForTask(Long userId, Long taskId)`: owner-filtered current tag IDs.
- `void replace(Long userId, Long taskId, Set<Long> tagIds)`: within caller's transaction, remove old links and insert given IDs; checked Task ownership. Caller skips invoking it for unchanged sets.

- [ ] **RED:** Add integration tests with two owners: schema has PK/FKs/index, duplicate link rejected; owner A sees only A Task associations even if passed B Task ID; replacing A's links does not touch B's; empty replacement leaves Tag rows intact. A B-owned Task must not be mutated by owner A. Test real PostgreSQL/Testcontainers and `ddl-auto=validate`.
- [ ] **Verify RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=TaskTagAssociationRepositoryIntegrationTest test` fails before migration/repository exist.
- [ ] **GREEN:** Create two-column association table, composite PK, FKs and `idx_task_tag_tag_id`; use a parameterized JDBC/NamedParameterJdbcTemplate repository owned by Task. Scope reads/writes via `task.user_id`. Never import Tag internals or create a JPA relationship to Tag.
- [ ] **Verify GREEN:** Repeat focused test; assert link and FK behavior; ensure a Tag with no links remains in `tag`.
- [ ] **Commit:** `git add server/src/main/resources/db/migration/V20261103000000__create_task_tag.sql server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskTagAssociationRepository.java server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskTagAssociationRepositoryIntegrationTest.java && git commit -m "feat(task): add owner-scoped task-tag association persistence"`

### Task 3 — Add typed Task tag selection and strict request validation

**Files**
- Create `server/src/main/java/com/krishnamurti/horizon/task/application/TaskTagSelection.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/application/TaskPatch.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/CreateTaskRequest.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskRequestMapper.java`
- Create `server/src/test/java/com/krishnamurti/horizon/task/web/TaskRequestMapperTest.java`
- Update compilation-affected TaskPatch/CreateTaskRequest unit tests and call sites only as needed.

**Interfaces**
- `public record TaskTagSelection(Long id, String name)` with exactly one non-null field; no cross-module types.
- `List<TaskTagSelection> parseTags(JsonNode node)` in `TaskRequestMapper` (null-vs-absent handled at the owning POST/PATCH boundary; use a separate presence test for PATCH).
- `TaskPatch` adds `FieldUpdate<List<TaskTagSelection>> tags`; `CreateTaskRequest` adds `JsonNode tags` to distinguish an omitted field from explicit JSON null.

- [ ] **RED:** `TaskRequestMapperTest`: a POST missing `tags` yields empty; PATCH missing `tags` yields absent; `[]` yields present empty; mixed valid `[{"id":42},{"name":"Architecture"}]` parsed. Assert 400 with `errors.tags` for `null`, non-array, scalar element, negative/zero/fractional ID, both ID/name, neither, unknown keys, non-string name and blank name; leave length/control enforcement to #56 Tag API on save.
- [ ] **Verify RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=TaskRequestMapperTest test` fails for missing tag field/parser.
- [ ] **GREEN:** Extend only existing Task request/patch types; preserve existing title/description/priority/due-date parsing and their tests. Use strict JSON-node element shape checks, not permissive record-deserialization defaults; no new HTTP endpoint.
- [ ] **Verify GREEN:** Focused tests pass; `cd server && ./mvnw -Duser.timezone=UTC -Dtest=TaskCommandServiceTest test` still compiles/passes after adapting patch constructors.
- [ ] **Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task/application server/src/main/java/com/krishnamurti/horizon/task/web server/src/test/java/com/krishnamurti/horizon/task && git commit -m "feat(task): validate presence-aware tag assignment requests"`

### Task 4 — Resolve and replace tags atomically in Task commands

**Files**
- Create `server/src/main/java/com/krishnamurti/horizon/task/application/TaskTagAssignmentService.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/infrastructure/TaskRepository.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/application/TaskCommandService.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskExceptionHandler.java`
- Modify `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`
- Add `server/src/test/java/com/krishnamurti/horizon/task/application/TaskTagAssignmentServiceIntegrationTest.java` for transaction/concurrency behavior.

**Interfaces**
- `boolean replace(Long ownerId, Long taskId, List<TaskTagSelection> selections)` in `TaskTagAssignmentService` (requires existing transaction): existing IDs resolve via `TagQueryApi.findById`, new names via `TagCommandApi.resolveByName`, unique ID set passed to repository; true only when changed.
- `TaskRepository.lockOwnedForTagWrite(Long taskId, Long userId)`: pessimistic owner-scoped Task lock; no access to deleted tasks in ordinary edit.
- `Task.touchMetadata(OffsetDateTime now)`: explicit domain-owned update of `updatedAt` on changed associations, without touching Inbox/lifecycle properties. Prefer existing `BaseEntity` setter only through this domain method.

- [ ] **RED:** Controller/integration tests: create with ID+new name, `Horizon` vs `horizon` one Tag/one link, duplicate ID selections collapsed; PATCH `tags` omitted/empty/replaced; updates leave other Task fields and an `inbox=true` captured Task unchanged; `updated_at` advances only on a real link change; owner B's Tag ID used by A => 404 and no change.
- [ ] **RED:** Transaction tests: resolution of a new name followed by an invalid name or forced link-write failure rolls back **new Tag** and links; concurrent full-set writes for the same owned Task serialize and produce one whole final set, not an interleaving; cross-owner Task editing stays 404.
- [ ] **Verify RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=TaskControllerIntegrationTest,TaskTagAssignmentServiceIntegrationTest test` demonstrates missing behavior (existing unrelated tests remain valid).
- [ ] **GREEN:** Wire both create and PATCH through `TaskCommandService` transaction; Task row lock for tag replacements; validate all IDs owner-scoped before name resolution where practical; resolve names through public API, dedupe IDs and replace atomically. Never call Tag persistence directly. Call `touchMetadata` on actual association changes. Map public `InvalidTagNameException` to 400 `errors.tags` in Task's existing advice and unknown/foreign tag IDs to 404.
- [ ] **Verify GREEN:** Focused integration tests pass, including rollback/concurrency; existing TaskControllerIntegrationTest behavior remains green.
- [ ] **Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task server/src/test/java/com/krishnamurti/horizon/task && git commit -m "feat(task): save tag sets transactionally through public Tag API"`

### Task 5 — Return tags efficiently and preserve idempotent creation

**Files**
- Create `server/src/main/java/com/krishnamurti/horizon/task/application/TaskTagQueryService.java`
- Create `server/src/main/java/com/krishnamurti/horizon/task/web/TaskTagResponse.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskSummaryResponse.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskDetailResponse.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskResponseMapper.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/application/TaskCreationFingerprint.java`
- Modify `server/src/main/java/com/krishnamurti/horizon/task/application/IdempotentTaskCreationService.java`
- Modify the Task controller, fingerprint, idempotency, service and query tests affected by DTO/constructor changes.

**Interfaces**
- `Map<Long,List<TagReference>> tagsForTasks(Long ownerId, Collection<Long> taskIds)` in `TaskTagQueryService`: one association query and **at most one** `TagQueryApi.findAllByIds` call for the whole collection; sort each list case-insensitively and deterministically.
- `TaskTagResponse(Long id, String name)`; extend Task response mappers to accept resolved tags, produce `tags: []` for untagged tasks.
- Extend `TaskCreationFingerprint.compute(..., List<InitialChecklistItem> checklist, List<TaskTagSelection> tags)` and `IdempotentTaskCreationService.create(..., checklist, tags)`, retaining any existing overloads needed by existing callers/tests. Treat tag selections as a set for fingerprint order, with deterministic ID/name tokens and conservative name spelling.

- [ ] **RED:** Add GET/list tests for sorted `tags: [{id,name}]` and empty `tags:[]`, unassociated Tag not appearing on Task, no Tag leakage from other users, and **batch behavior** (instrument/mock `TagQueryApi.findAllByIds` to assert one call for multi-task list, no repeated `findById`).
- [ ] **RED:** `TaskCreationFingerprintTest` asserts reordered same tags produce same hash, different Tag set changes hash, ID/name references are not conflated; idempotency tests assert same key+payload returns one Task with its tags and changed tags => 409. Include a retry after Tag was persisted.
- [ ] **Verify RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=TaskControllerIntegrationTest,TaskCreationFingerprintTest,IdempotentTaskCreationServiceTest test` fails for missing response/fingerprint handling.
- [ ] **GREEN:** Introduce query service and mapper, batch hydration in `TaskController.list` and single-task path used by create/get/update/lifecycle; propagate tag selections through both idempotent/non-idempotent creation; do not append a per-task Tag query inside a `stream().map(...)`. Maintain transaction and owner boundaries.
- [ ] **Verify GREEN:** Focused command passes. Check the response after archive/delete/restore still contains same tags where detail endpoints are available; verify no tag or Task status enum is added.
- [ ] **Commit:** `git add server/src/main/java/com/krishnamurti/horizon/task server/src/test/java/com/krishnamurti/horizon/task && git commit -m "feat(task): expose batched tag metadata and idempotent creation"`

### Task 6 — Build the reusable chip selector and suggestion client

**Files**
- Create `client/src/tag/api.ts`
- Modify `client/src/task/types.ts`
- Create `client/src/task/TaskTagSelector.tsx`
- Create `client/src/task/TaskTagSelector.test.tsx`
- Update existing Task test fixtures using `TaskSummary` / `TaskDetail` to include `tags: []` where needed; do not weaken type requirements.

**Interfaces**
- `type TaskTag = {id:number;name:string}`; `type TaskTagSelection = {id:number}|{name:string}`; `CreateTaskPayload.tags?: TaskTagSelection[]`; `UpdateTaskPayload` adds `{tags:TaskTagSelection[]}`; Task responses require `tags:TaskTag[]`.
- `tagApi.suggest(prefix: string)`: GET `/tags/suggestions?q=...`, response `{items: TaskTag[]}` (type may be owned in `tag/api.ts` and imported).
- `TaskTagSelector` controlled `value: TaskTagSelection[]`, `onChange(next: TaskTagSelection[]):void`, `userId:number`, `disabled?:boolean`; resolve display of preexisting IDs from supplied Task tags/suggestions without a new Tag HTTP lookup. If a simpler prop shape keeps the two owner surfaces consistent, document it before changing callers.

- [ ] **RED:** Component tests: suggestions fetch by typed prefix, case-insensitive same Tag not duplicated, selecting existing stores ID, explicit Create stores name but **never calls POST**, remove chip, literal commas/symbols/Unicode preserved, keyboard Arrow/Enter/Escape, loading/empty/error states and accessibility labels. Change prefix quickly and change owner; stale responses must not appear.
- [ ] **Verify RED:** `cd client && npm run test -- src/task/TaskTagSelector.test.tsx` fails before selector exists.
- [ ] **GREEN:** Implement with existing Axios API client, TanStack Query keys scoped to `userId` and prefix, controlled state and accessible combobox/listbox mechanics. Never persist on selection or use comma splitting. Keep shadcn/Tailwind visual rules and no new dependency.
- [ ] **Verify GREEN:** Focused test passes, `npm run typecheck` passes after updating fixtures/callers. No cross-owner cached suggestions.
- [ ] **Commit:** `git add client/src/tag client/src/task && git commit -m "feat(task): add reusable draft tag selector with suggestions"`

### Task 7 — Integrate tags into Task creation and retry semantics

**Files**
- Modify `client/src/task/TaskCreateForm.tsx`
- Modify `client/src/task/TaskCreateForm.test.tsx`
- Modify `client/src/task/useCreateTask.ts` only if required to retain tag data in its cache projection
- Modify `client/src/task/TaskCreateSurface.test.tsx` for create abandonment navigation if needed.

**Interfaces**
- Selector changes are draft-only; creation submit snapshot includes final selections alongside other fields, using existing UUID `Idempotency-Key`. Task creation dirty-state checks include unsaved tag draft state.

- [ ] **RED:** With only title and tags selected, create payload contains existing ID and new name; selection/deselection is dirty; cancel yields no create/Tag write and clears draft; ambiguous 5xx/network failure keeps the **same** payload+key for Retry, including tags; server 400 tags failure leaves form editable with a meaningful tag error; successful create opens details containing persisted tags.
- [ ] **Verify RED:** `cd client && npm run test -- src/task/TaskCreateForm.test.tsx` fails for missing tag support.
- [ ] **GREEN:** Render `TaskTagSelector` in existing creation form; incorporate selected chips in `reportDirtyFromCurrentValues`, draft guard callbacks, `fieldsDisabled`, `onSubmit` and error recovery. Do not introduce a separate Tag-save mutation or reset in-flight snapshot on retry.
- [ ] **Verify GREEN:** Focused test and `npm run typecheck` pass.
- [ ] **Commit:** `git add client/src/task/TaskCreateForm.tsx client/src/task/TaskCreateForm.test.tsx client/src/task/useCreateTask.ts client/src/task/TaskCreateSurface.test.tsx && git commit -m "feat(task): create Tasks with draft tags on Save"` (stage only files actually touched).

### Task 8 — Integrate per-field tag editing with Save/Cancel and navigation safety

**Files**
- Create `client/src/task/useTaskTagsEdit.ts`
- Create `client/src/task/TaskTagsField.tsx`
- Modify `client/src/task/TaskDetailView.tsx`
- Modify `client/src/task/TaskDetailView.test.tsx`
- Modify `client/src/task/TaskDetailSurface.test.tsx` or `TaskSessionBoundary.test.tsx` if needed for navigation/owner changes.

**Interfaces**
- `useTaskTagsEdit(task:TaskDetail,userId:number)` returns `editing`, `draft`, `dirty`, `pending`, `error`, `activate`, `change`, `save():Promise<boolean>`, `cancel`. `save` issues precisely one `PATCH {tags:[...]}`; no API request before Save. Draft identity follows task/user changes.

- [ ] **RED:** Detail shows all sorted tags (including zero-tag placeholder); double-click/keyboard starts edit, chip add/remove retains draft, Cancel discards and creates no Tag, Save PATCHes full selection, server error retains draft, no field-blur save. Verify unsaved navigation Save/Discard, task switch, owner switch, and exclusion with title/priority/due-date/description/checklist edit sessions.
- [ ] **Verify RED:** `cd client && npm run test -- src/task/TaskDetailView.test.tsx` fails for missing tags field/guard.
- [ ] **GREEN:** Add read/edit component, new edit hook, reuse `TaskTagSelector`; extend `TaskDetailView`'s existing `saveRef`/`cancelRef` draft registration to tags and update editing exclusion predicates. Preserve full-page vs side-panel shared view. Do not create another global draft provider.
- [ ] **Verify GREEN:** Focused tests and `npm run typecheck` pass; no navigation guard regression.
- [ ] **Commit:** `git add client/src/task && git commit -m "feat(task): edit tag sets with guarded Save and Cancel"`

### Task 9 — Render compact list metadata, keep caches coherent, and run regression gates

**Files**
- Modify `client/src/task/TaskRow.tsx`
- Modify `client/src/task/TaskRow.test.tsx`
- Modify `client/src/task/useUpdateTask.ts`
- Modify `client/src/task/useUpdateTask.test.tsx`
- Modify existing Task creation/list/detail cache tests only as required.
- No new product-scope features.

**Interfaces**
- Row renders at most two chips from the **already sorted response**, plus `+N` when `tags.length > 2` without nested interactive elements. `useUpdateTask` updates Task detail and list `tags` from the successful server result and retains other fields/owner isolation.

- [ ] **RED:** `TaskRow.test.tsx`: zero tags produces no badges; one/two shows all; five shows first two and `+3`, full set still accessible from detail; row click still opens panel and completion/menu remain independently clickable. `useUpdateTask.test.tsx`: successful tag PATCH updates detail/list, updatedAt, owner A only; other field updates do not clobber cached tags; create/lifecycle projections preserve tags.
- [ ] **Verify RED:** `cd client && npm run test -- src/task/TaskRow.test.tsx src/task/useUpdateTask.test.tsx` fails for missing metadata/cache behavior.
- [ ] **GREEN:** Render metadata in existing row's second line and keep `+N` informational; update mutation cache logic for `'tags' in variables.patch` and protect against stale user/task results. Do not enable filtering (#29).
- [ ] **Verify GREEN:** Focused tests pass; run `cd client && npm run test && npm run typecheck && npm run lint && npm run format:check && npm run build`.
- [ ] **Backend gate:** `cd server && ./mvnw -Duser.timezone=UTC verify`; test migration, Tag and Task integrations with PostgreSQL Testcontainers. If formatting fails, use existing repo formatting task and rerun checks, then commit fixes.
- [ ] **Final self-review:** Cross-check every acceptance item in the approved design and #27 issue. Inspect `git diff master...HEAD` for accidental cross-module imports, standalone Tag-create endpoint, Inbox mutation, Tag deletion, N+1 response queries, unwanted Task status fields, broken older tests or formatting changes. Report verification results honestly, and do **not** autonomously merge.
- [ ] **Commit:** `git add client/src/task && git commit -m "feat(task): show compact tag metadata and keep Task caches in sync"` (stage only changed files; if final verification reveals fixes, make a separate focused fix commit).

## Completion handoff to the issue

After implementation, Luna should leave a concise #27 issue comment with:
- Commit(s)/PR link and implemented scope; no automatic merge.
- Verification commands executed and results, including Testcontainers/DB and client checks.
- Confirmation of all eight owner decisions, especially `inbox` never changing.
- Any deviations, remaining issues or follow-ups (e.g., #29 filtering, deferred source PRD reconciliation).
- No subagent activity.

**Planning-only delivery:** This branch initially contains only the approved design and this plan. Implementation is delegated to Luna after owner review.
