# PR #84 — Notes Core API Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Luna execution requirement:** Use **superpowers:executing-plans inline; do not dispatch subagents**. This document is a planning-only addition to the **existing PR #84 branch**. The author of this plan has not changed production code or executed the proposed tests.

**Goal:** Correct confirmed #69 Notes API validation and preview defects, strengthen misleading boundary tests, add a narrowly scoped request-body safety bound, and clean up small command/query/API contract deviations **without redesigning or expanding PR #84**.

**Architecture:** Preserve the existing Note-owned JPA aggregate, transactional idempotent creation, optimistic versioned PATCH, paginated owner-scoped collection queries and pure Java preview generation. Make targeted changes in `note/{domain,web,application}` and their tests. Keep the original #69 design/API contract and all other modules unchanged.

**Tech Stack:** Java 25, Spring Boot 4.0.6 / Spring MVC 7, Jackson 3, PostgreSQL 17, Hibernate/JPA, Spring Security, JUnit 5, AssertJ, MockMvc, Testcontainers, Maven + Spotless/SpotBugs/Error Prone/JaCoCo.

**Spec:** [PR #84](https://github.com/krishna916/horizon/pull/84), original [#69 Notes implementation plan](./2026-11-08-notes-core-api.md), [#68 approved Notes design](../../design/notes-workspace/DESIGN-SPEC.md), [issue #69](https://github.com/krishna916/horizon/issues/69), `server/AGENTS.md`, `.agents/skills/align-context/SKILL.md`, `docs/ai/INDEX.md` and ENG-001. CodeRabbit: [table colwidth](https://github.com/krishna916/horizon/pull/84#discussion_r4506538387), [vacuous preview byte-budget test](https://github.com/krishna916/horizon/pull/84#discussion_r4506538389), plus four nitpicks in its review. The human also requested the additional findings documented in the PR #84 architecture review.

## Global Constraints

- **Branch:** `feature/69-notes-core-api` (the existing PR #84 head). Do not create another feature branch, change `master`, merge or close PR #84, or edit other issues. Before editing, check whether PR head has moved beyond reviewed `c3cedd5cf594a693ef39f8ede2e15fb7116413d0`; revalidate findings if so.
- **No product redesign:** Retain the approved #69 contracts: title optional, <=255 normalized Java characters, content <=1,048,576 serialized UTF-8 JSON bytes, <=10,000 Tiptap document nodes, max nesting 32, strict safe schema; initial creation requires meaningful content; existing Notes may be cleared; POST requires canonical UUID idempotency key; PATCH requires expectedVersion, stale => 409, no-op preserves version/updatedAt.
- **Browsing unchanged:** Active/Archived, owner/deleted filtering, inbox-independent counts, zero-based pagination default page 0 / size 30 / cap 100, three sorts; preview first 520 text characters or six top-level blocks and max 16,384 serialized UTF-8 bytes; detail contains full content. Keep the present grapheme-safe truncation and avoid silently changing its count unit (currently a Java String/UTF-16-length budget). Record any desired future UX change separately.
- **Security:** Authentication, repository-level ownership, uniform missing/foreign/deleted 404 and RFC 9457 Problem Details must remain intact. No full Note body in list DTO; no direct images, uploads or Tags. No global servlet size limit that could break Tasks or other modules.
- **Scope:** Only note package and relevant Note tests; no schema change, no dependency addition, no Task module changes, no updates to authoritative PRDs/Constitution/ENG-001. Original Notes-only pagination exception remains valid.
- **Review evidence:** CodeRabbit flagged two inline issues and four nitpicks; SonarCloud reported 27 new issues despite a passing quality gate, 82.8% new-code coverage and 2.2% new-code duplication at the reviewed commit. Do not treat all tool suggestions as mandatory.
- **Method:** TDD regression tests before fixes; verify a test fails for the *intended* reason, not a different guard. For test-only coverage repairs, a previously correct production implementation may make the improved test pass immediately—report this rather than manufacture a RED. Use focused commits; run complete `./mvnw -Duser.timezone=UTC verify` at end. Do not claim validation passed unless commands ran successfully.
- **Progress reporting:** Resolve/reply to each of the two existing CodeRabbit inline threads with exact fix/test evidence after implementation, not now; classify nitpicks as applied or intentionally skipped with reasoning. In final PR comment include commit SHAs, checks, remaining risks, and no autonomous merge.

## Review Focus — add explicit tests

1. **Real Tiptap tables:** colwidth=0, 160 or other realistic pixel widths save; negative/fractional/excessive colwidth reject; colspan/rowspan remain 1..100 and test reaches the attribute check (Task 1).
2. **Exactly enforced limits:** newlines/tabs/JSON escapes, multi-byte and supplementary Unicode, near-1 MiB size, >10k *aggregate* nodes distributed across small arrays, nesting 32/33, and visible-vs-semantic title whitespace have independent assertions (Tasks 2–3).
3. **Meaningful byte-bounded previews:** large but valid first block yields a nonnull valid structured *prefix*, no later-content promotion, correct original order, <=520 character budget, <=6 blocks, <=16 KiB (Task 4).
4. **Early input safety:** a POST/PATCH body larger than the raw transport cap is rejected before Jackson deserializes it, even when content length is unknown; close-to-limit valid requests still flow into the existing 1-MiB semantic-document validator (Task 5).
5. **Contract stability:** controller PATCH uses command service directly; response detail excludes deletedAt; owner-safe 404/versioned 409/idempotent POST/no-op and list API continue to work (Task 6).

---

## Files and ownership map

Exact repository-relative files; only create new files when the small shared helper actually simplifies the current duplicated logic.

| File | Change |
|---|---|
| `server/src/main/java/com/krishnamurti/horizon/note/domain/NoteContentPolicy.java` | Fix table width policy, counting/UTF-8 accounting and structural budget definition |
| `server/src/main/java/com/krishnamurti/horizon/note/domain/Note.java` | Match title whitespace normalization to the established content policy |
| `server/src/main/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilder.java` | Enforce byte budget while building a valid meaningful document prefix |
| `server/src/main/java/com/krishnamurti/horizon/note/domain/NoteJsonSize.java` (**optional new**) | Note-local shared, allocation-light accurate serialized JSON size helper if it removes duplication |
| `server/src/main/java/com/krishnamurti/horizon/note/web/NoteRequestBodyLimitAdvice.java` (**new, or equivalently small Note-specific guard**) | Bounded raw Note POST/PATCH request body **before** deserialization |
| `server/src/main/java/com/krishnamurti/horizon/note/web/NoteExceptionHandler.java` | Return RFC 9457 413 for oversized Note raw bodies |
| `server/src/main/java/com/krishnamurti/horizon/note/web/NoteController.java` | Route PATCH directly to NoteCommandService; preserve 4 endpoints |
| `server/src/main/java/com/krishnamurti/horizon/note/application/NoteQueryService.java` | Remove write forwarding and command-service dependency |
| `server/src/main/java/com/krishnamurti/horizon/note/application/NoteCommandService.java` | Combine identical optimistic-lock catch clauses |
| `server/src/main/java/com/krishnamurti/horizon/note/web/NoteDetailResponse.java` and `NoteResponseMapper.java` | Remove unapproved deletedAt response field |
| `server/src/test/java/com/krishnamurti/horizon/note/domain/NoteContentPolicyTest.java` | Valid table/colspan, actual serialized-byte and aggregate-node tests |
| `server/src/test/java/com/krishnamurti/horizon/note/domain/NoteTest.java` | Unicode title normalization and 255-unit boundary |
| `server/src/test/java/com/krishnamurti/horizon/note/domain/NotePreviewBuilderTest.java` | Meaningful preview byte-budget and truncation tests |
| `server/src/test/java/com/krishnamurti/horizon/note/web/NoteControllerIntegrationTest.java` | HTTP request-size/413, DTO and security regressions |
| Other Note tests only if necessary | Targeted existing contracts, not broad rewrites |

## Task 1 — Accept legitimate Tiptap table widths, test the right guard

**Files:** Modify `NoteContentPolicy.java`, `NoteContentPolicyTest.java`.

**Interfaces:** Keep `NoteContentPolicy.validateAndCopy(Map<String,Object>): Map<String,Object>`. `colspan` / `rowspan` stay positive integers <=100; `colwidth` is a nullable list of integral pixel widths each **0..10_000**, separate from span validation. Reject negatives, decimals and >10_000. Do not allow unapproved attrs.

- [ ] **Step 1 — RED tests:** Build valid `doc > table > tableRow > tableCell > paragraph` fixtures with `attrs.colwidth: [0,160]` and an ordinary single-cell `[160]`; assert normalized JSON returned unchanged. Include width 10_000 accepted, -1, 10_001 and 1.5 rejected, and `colspan:101` in a *validly nested* table cell rejected specifically with the span error.
- [ ] **Step 2 — Run RED:** from `server/`, `./mvnw -Duser.timezone=UTC -Dtest=NoteContentPolicyTest test`. Expect current 160/0 acceptance tests to FAIL with `table column width is invalid`; inspect span test separately so it reaches the intended validation.
- [ ] **Step 3 — Minimal fix:** In `NoteContentPolicy.validateCellAttrs` use a separate bounded nonnegative-integer predicate for `colwidth`; do not weaken the existing span predicate. Check integer equality/range without accepting overflow or fractional numbers. Preserve existing null/array and error formats.
- [ ] **Step 4 — GREEN:** rerun same test class; confirm all intended table boundaries. Commit: `git commit -m "fix(notes): allow realistic table column widths"` with only domain validator and its tests.

## Task 2 — Correct serialized-byte accounting and enforce true structural-node limits

**Files:** Modify `NoteContentPolicy.java`, `NotePreviewBuilder.java` only if sharing size helper; `NoteContentPolicyTest.java`; optionally create `NoteJsonSize.java`.

**Interfaces:** `validateAndCopy` still validates <=1,048,576 bytes and <=10,000 document nodes plus depth <=32. Byte count must agree with actual JSON serialization for supported values. Count Tiptap nodes, **not Tiptap mark objects**; retain a separate finite mark guard (at most 10,000 marks total) and the existing bounded generic JSON-value complexity guard. Include the root `doc` node in the document-node budget and document that choice in a short code comment.

- [ ] **Step 1 — RED byte tests:** Cross-check bytes measured by the production size logic against `tools.jackson.databind.ObjectMapper` serialized UTF-8 output (not only older Jackson 2), using `\\n`, `\\t`, `\\b`, `\\f`, `\\r`, quotes, backslashes, other U+0000–U+001F, ASCII, é, emoji/supplementary code points, long mixed strings, and JSON *property keys*. Construct a semantically meaningful document near the 1 MiB boundary whose raw JSON includes many short escapes; assert it is accepted exactly at <=1 MiB and rejected above. Preserve previously passing ASCII boundary tests.
- [ ] **Step 2 — Structural tests that hit intended guards:** Replace the 10,001-element single array with numerous valid paragraphs, each having a small array of valid inline children, so **total nodes exceed 10,000 while every individual array is <10,000** and serialized bytes <1 MiB. Assert the specific node-count error; test one exact-boundary accepted fixture. Include a text node with many valid marks so marks do not falsely consume the document-node budget, while the independent mark guard still rejects pathologically many marks. Keep depth 32 accepted/33 rejected and assert the depth error.
- [ ] **Step 3 — Run RED:** `./mvnw -Duser.timezone=UTC -Dtest=NoteContentPolicyTest,NotePreviewBuilderTest test`. Expect short-escape boundary discrepancy and mark-count semantics to fail; if new aggregate-node test already passes, record that it now actually guards the intended invariant.
- [ ] **Step 4 — Minimal fix:** Replace per-code-point temporary `new String(Character.toChars(cp)).getBytes(...)` allocations with correct arithmetic for JSON escaping and UTF-8 width, OR use a bounded Jackson 3 streaming-counting helper if the arithmetic cannot match configured production serialization reliably. Account for Jackson short-escaped controls as 2 bytes, other C0 controls as 6, normal Unicode as its correct UTF-8 length, and ensure malformed surrogate input is deterministic. Unify duplicated Note-policy and preview measurement if it avoids two diverging calculations; keep helper *Note-local*, not in shared or Task domain. Stop counting as soon as applicable cap is exceeded. Enforce the literal node budget independently of marks and generic JSON input-size protection.
- [ ] **Step 5 — GREEN:** rerun focused tests and inspect near-limit memory/runtime behavior. Commit: `git commit -m "fix(notes): measure JSON bytes and structural limits accurately"` with changed Note validator/helper and tests.

## Task 3 — Normalize visually empty Unicode titles consistently

**Files:** Modify `Note.java`, `NoteTest.java`; add a focused HTTP test in `NoteControllerIntegrationTest.java` if useful.

**Interfaces:** `Note.create` / `updateTitle` retain optional title, max 255 normalized Java `String.length()`, and inner text/case. Match the code-point whitespace predicate already used by Note content: `Character.isWhitespace(cp) || Character.isSpaceChar(cp)`. Trim only leading/trailing whitespace; do not normalize or rewrite internal content and do not introduce Unicode NFKC transformation.

- [ ] **Step 1 — RED tests:** Title `"\u00a0\u00a0"` (NBSP only) or Unicode space-only returns null; initial create with only such a title and no meaningful content rejects; `"\u00a0Research\u00a0"` saves "Research"; legitimate embedded NBSP remains embedded; 255 normalized UTF-16 units accepted, 256 rejected; existing Note clearing uses null and preserves identity. Include version/no-op assertion on a PATCH that only changes an already-normalized title to an equivalent padded form.
- [ ] **Step 2 — Run RED:** `./mvnw -Duser.timezone=UTC -Dtest=NoteTest,NoteCommandServiceIntegrationTest test`. Current `String.strip()` should fail NBSP tests.
- [ ] **Step 3 — Fix:** Replace the title's leading/trailing trim logic with a small codepoint-aware normalization (or a Note-local private helper), matching the existing content whitespace definition; avoid breaking inner spacing or null handling. Do not modify Task titles.
- [ ] **Step 4 — GREEN:** rerun targeted tests. Commit: `git commit -m "fix(notes): normalize Unicode title whitespace"`.

## Task 4 — Preserve meaningful, byte-bounded structured previews

**Files:** Modify `NotePreviewBuilder.java`, `NotePreviewBuilderTest.java`; reuse the exact Note JSON-size helper from Task 2 if created.

**Interfaces:** `NotePreviewBuilder.build(Map<String,Object>): Map<String,Object>` keeps original order and a **valid** Tiptap prefix within **6 top-level blocks, 520 existing Java UTF-16 text units without splitting graphemes, and 16 KiB serialized UTF-8**. No full body in list DTO, no image promotion. An oversized *truncatable* first block must produce a meaningful prefix instead of `null`; a structurally indivisible block may be omitted if it cannot be represented safely within budget.

- [ ] **Step 1 — RED tests:** Replace `enforcesSerializedByteBudgetAndHandlesEmptyContent`'s `hardBreak`-only fixture (which currently yields `null`) with a **valid, meaningful** document containing text and many breaks/marks nested in multiple blocks. Assert `preview != null`, smaller than source, `NoteContentPolicy.validateAndCopy(preview).equals(preview)`, serialized <=16,384 bytes, text <=520, blocks <=6, and correct earliest-prefix order. Add a first paragraph with one meaningful text node then thousands of hardBreak nodes (still under input 1 MiB/10k nodes); current builder must fail the requirement by dropping the entire block. Add a later unique text sentinel and assert it never appears ahead of the cutoff. Retain null/empty, nested list, emoji/grapheme and document-first ordering checks.
- [ ] **Step 2 — Run RED:** `./mvnw -Duser.timezone=UTC -Dtest=NotePreviewBuilderTest test`. The meaningful first-block test should fail on current `if (serializedSize(candidate)>MAX) break`.
- [ ] **Step 3 — Minimal fix:** Integrate remaining-byte budget **during recursive child copying**, not only after building a full candidate; preserve valid parent/child structure and partial text prefix as space allows. Drop only children that cannot fit, stopping at the earliest cutoff without scanning/promoting later content. Don't consume text budget for a discarded candidate; don't return invalid empty listItem/row/table descendants; do not render HTML, cache previews or introduce a new rich-text library. Keep a final serialized-size and `NoteContentPolicy` validity assertion as a defensive check.
- [ ] **Step 4 — GREEN:** focused preview test plus `NoteControllerIntegrationTest`; verify list still excludes full content while detail retains it. Commit: `git commit -m "fix(notes): retain meaningful previews under byte limits"`.

## Task 5 — Enforce Note raw-body limits before deserialization

**Files:** Create a small `note/web/NoteRequestBodyLimitAdvice.java` (or equally narrow MVC request-body guard), update `NoteExceptionHandler.java` and `NoteControllerIntegrationTest.java`. Add a Note-specific exception if needed; do not modify global security or Task handlers.

**Interfaces:** Apply **2 MiB (2,097,152 raw HTTP request bytes)** only to `POST /api/v1/notes` and `PATCH /api/v1/notes/{id}`. It is a pre-deserialization protective ceiling, not a replacement for the approved **1 MiB serialized rich-text JSON content** rule. Raw bytes >2 MiB return HTTP **413 Payload Too Large** in safe RFC 9457 Problem Details; semantically oversized but raw <=2 MiB still return the existing **400** validation error. Do not buffer the whole body merely to measure it, bypass limits for chunked/unknown lengths or impact unrelated endpoints.

- [ ] **Step 1 — RED HTTP tests:** Authenticated POST with header-reported >2 MiB gets 413; chunked/unknown Content-Length with body >2 MiB also gets 413 (actually exercise streaming); PATCH >2 MiB gets 413 with no stored changes; body just within raw cap still reaches normal input validation; a valid content document near 1 MiB with normal envelope succeeds; a serialized document >1 MiB but raw <2 MiB returns existing 400. Assert RFC 9457 status/title and no echo of body; an unrelated Task request still follows its prior behavior; unauthenticated Notes requests remain 401.
- [ ] **Step 2 — Run RED:** `./mvnw -Duser.timezone=UTC -Dtest=NoteControllerIntegrationTest test`; confirm the new 413 cases fail before the guard.
- [ ] **Step 3 — Implement:** Prefer Spring MVC `RequestBodyAdvice` scoped to Note create/PATCH bodies, wrapping the incoming stream with a byte-counting limited stream and checking Content-Length early; use the actual Spring Boot 4/Spring 7 API. Ensure Jackson/HTTP-message parsing errors from the limit are translated to a Note-specific 413 ProblemDetail (not default 400/500), including chunked requests. A small Note-scoped filter is an acceptable alternative if the MVC advice cannot reliably enforce both cases; document why. Ensure authentication flow and request-body processing order remain safe, and don't use multipart settings for JSON.
- [ ] **Step 4 — GREEN:** rerun HTTP tests; confirm memory behavior is bounded and all old integration tests pass. Commit: `git commit -m "fix(notes): reject oversized request bodies before parsing"`.

## Task 6 — Restore command/query boundaries and tidy API contract

**Files:** Modify `NoteController.java`, `NoteQueryService.java`, `NoteCommandService.java`, `NoteDetailResponse.java`, `NoteResponseMapper.java`; update `NoteControllerIntegrationTest.java` and affected Note tests.

**Interfaces:** `NoteController.update(Long,UpdateNoteRequest)` calls `NoteCommandService.update(Long,NotePatch)` directly. `NoteQueryService` keeps only `get` and `list`, with class-level read-only transaction; no command-service field or write override. `NoteDetailResponse` includes `id,title,content,version,inbox,archivedAt,createdAt,updatedAt` **without deletedAt** per #69 contract. Optimistic-lock race still maps to 409, no-op stays no-op.

- [ ] **Step 1 — Tests:** Add HTTP assertion that detail, create and PATCH response omit `deletedAt` while including approved lifecycle fields; ensure PATCH succeeds with current version, stale request => 409, foreign => 404; archived Note editable. Existing concurrent-update application test must still pass. Check all call sites before deleting delegation.
- [ ] **Step 2 — RED:** `./mvnw -Duser.timezone=UTC -Dtest=NoteControllerIntegrationTest,NoteCommandServiceIntegrationTest test`. Expect new DTO contract assertion to fail.
- [ ] **Step 3 — Minimal refactor:** Inject `NoteCommandService` into `NoteController` and update PATCH call; remove `NoteQueryService.update`/its command dependency; remove `deletedAt` from response record/mapper only (do **not** remove it from Note persistence/lifecycle rules). Merge the identical `ObjectOptimisticLockingFailureException` and `jakarta.persistence.OptimisticLockException` catch blocks into a multi-catch with unchanged mapping.
- [ ] **Step 4 — GREEN:** same focused tests; search all `NoteQueryService.update` and `deletedAt` DTO call sites, ensuring no breakage. Commit: `git commit -m "refactor(notes): restore command boundary and response contract"`.

## Task 7 — SonarCloud/CodeRabbit triage and full verification

**Files:** Prefer **no new production files** beyond Tasks 1–6. Add focused Note tests only if a real high-value issue is discovered.

**Interfaces:** No API changes; this task verifies prior scope and provides traceable PR feedback.

- [ ] **Step 1 — Review static findings:** Open [PR #84 SonarCloud issues](https://sonarcloud.io/project/issues?id=krishna916_horizon&pullRequest=84&issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true); classify the previously reported 27 new issues by severity/actual applicability. Fix confirmed security/correctness/meaningful maintainability defects **within Notes** with tests; explicitly report deferred style-only items or misleading findings. The CodeRabbit 80% docstring threshold is **not** a mandate to add boilerplate JavaDocs—document only algorithms or non-obvious invariants where helpful. Do not silence Error Prone/SpotBugs/Sonar checks broadly.
- [ ] **Step 2 — Review matrix:** Recheck both unresolved inline CodeRabbit threads (table width and preview test), four nitpicks (duplicate catches, Query→Command shortcut, string-size allocations, misleading validator tests), and architectural review points (Unicode title, request-body bound, node vs mark semantics, meaningful preview, extraneous deletedAt). Mark each **fixed / intentionally skipped with technical reason / deferred outside #69**.
- [ ] **Step 3 — Format and focus:** From `server/`, run `./mvnw spotless:apply` if necessary, then `./mvnw -Duser.timezone=UTC -Dtest=NoteContentPolicyTest,NotePreviewBuilderTest,NoteTest,NoteCommandServiceIntegrationTest,NoteControllerIntegrationTest,NoteCreationConcurrencyIntegrationTest test`. Require no test failures.
- [ ] **Step 4 — Full verification:** Run `cd server && ./mvnw -Duser.timezone=UTC verify` with Docker/Testcontainers available. Check Spotless, Error Prone, SpotBugs, JaCoCo/report and all tests. If Docker/unavailable environment blocks a check, report exact command/output and rely on verified CI only with clear attribution, not claims of local success.
- [ ] **Step 5 — PR delivery:** Push focused commits to `feature/69-notes-core-api`; verify GitHub Actions and SonarCloud results for the new head. Reply *in the original review threads* with the exact test/commit evidence and resolve when appropriate; post one concise summary comment on PR #84 listing each finding and outcome, CI proof, scope adherence, residual risks and request for human merge review. Do not merge or close PR #84 without explicit human action.

## Explicitly skipped or deferred

- No new preview column/materialized projection, cursor pagination, cached collection counts, independent document-size service, generic content engine, or database migration: not justified by this review.
- No new Note file/image/Tag features or lifecycle endpoints: #70–#73/#78/#79 still own those behaviors.
- No blanket changes to Task JSON validation or title normalization. Only Notes-specific semantics are being corrected.
- No mass JavaDocs to satisfy CodeRabbit's configurable 80% coverage threshold. Record it as **intentionally skipped** unless a concrete documentation gap materially affects maintainability.
- No speculative fixes to all 27 SonarCloud issues: inspect first; change only valid, current, in-scope findings.
- Do not loosen existing XSS/URL/attribute restrictions or optimistic-lock/owner authorization for the sake of making failing tests pass.

## Luna execution handoff

Read this plan and the original #69 plan on **PR #84's current head**, then implement **inline, task by task, no subagents**, with RED/GREEN tests and focused commits. Confirm any file changes since the review before editing. On completion report verifiable outcomes, all CodeRabbit resolutions and unaddressed issues, with links to commits and CI. **Human retains merge approval.**
