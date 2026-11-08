# Issue #69 — Notes Core API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.
>
> **Luna execution choice for this handoff:** Use **superpowers:executing-plans**, inline and sequentially. **Do not dispatch subagents.** Do not start until the human explicitly asks you to implement. The current commit is planning-only.

**Goal:** Provide a secure, owner-scoped, independent Note aggregate and PostgreSQL schema, with idempotent create, versioned partial update, detail read, and paginated, sorted collection reads with bounded rich-text previews and lifecycle counts.

**Architecture:** Add code only to the existing note module in the Spring Boot modular monolith. Use Flyway, JPA/Hibernate, a Note-owned JDBC idempotency receipt table, CurrentUserProvider, thin REST controller, application command/query services, domain validation and a pure Java preview builder. Enforce owner scope at repository/query level. The active Notes design intentionally overrides conflicting older PRD navigation/title rules; do not touch Task behavior.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Hibernate/JPA, Spring JDBC, Jackson 3, PostgreSQL 17 JSONB, Flyway, Spring Security/Session, JUnit 5, MockMvc, Mockito, Testcontainers, Maven Spotless/Error Prone/SpotBugs/JaCoCo.

**Spec / authority:** [Issue #69](https://github.com/krishna916/horizon/issues/69); approved [Notes design gate #68](https://github.com/krishna916/horizon/issues/68) and [DESIGN-SPEC.md](../../design/notes-workspace/DESIGN-SPEC.md); PRD-005 Notes and SPEC-001 Shared Concepts from product knowledge; repository AGENTS.md (where present), server/AGENTS.md, [.agents/skills/align-context/SKILL.md](../../../.agents/skills/align-context/SKILL.md), [docs/ai/INDEX.md](../../ai/INDEX.md) and ENG-001. The explicit human approval thread for #69 (2026-11-08) resolves the implementation decisions below.

## Global constraints

- **Plan-only branch:** feature/69-notes-core-api. Implement only after separate human go-ahead; use a dedicated worktree if appropriate. Never implement on master, merge, create a PR, or modify unrelated issues without approval.
- **Document precedence:** #68 accepted Notes-specific design and the #69 decisions in its issue handoff override conflicting Notes text in PRD-005, PRD-000, Constitution and older AI context. Keep Tasks unchanged. No unauthorized changes to authoritative documentation.
- **Pagination exception:** ENG-001 §Pagination says “No pagination in Horizon V1” and docs/ai/HORIZON_DECISION_SUMMARY.md says deferred. This plan records an **explicit user-approved Notes-only exception**, NOT a global standard change.
- **Scope boundary:** #69 backend only; #70 browse UI, #71 rich editor/autosave/conflict recovery, #72 Note–Tag persistence and staged-tag atomic create, #73 lifecycle command endpoints, #78 attachment-first uploads, #79 image-first/in-document fileId nodes. #75 storage decision gates file implementation. No Tag, File, Search, Capture or Inbox orchestration in #69.
- **Identity and facts:** Numeric BIGINT Note id, user_id, created_at, updated_at, inbox BOOLEAN, archived_at/deleted_at nullable TIMESTAMPTZ; no status enum, is_archived flag, task_key or generated “Untitled note”. Workspace create always inbox=false. Inbox is orthogonal: active listing does not exclude inbox=true.
- **Creation:** POST requires one meaningful title or supported rich-text content (non-whitespace text, intentional table or horizontalRule). Plain empty paragraphs, whitespace and formatting-only content do not create. File/image-only create extension belongs to #78/#79. Tag-only POST has no supported creation path in #69: unknown tags field rejected, no Note/Tag side effects.
- **Update:** An existing Note may be cleared completely. Missing title/content leaves it unchanged; explicit null clears; blank title/semantically empty document normalizes to null; content is whole-document replacement, not JSON Patch. A valid version-only no-op preserves updatedAt and version. Stale expectedVersion always conflicts, including no-op. Lifecycle, owner, id, timestamps and version are not editable.
- **Version control:** Required nonnegative integral expectedVersion in PATCH JSON; JPA @Version BIGINT with atomic concurrency guard; stale races return 409 Problem Details, no partial write. On actual changes version advances once and updatedAt changes; on normalized equality, neither advances. #71 must serialize/coalesce client writes and preserve unsaved edits on 409.
- **Creation retries:** Required canonical UUID Idempotency-Key header on all POSTs. Store owner-scoped (user_id, request_key) receipt, SHA-256 of normalized title + canonicalized JSON content; same owner/key/same normalized payload replays one Note; same key/different payload => 409; different owners may reuse keys. Same-key concurrently in-flight requests must converge without duplicates. For replay of a deleted/inaccessible Note, return safe conflict, never disclose it.
- **Content:** Optional trimmed title max 255 Java String characters, blank => null. JSONB Tiptap doc max 1,048,576 serialized UTF-8 bytes, max 10,000 document nodes and max nesting depth 32. Supported structures/marks/attrs follow the safe existing Task rich-text validator unless Note-specific changes are proven necessary; no raw HTML, unsafe URL, arbitrary embed, base64 blob or unknown node/attribute. Safe link schemes http/https/mailto. Input oversized => validation error, never truncated. Images are not yet valid Note content nodes in #69; #79 extends schema with stable authenticated fileId, never public URL.
- **Preview:** List returns a valid, sanitized structured Tiptap preview from the **start** in document order, stopping at the earlier of 520 text characters and six top-level blocks, and with additional 16 KiB UTF-8 serialized preview ceiling. Do not promote later content/images, generate HTML, or persist preview columns. Truncate at a valid text/grapheme/structure boundary; if a nested structure cannot fit without invalid Tiptap, omit that portion rather than returning malformed JSON. Detail returns full content. File images are future #79.
- **Pagination and sort:** GET /api/v1/notes?collection=active&page=0&size=30&sort=updated_desc. Zero-based page, default 0, default size 30, max size 100, invalid params => 400. Collections: active (archived_at null), archived (archived_at not null); both exclude deleted and always owner scoped. updated_desc => updated_at DESC,id DESC; updated_asc => updated_at ASC,id ASC; title_asc => null-last, case-insensitive title ASC, id ASC tie. All sorts happen in DB before pagination.
- **List envelope:** {items:[...],page:0,size:30,hasNext:false,counts:{active:0,archived:0}}. Counts cover all owned undeleted Notes regardless of selected collection, pagination, sort, Inbox. Summary fields: id,title,preview,version,inbox,archivedAt,createdAt,updatedAt. Detail fields: id,title,content,version,inbox,archivedAt,createdAt,updatedAt. Do not expose deleted Notes through ordinary endpoints, or add Tags/files DTO fields prematurely.
- **HTTP/security:** POST /api/v1/notes (201 Created + Location), GET /api/v1/notes/{id} (200), PATCH /api/v1/notes/{id} (200), GET /api/v1/notes (200). Auth required; unowned/nonexistent/deleted detail or update => indistinguishable 404; 400 for malformed input/parameters; 409 for idempotency/version conflicts; use RFC 9457 Problem Details and field-level validation errors. No client-supplied owner/id/inbox/status.
- **Technical conventions:** Note-specific domain and application types, no Note import of task internals. Follow Spring Boot 4 / Jackson 3 API actually present; no new dependencies or generic cross-module abstractions. Flyway owns schema, Hibernate validates. Prefer unambiguous, focused classes over new controllers per endpoint.
- **Execution:** TDD RED → GREEN → refactor, tests and focused commit for each task, no subagents. When code diverges materially from this plan, stop and escalate instead of silently changing approved product requirements.

## Review focus — failure modes requiring explicit tests

1. **Ambiguous or concurrent create:** same UUID and semantically equal normalized payload across requests creates exactly one record and replay returns its ID; same key changed body conflicts; receipts roll back with failed validation (Task 4).
2. **Two editors/save races:** two PATCHes based on the same version cannot both succeed; stale/no-op request does not overwrite, bump version or leak content; both can blank fields with a fresh version (Task 5).
3. **Ownership and hidden resources:** owner A cannot read, list, count or patch owner B's Notes; missing/foreign/deleted IDs produce same 404, including an archived owned Note remaining editable (Tasks 2, 5, 6, 7).
4. **Rich-text attacks and pathological input:** oversized UTF-8, too many nodes/depth, unknown image/raw HTML, unsafe href, malformed attributes, non-BMP text and empty-document semantics are rejected or normalized safely; no partial write (Tasks 3 and 7).
5. **Browse boundaries:** sort, case-insensitive title/null-last ties, archive/inbox/deletion filtering, page 0/last/empty/out-of-range and counts do not expose other owners; preview is valid JSON, <=16 KiB, respects first six blocks/520 characters and does not look ahead (Tasks 6–8).

---

## File ownership map

All paths are relative to repository root; prefix P = server/src/main/java/com/krishnamurti/horizon/note and T = server/src/test/java/com/krishnamurti/horizon/note. Expand paths literally when editing.

| Create/modify | Responsibility |
|---|---|
| server/src/main/resources/db/migration/V20261108200000__create_note_and_creation_request.sql (new) | note + note_creation_request schema, FKs, key/indexes |
| P/domain/Note.java (new) | Note aggregate, JPA @Version, normalization and mutation |
| P/domain/NoteContentPolicy.java (new) | Safe Tiptap schema, semantic-content detection, limits and defensive copy |
| P/domain/InvalidNoteException.java (new) | Domain validation error with field |
| P/domain/NotePreviewBuilder.java (new) | Pure bounded structured preview preserving document order |
| P/infrastructure/NoteRepository.java (new) | Owner-scoped detail, archive/deletion-aware selectors and counts |
| P/infrastructure/NoteCollectionRepository.java (new) | Fixed, whitelisted DB sort clauses, slice/page query |
| P/infrastructure/NoteCreationRequestRepository.java (new) | Transactional JDBC receipt claim/find/complete |
| P/infrastructure/NoteCreationReceipt.java (new) | Immutable request fingerprint and note id |
| P/application/NoteCommandService.java (new) | Transactional owner-safe create and PATCH |
| P/application/IdempotentNoteCreationService.java (new) | Atomic idempotent create orchestration |
| P/application/NoteCreationFingerprint.java (new) | SHA-256 canonical normalized creation request |
| P/application/NotePatch.java and FieldUpdate.java (new) | Presence-aware title/content updates with expected version |
| P/application/NoteQueryService.java (new) | Owner-scoped full detail and list orchestration |
| P/application/NoteCollection.java, NoteSort.java, NotePage.java, NoteCounts.java (new) | Typed query options, page result and collection counts |
| P/application/NoteNotFoundException.java, NoteCreationConflictException.java, NoteVersionConflictException.java (new) | Domain-specific safe application failures |
| P/web/NoteController.java (new) | Four routes, thin HTTP adapter |
| P/web/CreateNoteRequest.java, UpdateNoteRequest.java (new) | Raw request shapes preserving PATCH field presence |
| P/web/NoteRequestMapper.java, NoteRequestValidationException.java (new) | Validate request fields, headers, query parameters |
| P/web/NoteDetailResponse.java, NoteSummaryResponse.java, NoteListResponse.java, NoteCountsResponse.java, NoteResponseMapper.java (new) | Explicit external DTOs |
| P/web/NoteExceptionHandler.java (new) | Note-local Problem Details mapping |
| T/domain/NoteTest.java, NoteContentPolicyTest.java, NotePreviewBuilderTest.java (new) | Domain and preview behavior |
| T/infrastructure/NotePersistenceIntegrationTest.java, NoteCreationRequestRepositoryTest.java (new) | PostgreSQL migrations, owner filters and receipt persistence |
| T/application/IdempotentNoteCreationServiceTest.java, NoteCommandServiceIntegrationTest.java, NoteQueryServiceIntegrationTest.java (new) | Transactions, sorting/filtering, concurrent semantics |
| T/web/NoteControllerIntegrationTest.java, NoteCreationConcurrencyIntegrationTest.java (new) | Authenticated HTTP contract, real sessions and concurrent create |

If a helper can be folded into its owner without making it complex, that is fine; keep all externally observable names/DTO fields and tests fixed. No changes to Task code or unrelated folders.

## Task 1: Migration and Note persistence foundation

**Files:** Create migration above, P/domain/Note.java, P/infrastructure/NoteRepository.java; test T/infrastructure/NotePersistenceIntegrationTest.java.

**Interfaces:** Note.create(Long userId, String title, Map<String,Object> content): Note; NoteRepository.findByIdAndUserIdAndDeletedAtIsNull(Long,Long): Optional<Note>; NoteRepository.findByIdAndUserId(Long,Long): Optional<Note> (only for internal fixtures/future lifecycle, not ordinary detail). BaseEntity owns id/createdAt/updatedAt. Version is Long or primitive long mapped to BIGINT, JPA @Version.

- [ ] Step 1 — Write failing migration/persistence tests: Flyway builds note and note_creation_request under ddl-auto=validate; note id BIGINT identity, title nullable VARCHAR(255), content JSONB, inbox false, archived_at/deleted_at TIMESTAMPTZ nullable, version BIGINT not null, created/updated TIMESTAMPTZ, user_id FK; JSON round-trip; second owner cannot match first owner's id. Assert unique (user_id,request_key) and recommended index on (user_id,deleted_at,archived_at,updated_at DESC,id DESC).
- [ ] Step 2 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NotePersistenceIntegrationTest test. Expected failure before migration/entity exist.
- [ ] Step 3 — Add V20261108200000__create_note_and_creation_request.sql, preserving prior migrations; set default inbox FALSE, version 0, PK/FKs, create indexes. Add Note JPA @Entity, @Table(name="note"), @JdbcTypeCode(SqlTypes.JSON) on content and @Version; copy nested JSON defensively (use analogous Task pattern, no Task import). For now add owner-scoped finder methods, not generic unrestricted resource lookups.
- [ ] Step 4 — Run GREEN: same Maven test; verify stored JSONB, schema validation, and owner-bound retrieval.
- [ ] Step 5 — Commit: git add server/src/main/resources/db/migration server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): add owner-scoped Note schema and entity".

## Task 2: Note title and meaningful-create invariants

**Files:** P/domain/Note.java, P/domain/InvalidNoteException.java; T/domain/NoteTest.java.

**Interfaces:** Note.create(Long,String,Map<String,Object>) creates with inbox=false and all lifecycle timestamps null; Note.updateTitle(String): void; Note.updateContent(Map<String,Object>): void. NoteContentPolicy from Task 3 is referenced only after that task exists; for this task create minimal domain placeholder and finalize content semantics in Task 3, or execute Task 3 immediately before completing this task's RED/GREEN cycle.

- [ ] Step 1 — Write NoteTest: title-only and body-only creations accepted; null/blank/space-only title normalized null; null title + semantically empty body rejected on create; update may clear both; no synthetic title; title length 255 accepted / 256 rejected; inner spacing preserved; no status field; archived/trashed fixtures retain separate facts.
- [ ] Step 2 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteTest test; compile/test fails.
- [ ] Step 3 — Add InvalidNoteException(field,message), Note title policy and aggregate factory/update invariants. For body-related tests, implement using Task 3's NoteContentPolicy rather than a second validator; Task 2 and 3 may be treated as one atomic GREEN/commit unit if circular test dependency requires it. Preserve object identity after clearing content.
- [ ] Step 4 — Run GREEN: same test, plus NotePersistenceIntegrationTest; assert no blank/new record.
- [ ] Step 5 — Commit: git add server/src/main/java/com/krishnamurti/horizon/note/domain server/src/test/java/com/krishnamurti/horizon/note/domain && git commit -m "feat(notes): enforce optional title and meaningful creation".

## Task 3: Strict Note-rich-text schema validation

**Files:** P/domain/NoteContentPolicy.java, P/domain/Note.java; T/domain/NoteContentPolicyTest.java, T/domain/NoteTest.java.

**Interfaces:** NoteContentPolicy.validateAndCopy(Map<String,Object> content): Map<String,Object> (nullable; returns null for semantically empty); NoteContentPolicy.hasMeaningfulContent(Map<String,Object> normalized): boolean. Tiptap root must be {type:"doc",content:[...]} when nonnull.

- [ ] Step 1 — Write RED validator tests covering supported paragraph/heading(1–3)/bulletList/orderedList/listItem/codeBlock/blockquote/table/tableRow/tableCell/tableHeader/horizontalRule/text/hardBreak, and bold/italic/code/link marks; correct heading/table/link attr validation; http/https/mailto safe targets; reject javascript/data/blob href, embedded HTML, attrs not allowlisted, unsupported image nodes, base64 blobs, unknown node/mark keys, invalid nesting/shape, >10,000 nodes and >32 levels.
- [ ] Step 2 — Add semantic/size tests: null/empty paragraph, blank title and formatting-only => not meaningful; nonwhitespace text, empty table and horizontalRule => meaningful; UTF-8 JSON exactly <=1,048,576 bytes accepted if valid, > limit rejected; include multi-byte Unicode and defensive-copy mutation tests. An empty paragraph must not turn into persisted placeholder content.
- [ ] Step 3 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteContentPolicyTest,NoteTest test. Expected FAIL.
- [ ] Step 4 — Implement a Note-owned validator using the structural strategy from task/domain/TaskDescriptionValidator.java as a technical reference, not an import or domain dependency. Count size of actual serialized UTF-8 JSON (allowing for escaping), nodes, depth; avoid exponential recursion and stack exhaustion. Validate before copy/persistence; normalize semantically empty valid docs to null. Ensure empty table/horizontalRule are retained.
- [ ] Step 5 — Run GREEN: same focused command and NotePersistenceIntegrationTest. Commit: git add server/src/main/java/com/krishnamurti/horizon/note/domain server/src/test/java/com/krishnamurti/horizon/note/domain && git commit -m "feat(notes): validate and normalize rich-text documents".

## Task 4: Transactional idempotent Note creation

**Files:** P/infrastructure/NoteCreationRequestRepository.java, P/infrastructure/NoteCreationReceipt.java, P/application/NoteCreationFingerprint.java, P/application/IdempotentNoteCreationService.java, P/application/NoteCommandService.java, P/application/NoteCreationConflictException.java; T/infrastructure/NoteCreationRequestRepositoryTest.java, T/application/IdempotentNoteCreationServiceTest.java, T/web/NoteCreationConcurrencyIntegrationTest.java.

**Interfaces:** NoteCreationFingerprint.compute(String normalizedTitle, Map<String,Object> normalizedContent): String; NoteCreationRequestRepository.claim(Long,UUID,String): boolean; find(Long,UUID): Optional<NoteCreationReceipt>; complete(Long,UUID,Long): void. IdempotentNoteCreationService.create(UUID key,String title,Map<String,Object> content): Note. NoteCommandService.create(String,Map<String,Object>): Note, always resolves authenticated owner via CurrentUserProvider.

- [ ] Step 1 — Write RED tests: same UUID/same normalized content => one id/row; title with edge whitespace and reordered JSON map keys => identical fingerprint; actual content/style differences => different fingerprint; same key plus changed payload => conflict, different owners same key => independent records; invalid all-empty create rolls back receipt and Note; concurrent same-key requests exactly once; foreign/deleted replay cannot reveal Note.
- [ ] Step 2 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteCreationRequestRepositoryTest,IdempotentNoteCreationServiceTest,NoteCreationConcurrencyIntegrationTest test.
- [ ] Step 3 — Implement Note-owned SHA-256 canonicalizer (maps sorted recursively, arrays remain ordered, normalized title and body only) and JDBC claim/complete transaction using task/infrastructure/TaskCreationRequestRepository.java as technical reference. The insert/claim and Note insert must share a transaction; no extra counters or REQUIRES_NEW. On duplicate claim, read receipt and compare fingerprints; return existing owner-visible Note or throw NoteCreationConflictException. Use the same one-request snapshot on client retries; #71 must queue changed draft text until the first Note id arrives.
- [ ] Step 4 — Run GREEN with same tests plus NotePersistenceIntegrationTest. Exercise concurrency with separate transactions/sessions and bounded waits; no duplicate successful creates.
- [ ] Step 5 — Commit: git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): make creation idempotent per owner".

## Task 5: Owner-safe, optimistic versioned PATCH

**Files:** P/application/FieldUpdate.java, NotePatch.java, NoteVersionConflictException.java, NoteNotFoundException.java, NoteCommandService.java; P/domain/Note.java; T/application/NoteCommandServiceIntegrationTest.java.

**Interfaces:** record FieldUpdate<T>(boolean present,T value), static absent()/of(T); record NotePatch(long expectedVersion,FieldUpdate<String> title,FieldUpdate<Map<String,Object>> content); NoteCommandService.update(Long noteId, NotePatch patch): Note. @Version provides atomic DB update; explicit expected version compare precedes no-op equality check.

- [ ] Step 1 — Write RED tests: missing title/content preserve fields; explicit null/blank title clears it; null/empty document clears content; both cleared together allowed; real change increments @Version and updatedAt; normalized-equal change or expectedVersion-only no-op does not; stale version returns conflict even if payload would be no-op; simultaneous updates against same version yield one winner and 409 loser; no partial mutation; missing/foreign/deleted IDs all return owner-safe not found; archived owned note editable.
- [ ] Step 2 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteCommandServiceIntegrationTest test.
- [ ] Step 3 — Implement presence-aware patch, transactional findByIdAndUserIdAndDeletedAtIsNull, checked expected version, domain normalization, change detection and flush. Translate JPA optimistic-lock exceptions caused by genuine races into NoteVersionConflictException; do not globally modify Task handlers or swallow unrelated failures. Keep archivedAt/deletedAt/inbox independent; never mutate them during editing.
- [ ] Step 4 — Run GREEN with same command; repeat concurrency test to confirm no lost update. Commit: git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): enforce optimistic PATCH and no-op semantics".

## Task 6: Owner-scoped paginated/sorted collection and counts

**Files:** P/application/NoteCollection.java, NoteSort.java, NotePage.java, NoteCounts.java, NoteQueryService.java; P/infrastructure/NoteRepository.java, NoteCollectionRepository.java; T/application/NoteQueryServiceIntegrationTest.java.

**Interfaces:** enum NoteCollection { ACTIVE, ARCHIVED }; enum NoteSort { UPDATED_DESC, UPDATED_ASC, TITLE_ASC }; NoteQueryService.get(Long noteId): Note; NoteQueryService.list(NoteCollection collection,NoteSort sort,int page,int size): NotePage; record NotePage(List<Note> items,int page,int size,boolean hasNext,NoteCounts counts); record NoteCounts(long active,long archived). Owner ID is resolved inside service, never accepted from HTTP clients.

- [ ] Step 1 — Write RED integration tests with mixed owners, archived, deleted, inbox=true and title=null; only owner and undeleted rows appear; inbox=true counted in Active; page size 2 across multiple pages has no overlaps/missing results with stable ties; empty/out-of-range page has items empty but accurate counts; archived page excludes active; title_asc casefold and null-last, stable id tie; updated_asc/updated_desc with id tie; counts independent of page/sort/collection.
- [ ] Step 2 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteQueryServiceIntegrationTest test.
- [ ] Step 3 — Implement explicit whitelisted query paths for the three sorts, filtering owner id and deleted_at at DB level before offset/limit (fetch size+1 to compute hasNext). For title sorting use fixed CASE WHEN title IS NULL THEN 1 ELSE 0 END, LOWER(title), id; do not concatenate untrusted SQL sort strings. For timestamp sorts use id as specified. Query two owner-scoped counts or one aggregate. Use index from Task 1; do not introduce cached counters or separate materialized views. Reject out-of-range params at the HTTP mapper.
- [ ] Step 4 — Run GREEN and assert no full-collection fetch; document offset pagination drift under edits as accepted V1 behavior. Commit: git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): add scoped page queries and collection counts".

## Task 7: Safe, bounded document-first preview

**Files:** P/domain/NotePreviewBuilder.java; T/domain/NotePreviewBuilderTest.java; add any query integration preview assertions to T/application/NoteQueryServiceIntegrationTest.java.

**Interfaces:** NotePreviewBuilder.build(Map<String,Object> validatedContent): Map<String,Object> (null if no content). Budget: min(first 520 text characters, first 6 top-level blocks, 16,384 serialized UTF-8 bytes). Do not persist result. For #69 only, accepted nodes are text-rich; #79 later adds fileId image references/authorization.

- [ ] Step 1 — Write RED tests: first six blocks retained/seventh excluded; >520 text characters truncates at valid grapheme boundary; nested marks/links remain safe; short document unchanged; text-only, code, nested list, quote and table output conforms to NoteContentPolicy; huge single node/table and multi-byte emoji cannot exceed 16 KiB or yield malformed JSON; empty or null produces null; no look-ahead when later blocks contain content; original order preserved.
- [ ] Step 2 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NotePreviewBuilderTest test.
- [ ] Step 3 — Implement a pure Java prefix copier that tracks block/character/byte budgets, preserves structural validity, and chooses a safe truncation boundary when a nested table/list cannot be partially represented. Do not render HTML, search for images, or use Task's validator directly; check preview with the Note schema after truncation. The approved 440 px card max is frontend-only.
- [ ] Step 4 — Run GREEN with NotePreviewBuilderTest and NoteQueryServiceIntegrationTest; assert list only returns bounded preview and detail full content, and that no preview column exists. Commit: git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): build bounded structured document previews".

## Task 8: HTTP DTOs, validation, Problem Details and end-to-end security

**Files:** P/web/NoteController.java, CreateNoteRequest.java, UpdateNoteRequest.java, NoteRequestMapper.java, NoteRequestValidationException.java, NoteDetailResponse.java, NoteSummaryResponse.java, NoteListResponse.java, NoteCountsResponse.java, NoteResponseMapper.java, NoteExceptionHandler.java; T/web/NoteControllerIntegrationTest.java, T/web/NoteCreationConcurrencyIntegrationTest.java.

**Interfaces:**
- POST /api/v1/notes: required Idempotency-Key canonical UUID, JSON fields title?: string|null and content?: Tiptap|null, no other fields; 201 Created Location /api/v1/notes/{id}, NoteDetailResponse.
- GET /api/v1/notes/{id}: NoteDetailResponse, full content.
- PATCH /api/v1/notes/{id}: JSON required expectedVersion: nonnegative integer, optional title/content only; NoteDetailResponse with new/current version; version-only no-op allowed.
- GET /api/v1/notes?collection=active|archived&page=0&size=30&sort=updated_desc|updated_asc|title_asc: NoteListResponse with items, page, size, hasNext, counts. Defaults page 0,size 30, max 100, active, updated_desc.
- NoteDetailResponse and NoteSummaryResponse fields are specified in Global Constraints; only Summary exposes preview, only Detail exposes full content. NoteCountsResponse(active, archived).

- [ ] Step 1 — Write RED MockMvc/Testcontainers tests for four endpoints with real registered sessions: unauthenticated 401; creator gets 201+Location with null optional title, inbox=false and initial version; missing/invalid/noncanonical UUID => 400; duplicate same key => one Note and same ID; conflicting same key => 409; invalid payload (unknown tags/owner/id/inbox/status, malformed content, no meaningful content) => 400 Problem Details; foreign/deleted/missing GET/PATCH => same 404; archived GET/PATCH succeeds; malformed expectedVersion/no-op/stale version rules and 400/409; missing/invalid page,size,sort,collection handling; exact list envelope/counts/preview bounds; response never contains other owners' IDs.
- [ ] Step 2 — Run RED: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteControllerIntegrationTest,NoteCreationConcurrencyIntegrationTest test.
- [ ] Step 3 — Implement one NoteController with four endpoints. Use request mapper or delegating Jackson JsonNode object to distinguish omitted/null PATCH fields; reject unknown/mutable lifecycle keys, and use bean validation or equivalent explicit field errors. Map Note-specific failures in @RestControllerAdvice to consistent RFC 9457 ProblemDetail (400,404,409). On malformed oversized request, handle safely without echoing content; never leak owner presence.
- [ ] Step 4 — Run GREEN with focused tests plus all Note*Tests. Verify JSON field names are exactly title,content,preview,version,expectedVersion,counts,page,size,hasNext and lifecycle timestamps; no Task behavior changed.
- [ ] Step 5 — Commit: git add server/src/main/java/com/krishnamurti/horizon/note server/src/test/java/com/krishnamurti/horizon/note && git commit -m "feat(notes): expose secure versioned Note CRUD API".

## Task 9: Browse performance, cross-feature contract tests and final verification

**Files:** Extend T/application/NoteQueryServiceIntegrationTest.java, T/web/NoteControllerIntegrationTest.java, T/domain/NotePreviewBuilderTest.java; add T/application/NoteBrowsePerformanceTest.java if focused tests would become unwieldy. Do not edit authoritative docs as part of #69.

**Interfaces:** No new production API. Verify page size 30, cap 100, preview <=16 KiB and stable HTTP DTO shape under realistic test data.

- [ ] Step 1 — Write RED/regression tests with a page of 30 rich Notes whose JSONB documents are substantial (e.g. 128–512 KiB each), and a collection >100 entries; assert only page-size bounded DTO rows, no complete document in list JSON, valid preview on each, counts correct, hasNext correct; user isolation, archive/deleted exclusions. For performance, assert structural bounds/queries/payload rather than flaky wall-clock timings. Capture optional manual benchmark observations without treating one timing as a CI threshold.
- [ ] Step 2 — Run focused tests: cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteBrowsePerformanceTest,NoteQueryServiceIntegrationTest,NoteControllerIntegrationTest test (omit NoteBrowsePerformanceTest from selector if folded into existing tests). Expected GREEN after adding coverage; investigate any failure before committing.
- [ ] Step 3 — Run formatter (if needed): cd server && ./mvnw spotless:apply; then ./mvnw -Duser.timezone=UTC verify with Docker/Testcontainers available. Must pass Spotless, Error Prone, SpotBugs, JaCoCo checks and all tests. If Docker unavailable or full CI cannot run, report exact blocked check, don't claim green.
- [ ] Step 4 — Review files against approved #69 scope, security/nonleak invariants, user decisions and #68 design; no new Tag/File/archive routes, no task imports, no surprise UI or new dependencies. Double-check Flyway order, JPA schema validate, OpenAPI/Problem Details compatibility and deterministic sorting. Add only tests/fixes needed to meet plan.
- [ ] Step 5 — Commit test/verification changes: git add server/src/test/java/com/krishnamurti/horizon/note && git commit -m "test(notes): cover large-page previews and API invariants". Show human concise verification outcomes and commit references. **Do not auto-merge**.

## Downstream contracts and deferred requirements (document; do not implement here)

- **#70:** Use list.items/preview/page/size/hasNext/counts and server-side collection/sort; cards are row-major and max 440 px, list is compact; no Notes side panel; untitled display fallback only. Keep Note-rich content out of browser list response beyond structured preview.
- **#71:** POST once with stable UUID/idempotency payload snapshot; queue newer edits until Note id exists; PATCH with expectedVersion; serialize/merge frontend saves and preserve unsaved drafts on 409 or failed requests. The existing #71 Tag acceptance text anticipates a later #72 enhancement.
- **#72:** Own Note–Tag table, shared tag.api integration, staged tags and atomic creation/assignment. Extend create DTO and fingerprint with normalized tag selections in the same owner transaction; do not permit tag-only draft persistence. Do not make #69 partially implement tags.
- **#73:** Own archive/restore/soft-delete command routes; existing collection flags, counts and @Version must remain coherent; preserve original archived_at on Trash restoration. Archive remains editable. Verify version/concurrency rules when adding lifecycle mutations.
- **#78/#79:** Add intentional first-file/first-image Note persistence, then authenticated upload. May extend POST to support the approved upload-intent flow; define failed-upload cleanup policy there, not in #69. #79 adds allowed fileId-based image nodes and in-position image rendering; no public URLs or base64. #75 storage ADR gate remains separate.
- **Docs reconciliation:** PRD-005 FR-003 title-required, FR-017/018 panel-first, archived collapsed, rich media deferred conflict with #68; Notes-only accepted overrides take precedence. ENG-001 and docs/ai/HORIZON_DECISION_SUMMARY.md defer pagination; this issue is a specifically approved Notes exception. Flag proposed authoritative doc changes for human review; do not edit them.
- **No runtime verification by plan author:** This plan is source review + human decisions only. Luna must run each RED/GREEN test and the full verify command during implementation and report real results.

## Luna handoff / readiness check

1. Read this entire plan, linked #68 DESIGN-SPEC, #69 issue body, docs/ai/INDEX.md and ENG-001. Confirm you are on feature/69-notes-core-api (or a worktree attached to it); do not reset unrelated work.
2. Use superpowers:executing-plans **inline**, not subagents. Implement tasks in order; RED test, minimal GREEN implementation, verification, focused commit per task. Treat approval decisions and specified DTO names as contracts.
3. Before implementation, review any material drift since plan commit; if a product decision or cross-issue boundary is ambiguous, escalate to the human instead of inventing requirements.
4. At completion, report test commands/results, commits, risks and remaining work for #70–#73/#78/#79. Do not implement deferred features, modify other issues, or merge autonomously.
