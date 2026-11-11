# Horizon #72 — Notes Shared Tags Implementation Plan

> **For agentic workers (Luna):** REQUIRED SUB-SKILL: **superpowers:executing-plans**. Execute **inline/native only; NO SUBAGENTS**. Follow each checkbox in order, red/green tests, small reviewed commits. Do not write implementation code until you have read the approved spec and relevant repository guidance. Never merge without owner approval.

**Goal:** Integrate Notes with Horizon's shared owner-scoped Tags while preserving existing Task UX and #69/#71 Note idempotency, optimistic locking, autosave, session recovery and #68-approved Notes presentation.

**Architecture:** Note owns its note_tag associations; Tag identities and canonicalization remain owned by tag.api. Extend Note POST/PATCH/GET/list and its one transaction/one-version lifecycle. Extract only the generic Tag selector/types to client/tag; extend the existing NoteSaveCoordinator and memory-only recovery rather than building a second saver.

**Tech Stack:** Java 25, Spring Boot 4.0.6, PostgreSQL 17, Flyway, Spring JPA/JDBC, JUnit/MockMvc/Testcontainers; React 19, TypeScript, TanStack Router/Query, Tiptap, Vitest, Testing Library, Playwright.

**Spec:** [2026-11-11-notes-shared-tags-design.md](../specs/2026-11-11-notes-shared-tags-design.md) (owner-approved 2026-11-11). Also [#72](https://github.com/krishna916/horizon/issues/72), [#68](https://github.com/krishna916/horizon/issues/68), [approved Notes mockup DESIGN-SPEC](../../design/notes-workspace/DESIGN-SPEC.md), #69 and #71. PRD-005, SPEC-001, SPEC-002 apply where not superseded by explicit #68/#72 decisions. Tag filtering is separately tracked in [#89](https://github.com/krishna916/horizon/issues/89) and must NOT be built in this story.

## Global constraints

- **Security:** owner ID from CurrentUserProvider only; Note association queries owner-filtered; only call the shared tag.api interfaces from Note. Missing/foreign Tag ID -> identical generic **400 tags** Problem Details; missing/foreign/deleted Note -> 404. No cross-owner Tag name or ID leakage.
- **Semantics:** POST optional tags; omitted and [] equivalent; null invalid; first meaningful title/body only, never tag-only Note creation. A Tag suggestion is a GET, and unpersisted selection must not call Tag resolution/create. PATCH omitted tags preserve, [] clear, null invalid, supplied array replaces all, stale expectedVersion 409.
- **Normalization:** Tag name normalization/reuse is shared: trim supported Unicode edge spaces, reject blank/control/over-100-codepoint names, case-insensitive identity. POST fingerprint sorts/dedupes normalized Tag request representations, with distinct ID-vs-name forms; same key and changed payload -> 409. Do not duplicate Tag-domain normalization rules inside Note.
- **Version/timestamp:** genuine Tag association change advances Note @Version and updatedAt **exactly once**, combined with content/title mutations; true no-op advances neither. Never modify inbox, archivedAt, deletedAt or delete unused Tag rows.
- **UX:** full-page Note editor metadata placement; Cards top two alphabetically with +N; responsive List Tags. Keep all #68 sizing/reading order, optional titles and no side panel. Shared selector; Tasks keep Save/Cancel and “Create tag”; Notes label new-name selection “Add tag”.
- **Reliability:** reuse #71 serial coordinator, frozen POST/key, patch version conflicts and whole-draft Keep/Load, uncertain retry, Tag-aware same-owner in-memory recovery, explicit logout/owner switch clearing. Definitive 400 requires correction + manual Retry with a fresh POST key; no localStorage/sessionStorage/IndexedDB draft persistence.
- **No speculative extras:** no Tag management, global Search Tag matching, filters (#89), media (#78/#79), Note archive/trash (#73), new Note status enum, separate Tag save service in frontend, unrelated Task refactor, or authoritative PRD/Constitution edits.
- **Instructions:** read Agents.md, docs/ai/INDEX.md, docs/ai/HORIZON_DECISION_SUMMARY.md, server/AGENTS.md, client/AGENTS.md, ENG-001/ENG-002, and .agents/skills/align-context, cross-module-api, flyway-migration, testing-spring-integration, testing-frontend. Follow UTC Maven JVM timezone and Testcontainers Spring Session cookie patterns. Do not manually modify generated router trees.
- **Execution:** stay on feature/72-notes-shared-tags; one RED→GREEN→REFACTOR check per task; focused commits; no subagents. Stop/escalate material design gaps, behavior changes and broad API alterations before proceeding. Avoid claiming environmental test blockers as passes.

## File responsibility map

| Files | Responsibility |
| --- | --- |
| server/src/main/resources/db/migration/V20261111000000__create_note_tag.sql | Note-owned join table, FKs and lookup index; verify migration name remains next available on branch |
| server/.../note/infrastructure/NoteTagAssociationRepository.java (+ test) | Owner-filtered join reads, replace and batch hydration by Note IDs |
| server/.../note/application/NoteTagSelection.java, NoteTagAssignmentService.java, NoteTagQueryService.java (+ tests) | Value input, shared Tag API resolution, transactional replacement, ordered batch Tag DTO lookup |
| server/.../tag/api/TagNormalizationApi.java and tag/application implementation (+ tests) | Only if needed: minimal public read-only canonical name policy for Note fingerprints, delegating to existing TagNamePolicy without duplicating policy; keep Tag behavior unchanged |
| server/.../note/application/IdempotentNoteCreationService.java, NoteCreationFingerprint.java, NoteCommandService.java, NotePatch.java (+ tests) | Atomic POST + fingerprint/replay and versioned full Tag-set PATCH |
| server/.../note/domain/Note.java (+ tests) | Explicit metadata touch for tag-only real changes; leverage existing @Version and BaseEntity @PreUpdate |
| server/.../note/application/NoteQueryService.java, NotePage.java and server/.../note/web/{NoteController,NoteRequestMapper,NoteResponseMapper,NoteDetailResponse,NoteSummaryResponse,NoteExceptionHandler,NoteTagResponse}.java | Include canonical tags in owner-scoped read/write and paginated JSON APIs |
| client/src/tag/{types.ts,TagSelector.tsx,TagSelector.test.tsx,api.ts} | Shared Tag types/suggestions, accessible selector, label override for Notes |
| client/src/task/{types.ts,TaskTagSelector.tsx,TaskTagsField.tsx,TaskTagSelector.test.tsx} (+ affected Task tests) | Re-export/adapter if required; preserve Task Save/Cancel and exact existing behavior |
| client/src/note/{types.ts,api.ts,noteDraft.ts,NoteSaveCoordinator.ts,useNoteAutosave.ts,NoteDraftRecoveryProvider.tsx,NoteEditorNavigationGuard.tsx,NoteEditorPage.tsx} (+ existing corresponding tests) | Tag-inclusive complete draft, frozen requests, conflicts, retry errors, owner recovery and navigation |
| client/src/note/{NoteCard.tsx,NoteListRow.tsx} (+ tests) | #68-compliant Tag chips/overflow, responsive tags column, stable links |
| client/e2e (existing notes editing/spec files; inspect first) | Browser flow, new/persisted Note Tags, no-write draft, accessibility |

> All abbreviated server paths are under `server/src/main/java/com/krishnamurti/horizon/`. Tests are under the matching `server/src/test/java/com/krishnamurti/horizon/` packages. Expand paths exactly in commits. Do not create a new controller per use case.

## Review focus — regression risks not to overlook

1. **Tag-only draft → session expires → same owner returns:** retain staged selections in memory but never initiate POST; explicit logout and other user discard.
2. **First POST accepted but response lost, then local Tag selection changes:** same frozen key/body for reconciliation, followed by one versioned PATCH, never a second POST with a modified payload.
3. **Tag-only PATCH with no title/body change:** persist Tag set, bump Note version/timestamp once; identical resolved Tag IDs do not bump; stale concurrent versions return 409.
4. **Missing/foreign Tag ID combined with newly named Tag:** same generic 400; full rollback of new Tag, Note/association, creation receipt.
5. **Task selector extraction changes existing Task behavior:** keyboard, duplicate, label, suggestions, Save/Cancel and owner query keys remain functionally identical.

Each item is explicitly tested in its owning task below.

---

### Task 1 — Note-owned join persistence (SQL and repository)

**Files:** Create `server/src/main/resources/db/migration/V20261111000000__create_note_tag.sql`; create `server/src/main/java/com/krishnamurti/horizon/note/infrastructure/NoteTagAssociationRepository.java`; test `server/src/test/java/com/krishnamurti/horizon/note/infrastructure/NoteTagAssociationRepositoryIntegrationTest.java`.

**Interfaces:** `findTagIdsForNote(Long ownerId, Long noteId): Set<Long>`; `findTagIdsByNoteIds(Long ownerId, Collection<Long> noteIds): Map<Long,List<Long>>`; `replace(Long ownerId, Long noteId, Set<Long> tagIds): void`. Note existence/ownership must be enforced in JOIN/WHERE and caller transaction, not trusted client values.

- [ ] **Step 1 RED:** Write Testcontainers migration/repository tests: composite `(note_id,tag_id)` uniqueness/FKs; owned Note link, foreign Note no mutation, batch returns only owned Note IDs, last unlink retains Tag; empty ID batch executes no query. Use schema validation.
- [ ] **Step 2 RUN RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteTagAssociationRepositoryIntegrationTest test`; expect failing test or missing schema/class.
- [ ] **Step 3 GREEN:** Add migration modeled on `V20261103000000__create_task_tag.sql`: `note_tag(note_id BIGINT NOT NULL, tag_id BIGINT NOT NULL)`, `pk_note_tag`, `fk_note_tag_note`, `fk_note_tag_tag`, `idx_note_tag_tag_id`. Add JDBC owner-scoped Note join repository modeled on TaskTagAssociationRepository; batch read page Note IDs; reject/avoid unowned writes.
- [ ] **Step 4 VERIFY:** Rerun targeted test, require PASS, and schema checks. Verify index and no new Tag columns.
- [ ] **Step 5 COMMIT:** `git add server/src/main/resources/db/migration server/src/main/java/com/krishnamurti/horizon/note/infrastructure server/src/test/java/com/krishnamurti/horizon/note/infrastructure && git commit -m "feat(notes): persist owner-scoped note tag associations"`.

### Task 2 — Owner-safe Tag resolution and ordered Note Tag query

**Files:** Create `note/application/NoteTagSelection.java`, `NoteTagAssignmentService.java`, `NoteTagQueryService.java`; tests `note/application/NoteTagAssignmentServiceIntegrationTest.java`, `NoteTagQueryServiceIntegrationTest.java`; if a shared fingerprint normalization service is required create narrowly scoped `tag/api/TagNormalizationApi.java` + `tag/application/TagNormalizationService.java` and test that its outputs agree with TagNamePolicy.

**Interfaces:** `NoteTagSelection(Long id,String name)` (exactly one non-null, positive ID); `NoteTagAssignmentService.replace(Long ownerId,Long noteId,List<NoteTagSelection> selections): boolean` runs within existing writable transaction, resolves owned IDs with `TagQueryApi.findAllByIds` and names with `TagCommandApi.resolveByName`, compares effective set, and only replaces when changed. `NoteTagQueryService.tagsForNotes(Long ownerId,Collection<Long> ids): Map<Long,List<TagReference>>`, with comparator `lowercase(Locale.ROOT) → display name → tag ID`, matching existing TaskTagQueryService. For fingerprint normalization without Tag lookup or mutation, use a small public Tag normalization adapter delegated to shared TagNamePolicy if needed; **no Note import from tag/domain or tag/infrastructure**.

- [ ] **Step 1 RED:** Integration tests: Task-owned Tag reused by Note by name and ID; Note-created Tag subsequently returned by shared suggestions; mixed names/case/IDs dedupe by resolved identity; foreign Tag ID rejected via Note-specific invalid-reference exception; missing ID same behavior; no Tag row deleted on unlink; induced write failure rolls back newly resolved Tag. Query tests cover zero/one/many Note IDs, owner boundaries and case-insensitive sorted Tag references. Verify normalization helper covers Unicode-edge spaces/control chars.
- [ ] **Step 2 RUN RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteTagAssignmentServiceIntegrationTest,NoteTagQueryServiceIntegrationTest test`; expect red.
- [ ] **Step 3 GREEN:** Implement thin Note services and owner-scoped batch loading; keep Tag internals entirely inside tag. Return change boolean for command service to advance Note version exactly once. Handle absence of any Tag IDs without loading shared names. Ensure concurrency follows existing shared Tag transaction contract.
- [ ] **Step 4 VERIFY:** Rerun targeted tests; require green and verify no Note imports of task or tag internals.
- [ ] **Step 5 COMMIT:** `git add server/src/main/java/com/krishnamurti/horizon/{note,tag} server/src/test/java/com/krishnamurti/horizon/{note,tag} && git commit -m "feat(notes): resolve shared Tags through owner-safe APIs"`.

### Task 3 — Idempotent atomic Note POST with normalized Tag request forms

**Files:** Modify `note/web/{NoteRequestMapper,NoteController,NoteResponseMapper,NoteDetailResponse,NoteExceptionHandler}.java`, `note/application/{IdempotentNoteCreationService,NoteCreationFingerprint,NoteCommandService}.java`; create `note/web/NoteTagResponse.java` if used by DTO; tests `note/application/{NoteCreationFingerprintTest,IdempotentNoteCreationServiceTest}.java`, `note/web/{NoteControllerIntegrationTest,NoteCreationConcurrencyIntegrationTest}.java`.

**Interfaces:** `CreateFields(String title,Map<String,Object> content,List<NoteTagSelection> tags)`; POST `tags?: [{id}|{name}]`, omitted/[] equivalent, null 400; `NoteCreationFingerprint.compute(normalizedTitle,normalizedContent,normalizedTagRefs)` digest of sorted/deduped *submitted* normalized forms, without resolving Tag entities for fingerprint computation. Maintain same receipt claim API and transactional replay semantics; API response now contains canonical `tags: [{id,name}]`.

- [ ] **Step 1 RED:** Request mapper tests for omitted/[]/null, exact-one-field object, positive ID, normalized case/edge whitespace, duplicates. Fingerprint tests: reorder/dedupe/case variants same hash; omitted vs [] same; ID form vs name form different; changed content or Tags with reused key returns 409.
- [ ] **Step 2 RED:** PostgreSQL HTTP tests: tag-only/blank request creates no Note/Tag/receipt; POST meaningful + new Tag atomically commits; same-key replay returns same Note/Tags, no mutation; foreign/missing Tag ID generic 400, no owner leak; invalid named Tag rollback including receipt; concurrent identical requests create one Note/Tag set.
- [ ] **Step 3 RUN RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteCreationFingerprintTest,IdempotentNoteCreationServiceTest,NoteControllerIntegrationTest,NoteCreationConcurrencyIntegrationTest test`; expect RED.
- [ ] **Step 4 GREEN:** Extend mapper and ID/name validation; call NoteTagAssignmentService in the **same transaction** as receipt claim/Note create; make fingerprint independent of Tag lookup and Tag creation; reuse created Note on replay without replacing its Tags; map canonical ordered Tag responses. Explicitly distinguish missing/foreign Tag ID 400 from Note 404 and stale-key 409 via RFC 9457.
- [ ] **Step 5 VERIFY:** Rerun targeted suite; require green. Verify no Tag or receipt survives failed first create, and no Tag-only POST persists.
- [ ] **Step 6 COMMIT:** `git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): create Notes and staged Tags atomically"`.

### Task 4 — Versioned Tag PATCH and paginated GET hydration

**Files:** Modify `note/domain/Note.java`, `note/application/{NotePatch,NoteCommandService,NoteQueryService,NotePage}.java`, `note/web/{NoteController,NoteRequestMapper,NoteResponseMapper,NoteDetailResponse,NoteSummaryResponse,NoteListResponse,NoteExceptionHandler}.java`; tests `note/application/{NoteCommandServiceIntegrationTest,NoteQueryServiceIntegrationTest}.java`, `note/web/NoteControllerIntegrationTest.java`.

**Interfaces:** `NotePatch(expectedVersion,title,content,FieldUpdate<List<NoteTagSelection>> tags)`. `GET /notes/{id}` and `GET /notes` include canonical ordered `tags`. Use `NoteTagQueryService.tagsForNotes(ownerId, page Note IDs)` for bounded batch fetch; detail and post/update fetch exact owned Note Tags. Existing Page/count/preview semantics unchanged.

- [ ] **Step 1 RED:** Test PATCH tags omitted preserve, [] clear, null 400, name+ID effective dedupe, unchanged effective set is no-op including timestamp/version, Tag-only real change increments version and timestamp once, combined content+Tags increments once, stale version 409 including concurrent PATCH, invalid Tag rollback, inbox/archive unchanged.
- [ ] **Step 2 RED:** HTTP/page tests: owner-safe detail and paginated list each include sorted Tag DTOs; Tag count per page 0/1/many; no N+1; original count, sort, bounded preview and deleted/archived exclusion unaffected.
- [ ] **Step 3 RUN RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteCommandServiceIntegrationTest,NoteQueryServiceIntegrationTest,NoteControllerIntegrationTest test`; expect RED.
- [ ] **Step 4 GREEN:** Parse presence-aware tags, resolve and replace atomically with title/body mutations. For an effective join-only change explicitly dirty the Note aggregate (e.g., narrow metadata-touch method affecting updatedAt) so the existing JPA @Version advances during *one* flush; do not depend on JDBC join update to change @Version. Validate optimistic-lock race rollback and one timestamp update. Batch hydrate Tags per bounded page, not per item.
- [ ] **Step 5 VERIFY:** Target suite green plus `cd server && ./mvnw -Duser.timezone=UTC test`. If any migration collision appears, choose next timestamp without editing previously applied migration.
- [ ] **Step 6 COMMIT:** `git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): autosave versioned Tags and return ordered metadata"`.

### Task 5 — Extract reusable frontend Tag selector without Task behavior change

**Files:** Create `client/src/tag/types.ts`, `TagSelector.tsx`, `TagSelector.test.tsx`; modify `client/src/tag/api.ts`, `client/src/task/{types.ts,TaskTagSelector.tsx,TaskTagsField.tsx}` and `TaskTagSelector.test.tsx` as necessary. Existing Task editing tests (`useTaskTagsEdit.test.tsx`, `TaskDetailPage.test.tsx`, `TaskCreateForm.test.tsx`) must remain green.

**Interfaces:** `Tag = {id:number;name:string}`; `TagSelection = {id:number}|{name:string}` in tag/types.ts. `TagSelector({value:TagSelection[],onChange:(next:TagSelection[])=>void,userId:number,knownTags?:Tag[],disabled?:boolean,createLabel?:'create'|'add'})`; default Task wording “Create tag”; Notes use `createLabel='add'`. `tagApi.suggest(prefix)` yields shared Tag[], no import from task. Task adapter/re-export is allowed if it preserves existing exports and avoids broad churn.

- [ ] **Step 1 RED:** Shared selector test for accessible combobox keyboard/Arrow/Enter/Escape, existing suggestions, duplicate prevention, case-insensitive names, owner query scope, Notes-specific “Add tag”, and no create API call on selection. Keep Task test asserting existing “Create tag”, explicit Save/Cancel, and unchanged selection flow.
- [ ] **Step 2 RUN RED:** `cd client && npm run test -- src/tag/TagSelector.test.tsx src/task/TaskTagSelector.test.tsx src/task/useTaskTagsEdit.test.tsx`; expect RED for shared component.
- [ ] **Step 3 GREEN:** Move generic selector/types from Task to tag feature; update tag/api.ts to own its types. Retain Task-specific state and Save/Cancel in task; avoid new dependencies or redesigns. Keep shared selector label configurable without exposing Note-specific concepts to Task.
- [ ] **Step 4 VERIFY:** Rerun targeted tests plus `cd client && npm run typecheck`, requiring PASS.
- [ ] **Step 5 COMMIT:** `git add client/src/tag client/src/task && git commit -m "refactor(tags): share accessible selector across Tasks and Notes"`.

### Task 6 — Tag-aware Note draft, transport and save coordinator

**Files:** Modify `client/src/note/{types.ts,api.ts,noteDraft.ts,NoteSaveCoordinator.ts,useNoteAutosave.ts}` and tests `{api.test.ts,noteDraft.test.ts,NoteSaveCoordinator.test.ts,useNoteAutosave.test.tsx}`.

**Interfaces:** Extend `NoteDraft` to `{title:string;content:RichTextDocument|null;tags:TagSelection[]}`; extend normalized create and versioned update bodies with full `tags`, response types with canonical `Tag[]`. `noteDraftsEqual(a,b)` compares normalized text/content plus *effective Tag selection* ignoring order/duplicates; preserve name-vs-ID request identity for POST fingerprint and map acknowledged canonical server Tags into baseline. Transport POST/GET/PATCH remains existing Note API, not separate Tag transport.

- [ ] **Step 1 RED:** Draft normalization: tag-only not meaningful, staged Tags included with first meaningful title/body; sorted/deduped list and comparison independent of display order; server returned canonical IDs/names handled consistently, no synthetic title/Tag creation.
- [ ] **Step 2 RED:** Coordinator fake-timer tests: first POST includes staged Tags and one UUID; Tags edited during delayed POST remain local, first response doesn't overwrite newer edits, exactly one later PATCH; edits reverted to created canonical Tag set skip PATCH; POST response lost triggers frozen body/key retry; existing title/body save tests still pass.
- [ ] **Step 3 RED:** 400 validation tests: draft and actionable `tags` error retained, autosave paused, correct+Retry makes new frozen POST/key (or current versioned PATCH) and clears error on success; no automatic retry. 409 whole-draft Keep/Load includes Tags and repeated 409 pauses; network uncertainty still resends frozen request. Same-owner cache invalidation of `['tags','suggestions',ownerId,...]` after a Note-created Tag becomes visible in Tasks.
- [ ] **Step 4 RUN RED:** `cd client && npm run test -- src/note/noteDraft.test.ts src/note/NoteSaveCoordinator.test.ts src/note/useNoteAutosave.test.tsx src/note/api.test.ts`; expect RED.
- [ ] **Step 5 GREEN:** Extend the existing coordinator's revision/baseline/frozen request/reconciliation/Retry logic with Tag fields. **Definitive** 400 clears rejected frozen snapshot only when regenerating corrected request after explicit Retry; it is NOT treated as unknown outcome. All other uncertain failures preserve frozen body/key. Keep response reconciliation and owner-check protection. Ensure clean/saved state is not claimed for pending changed Tags.
- [ ] **Step 6 VERIFY:** Same tests + `cd client && npm run typecheck`; require PASS, including existing autosave/session tests.
- [ ] **Step 7 COMMIT:** `git add client/src/note client/src/tag && git commit -m "feat(notes): include Tags in serialized autosave and retries"`.

### Task 7 — Tag-only navigation prompts and owner-bound memory recovery

**Files:** Modify `client/src/note/{NoteEditorNavigationGuard.tsx,NoteDraftRecoveryProvider.tsx,useNoteAutosave.ts,NoteSaveCoordinator.ts,NoteEditorPage.tsx}`; tests `NoteEditorNavigationGuard.test.tsx`, `NoteDraftRecoveryProvider.test.tsx`, `NoteEditorPage.test.tsx`, `useNoteAutosave.test.tsx`.

**Interfaces:** Snapshot exposes a **separate** `hasTagOnlyDraft` (or equivalent derived state) for staging/navigation. Do not make tag-only state count as meaningful save work or trigger a POST; owner-bound memory-only recovery must be retained even when ordinary hasUnsavedChanges remains false. Navigation guard distinguishes tag-only custom prompt from meaningful unsaved write guard. Browser beforeunload enabled on tag-only state where possible.

- [ ] **Step 1 RED:** New blank editor navigates without warning; select only Tags and press Back/router link → Stay and Discard Tags and Leave; Stay retains selections; Discard leaves and writes nothing; best-effort beforeunload registered for tag-only draft, never promises guaranteed browser warning. Meaningful unsaved draft retains #71 wait/retry guard.
- [ ] **Step 2 RED:** Unexpected auth expiry on tag-only new draft keeps Tags in memory hidden until verified same owner; no POST on restore; explicit logout, owner switch and intentional discard clean memory and prevent stale promise/cache leakage; refreshed tab has no durable draft.
- [ ] **Step 3 RUN RED:** `cd client && npm run test -- src/note/NoteEditorNavigationGuard.test.tsx src/note/NoteDraftRecoveryProvider.test.tsx src/note/useNoteAutosave.test.tsx src/note/NoteEditorPage.test.tsx`; expect RED.
- [ ] **Step 4 GREEN:** Extend existing navigation/recovery components rather than new persistence or second save guard; account for exception when `/notes/new` is replaced with canonical `/notes/{id}` after create (must not falsely display discard prompt). Preserve focus management and accessible native modal handling.
- [ ] **Step 5 VERIFY:** Target tests green plus existing auth/session-related Note tests.
- [ ] **Step 6 COMMIT:** `git add client/src/note && git commit -m "feat(notes): guard and recover tag-only drafts safely"`.

### Task 8 — Approved Notes editor, Card and List Tag presentation

**Files:** Modify `client/src/note/{NoteEditorPage.tsx,NoteCard.tsx,NoteListRow.tsx,NotesWorkspacePage.tsx}` only as required; tests `NoteEditorPage.test.tsx`, `NoteCard.test.tsx`, `NoteListRow.test.tsx`, `NotesWorkspacePage.test.tsx`.

**Interfaces:** Editor consumes `TagSelector` from `@/tag/TagSelector` with `createLabel='add'`; `value=snapshot.draft.tags`, `onChange` through existing `edit({...snapshot.draft,tags})`, owner-scoped userId and canonical knownTags. Card/List receive NoteSummary.tags from Note API; tags are ordered server-side and defensively displayed by same deterministic comparator, without Tag filtering.

- [ ] **Step 1 RED:** Editor Tag metadata sits after title and before toolbar, with owner suggestions and no independent Save tags button; note-only “Add tag” label. Tag-only empty draft selection does not call POST. Card with 0,1,2,4 Tags shows respectively none, one, two, first two plus +2, maintains 440px cap and native link. List Tags column hides progressively on narrow widths, no thumbnail or filter controls, and accessible names/focus.
- [ ] **Step 2 RUN RED:** `cd client && npm run test -- src/note/NoteEditorPage.test.tsx src/note/NoteCard.test.tsx src/note/NoteListRow.test.tsx src/note/NotesWorkspacePage.test.tsx`; expect RED.
- [ ] **Step 3 GREEN:** Implement approved #68 metadata placement, chips/overflow, responsive List; preserve sorting, preview, route origin and card hierarchy. Do not add a separate Tags filter control or Task coupling.
- [ ] **Step 4 VERIFY:** Target tests + `cd client && npm run typecheck && npm run lint && npm run format:check`; require PASS.
- [ ] **Step 5 COMMIT:** `git add client/src/note && git commit -m "feat(notes): show shared Tags in editor cards and list"`.

### Task 9 — End-to-end regression, quality gates and delivery notes

**Files:** Extend existing `client/e2e/notes-editing.spec.ts` if present (inspect actual e2e filenames first), or create `client/e2e/notes-tags.spec.ts`; update only targeted tests/implementation needed for verified defects. Do not modify PRD/Constitution or build Tag filtering here.

- [ ] **Step 1 RED:** Playwright flows: Tag-only stage→Stay/Discard no POST; first meaningful body creates Note with Tags and reload shows canonical chips; Task-created tag reused in Note selector; Notes-created Tag suggested on Tasks; input during delayed POST sends one POST plus eventual PATCH; confirmed 400 correction+Retry; whole-draft conflict; foreign owner invalid Tag; keyboard and responsive Card/List.
- [ ] **Step 2 RUN RED:** `cd client && npm run test:e2e -- --grep "Notes Tags"` (or actual test title pattern); expect RED prior to completing coverage.
- [ ] **Step 3 GREEN:** Fix only genuine defects found in these flows; keep changes scoped and testable. Check both Tag owner scopes, new→ID transition and no user data leakage.
- [ ] **Step 4 SERVER VERIFY:** `cd server && ./mvnw -Duser.timezone=UTC verify` (includes configured Spotless, SpotBugs, Error Prone and tests). Require PASS; if environment prevents Testcontainers/Docker, report the exact blocker and unrun tests.
- [ ] **Step 5 CLIENT VERIFY:** `cd client && npm run verify`; then `cd client && npm run test:e2e`. Require PASS or report exact environment blockers. Also run full Task Tag regression tests.
- [ ] **Step 6 REVIEW:** Compare all #72 acceptance criteria and approved spec D1–D13 + three clarifications; verify #89 is separate, Epic #8 remains under review, Task behavior unchanged, and no accidental `docs/ai/` edits. Ensure no missing owner-safe 400 vs Note 404 tests or callback staleness.
- [ ] **Step 7 COMMIT:** `git add client/e2e client/src server/src && git commit -m "test(notes): verify shared Tags across workspaces"` only if changes remain; otherwise record verification in final handoff. Provide exact test results, focused commit hashes, known risks and review link to owner. **Do not merge.**

---

## Self-check for Luna before declaring complete

- [ ] Input shapes, normalized/id-vs-name fingerprint and replay protected across POST, even on error/rollback.
- [ ] PATCH tag-only changed and no-op versions, timestamp behavior, concurrency and owner 400 tested against PostgreSQL.
- [ ] No tag-only Note/Tag write or new Note Tag resolver call before meaningful content.
- [ ] Every coordinator path (create/patch/conflict/400/uncertain/session recovery) includes Tags and does not lose later local changes.
- [ ] Task selector/Task Save/Cancel remain intact and Notes uses approved label/layout.
- [ ] Card/List Tag ordering and overflow agree with #68; no Tag filtering or media implementation slipped in.
- [ ] Full server and client verification executed or explicit blockers recorded.
- [ ] Work remains unmerged on feature/72-notes-shared-tags for owner review.

**Escalation rule:** If a material contract conflict appears, or satisfying shared normalization would require broader Tag API changes than the narrowly specified read-only adapter, stop and ask the owner; never silently rewrite the PRDs or widen the story. For scoped implementation details, follow established repository patterns and record deviations in the handoff.
