# PR #90 — Notes Shared Tags Review Remediation Implementation Plan

> **For Luna:** REQUIRED SUB-SKILL: `superpowers:executing-plans`, **inline/native only — NO SUBAGENTS**. Execute tasks in order with RED → GREEN → REFACTOR tests and small focused commits. This is a targeted review-fix plan, **not** an authorization to merge PR #90.

**Goal:** Resolve verified correctness, backwards-compatibility, UI-validation and canonical-Tag-display defects in [PR #90](https://github.com/krishna916/horizon/pull/90), strengthen a few weak tests and address worthwhile CodeRabbit static-analysis findings without expanding issue #72.

**Architecture:** Retain the existing modular monolith and owner-scoped `tag.api` contracts. Preserve the frozen POST/idempotency identity while reconciling acknowledged Note Tag selections against canonical server data; feed canonical Tag metadata into the existing selector through the existing Note editor/coordinator. Keep the implementation minimal and retain Task behavior.

**Tech Stack:** Java 25, Spring Boot 4.0.6, PostgreSQL/Testcontainers, JUnit/MockMvc; React 19, TypeScript, TanStack Query/Router, Vitest/Testing Library, Playwright.

**Spec:** [#72 approved design](../specs/2026-11-11-notes-shared-tags-design.md), [#72 original execution plan](./2026-11-11-notes-shared-tags.md), [#68 Notes design](../../design/notes-workspace/DESIGN-SPEC.md), and [PR #90](https://github.com/krishna916/horizon/pull/90). This remediation plan is based on review of PR HEAD `92c330cd4695485b24b5248bb9022d22a30b4286` (2026-11-11); recheck HEAD and each finding before editing.

## Global constraints

- **No new product behavior:** Retain approved #72 D1–D13 and three clarifications, particularly whole-draft Keep/Load conflicts, POST id/name *request form* distinction, first-create frozen body/key, full Tag-set PATCH, owner-safe generic `400 errors.tags`, and explicit manual Retry on definitive 400. No Tag filtering (#89), Tag management, new endpoints, additional storage, or unrelated Task changes.
- **Scope:** Work only on PR branch `feature/72-notes-shared-tags`. Fix confirmed issues and targeted test weaknesses. If current code already fixes a finding, document evidence and skip; don't implement reviewer suggestions blindly.
- **Transaction boundary:** Keep public transactional service entry points and transactional receipt+Note+Tag atomicity. Do not mistake Spring proxy self-invocation lint for a current transaction failure; refactor with tests and no behavior change.
- **Client correctness:** Canonical server Tags are `{id, name}`; draft Tag refs can be `{id}` or `{name}`. Distinguish *request* identity used in idempotency from *effective persisted Tag* equality used in autosave recovery. Never silently overwrite local edits made during a request.
- **Privacy:** A missing/foreign Tag ID stays an indistinguishable `400` with a generic `errors.tags` detail. Never reveal Tag owner/existence to the client.
- **Local guidance:** Read root `Agents.md`, `docs/ai/INDEX.md` and relevant linked `ENG-001`/`ENG-002` and module AGENTS. Use `.agents/skills/align-context`, `testing-spring-integration`, `testing-frontend`; no IDE-only requirement or generated router edits. On Maven/Testcontainers use `-Duser.timezone=UTC`.
- **Evidence:** For every task: write failing tests first, run them to confirm failure for the expected reason, implement the smallest fix, rerun relevant tests, commit, and report the exact result. Do not merge, resolve CodeRabbit threads, or post fixes on GitHub without owner review.
- **Do not refactor adjacent systems:** Avoid broad extraction of Tag repositories, new generic equality frameworks, new API routes, speculative version migrations, or test-only production flags.

## Files and ownership

| Files | Responsibilities |
| --- | --- |
| `server/src/main/java/com/krishnamurti/horizon/note/application/{NoteCreationFingerprint,IdempotentNoteCreationService,NoteCommandService}.java` | Old/new creation receipt compatibility and small transaction-delegation cleanup |
| `server/src/test/java/com/krishnamurti/horizon/note/application/{NoteCreationFingerprintTest,IdempotentNoteCreationServiceTest}.java`, `server/src/test/java/com/krishnamurti/horizon/note/web/NoteControllerIntegrationTest.java` | Historical fingerprint fixture, persisted receipt replay, conflict/ownership regression |
| `client/src/note/{noteDraft,NoteSaveCoordinator,useNoteAutosave}.ts` | Canonical acknowledged Tag matching, in-memory recovery, conflict/uncertain result handling, field validation error state |
| `client/src/note/{NoteEditorPage.tsx,NoteSaveCoordinator.test.ts,noteDraft.test.ts,useNoteAutosave.test.tsx,NoteEditorPage.test.tsx}` | Canonical Tag metadata for selector, UI error, unchanged local draft, test assertions |
| `client/src/tag/TagSelector.tsx`, `client/src/tag/TagSelector.test.tsx` | Only if a narrowly scoped selector prop/logic is actually needed; don't change Tasks |
| `client/e2e/notes-tags.spec.ts` | Focused browser regression for error handling and updated/canonical Tag display |
| `server/src/main/java/com/krishnamurti/horizon/note/web/NoteRequestMapper.java`, `note/application/NoteCreationResult.java` | Bounded static analysis/record accessor cleanup |
| `server/src/test/java/com/krishnamurti/horizon/note/application/NoteTagAssignmentServiceIntegrationTest.java`, `server/src/test/java/com/krishnamurti/horizon/tag/application/TagNormalizationServiceTest.java`, `client/src/note/api.test.ts` | Stronger test assertions |

## Review focus — failure scenarios that must be tested

1. **Lost PATCH response with a name-selected new Tag:** GET returns the successful write with `{id,name}`. No spurious 409, second PATCH or discarded local edit; server version becomes baseline.
2. **Existing pre-#72 creation receipt:** retry a tag-free creation under the same old UUID/body and receive existing Note rather than 409. Changed title/content or any supplied Tags with old UUID still conflicts.
3. **Tag changes after request dispatch:** canonical server acknowledgement may update *confirmed* baseline/known names, but newer selections in the live draft survive and produce exactly one later versioned PATCH if effectively different.
4. **Definitive `400 errors.tags`:** editor shows a useful Tag-specific message, keeps title/body/Tags, stops automatic retries, and only submits corrected draft on explicit Retry. Other validation failures must not be mislabeled as Tag errors.
5. **Load latest / same-user recovery after a new Tag appears remotely:** Tags show canonical names, not fallback `Tag #<id>`; no owner-scoped cache leakage or auto-merge.

---

### Task 1 — Preserve pre-#72 tag-free idempotency receipts (blocking)

**CodeRabbit:** [Major fingerprint finding](https://github.com/krishna916/horizon/pull/90#discussion_r4533960868).

**Files:** Modify `server/src/main/java/com/krishnamurti/horizon/note/application/NoteCreationFingerprint.java`, `IdempotentNoteCreationService.java`; test `server/src/test/java/com/krishnamurti/horizon/note/application/NoteCreationFingerprintTest.java` and `server/src/test/java/com/krishnamurti/horizon/note/web/NoteControllerIntegrationTest.java`.

**Contract:** Preserve current V2 fingerprint (includes normalized Tag refs) for new requests; on replay, allow **only tag-free** requests to match either V2 hash or historical V1 title/content-only hash. Old receipt comparison is permitted only with `tags.isEmpty()` *after* request normalization. Old historical hash must use the exact pre-#72 canonicalization behavior, not a newly invented approximation. No Tag write/resolution on replay. Same key + changed content or any Tag still 409. Do not rewrite historical rows or introduce data migration.

- [ ] **1. Write RED tests:** Seed a receipt carrying a genuine pre-#72 hash fixture calculated with prior title/content-only serialization (and linked Note ID); issue a tag-free request with the same UUID/body and assert same Note and no mutation. Repeat with explicit `tags: []` (same effective request). A changed title/content or `{name: ...}`/`{id: ...}` with the old UUID returns 409; new V2 tag-free receipts continue replaying.
- [ ] **2. Run RED:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteCreationFingerprintTest,NoteControllerIntegrationTest test`. Confirm the old receipt currently returns 409 for the expected reason.
- [ ] **3. Minimal fix:** Add a narrow legacy-hash helper (e.g. `NoteCreationFingerprint.computeLegacyTagFree(String, Map<String,Object>)`) sharing existing canonicalization, and use it only as a **read-time fallback** when a persisted receipt fails V2 comparison for empty Tag refs. Do not change how newer V2 receipts are claimed. Ensure receipt.noteId is checked as before.
- [ ] **4. Run GREEN:** Same targeted tests and existing `IdempotentNoteCreationServiceTest` / `NoteCreationConcurrencyIntegrationTest`, checking rollback and Tag canonicalization; require all PASS.
- [ ] **5. Commit:** `git commit -m "fix(notes): retain legacy tag-free idempotency replay"` with only affected files.

### Task 2 — Canonicalize acknowledged Tag identity in the Note save coordinator (blocking)

**CodeRabbit:** [Major lost-response finding](https://github.com/krishna916/horizon/pull/90#discussion_r4533960861).

**Files:** Modify `client/src/note/noteDraft.ts`, `NoteSaveCoordinator.ts`, optionally a small dedicated Tag-comparison helper inside `client/src/note/`; test `client/src/note/NoteSaveCoordinator.test.ts`, `noteDraft.test.ts`, and `useNoteAutosave.test.tsx`.

**Contract:** The frozen POST payload **must remain unchanged** for retries, including distinction between name and ID request forms. Only *after verified server acknowledgement* should effective draft comparisons recognize selected `{name:"Planning"}` as the same **persisted** Tag as returned `{id:42,name:"Planning"}`. Distinguish normalization for effective server Tag equality from request/fingerprint equality; use canonical `NoteDetail.tags` and shared case/edge-whitespace rules, not a naive string representation comparison. Do not treat unknown or ambiguous names as equal. No silent overwriting of newer local edits. Whole-draft conflict Keep/Load remains explicit.

- [ ] **1. Write RED test:** New persisted Note baseline has empty Tags. Local PATCH sends `tags:[{name:"Planning"}]`; `update` rejects with timeout, `get` returns one-version-newer Note with `tags:[{id:42,name:"Planning"}]`. Assert `saved` phase, version advanced, no false conflict and no duplicate PATCH.
- [ ] **2. Write RED tests:** Repeat after a same-owner recovery snapshot carrying a frozen PATCH; test a successful POST with a staged name, its canonical response, and no redundant PATCH; test later edits while POST/PATCH is in flight and verify the latest local selection survives with serialized next PATCH. Test `resolveConflict('keep-local')` with matching canonical IDs/names (no needless overwrite) and with genuinely different Tags (still requires approved overwrite).
- [ ] **3. Run RED:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/noteDraft.test.ts src/note/useNoteAutosave.test.tsx`.
- [ ] **4. Minimal fix:** Introduce/use a single **server-aware effective Tag-set comparison/canonicalization** for reconciliations and acknowledgements. Update `reconcileFailedUpdate`, `refreshPersistedVersion`, create/update acknowledgements, recovery and Keep/Load handling. Baseline must reflect canonical server IDs/names; only transform the live draft entries proven to correspond to acknowledged request selections, preserving additions/removals made after dispatch and local revision ordering. Avoid changing `normalizeNoteDraft`'s frozen POST identity semantics.
- [ ] **5. Run GREEN:** Repeat focused tests; specifically prove clean state does not conceal a newer Tag change and no extra request is dispatched when effective Tag set equals server state.
- [ ] **6. Commit:** `git commit -m "fix(notes): reconcile canonical Tag identities after saves"` with focused files.

### Task 3 — Show actionable `400 errors.tags` feedback (approved D12)

**Files:** Modify `client/src/note/NoteSaveCoordinator.ts`, `client/src/note/NoteEditorPage.tsx`; tests `client/src/note/NoteSaveCoordinator.test.ts`, `NoteEditorPage.test.tsx`, optionally `useNoteAutosave.test.tsx`.

**Interface:** Add a narrowly scoped `tagValidationError: string | null` (or equivalent typed validation field) to `NoteSaveSnapshot`; map Axios RFC 9457 `response.data.errors.tags` only for **definitive 400**. Keep a user-safe fallback message if data is absent; never reveal whether a foreign Tag exists. No raw server stack traces; no Tag error for unrelated `400 errors.title` or rich-text failures.

- [ ] **1. Write RED:** POST and PATCH `400 {errors:{tags:"One or more Tag references are invalid."}}` produce failed status, preserve full draft, expose the Tag error; editing does not dispatch; clicking Retry after correction creates a **new POST key** or fresh PATCH with existing version. On successful save clear stale Tag error. An unrelated `400 errors.content` remains generic save failure.
- [ ] **2. Write RED UI:** The editor renders `role="alert"` associated with the Tag selector and meaningful guidance to correct selection and click Retry; while failed it never claims Saved. Test safe default message when `errors.tags` is absent for a known Tag validation error.
- [ ] **3. Run RED:** `cd client && npm run test -- src/note/NoteSaveCoordinator.test.ts src/note/NoteEditorPage.test.tsx`.
- [ ] **4. Minimal fix:** Capture and publish field-level error on definitive 400. Preserve phase and manual Retry behavior; clear on successful acknowledgement/explicit server-load discard; avoid accidental auto-resume from ordinary typing. Keep Note title/body and Tags intact.
- [ ] **5. Run GREEN:** Same tests; check a 409 still follows the whole-draft conflict UI, and unknown network errors retain frozen request behavior.
- [ ] **6. Commit:** `git commit -m "fix(notes): expose Tag validation failures in editor"`.

### Task 4 — Keep canonical Tag labels available after refresh/conflict/recovery

**Files:** Modify `client/src/note/NoteSaveCoordinator.ts`, `client/src/note/NoteEditorPage.tsx`, optionally `client/src/tag/TagSelector.tsx` if needed; tests `client/src/note/{NoteEditorPage.test.tsx,NoteSaveCoordinator.test.ts}` and `client/src/tag/TagSelector.test.tsx`.

**Contract:** Existing editor passes `knownTags={initialNote?.tags ?? []}`, which can be stale after a new GET/POST/PATCH. Tags loaded with `Load latest version` or acknowledged after create/update must display **canonical names**, not fallback `Tag #42`. Reuse metadata from authoritative server responses; keep the data scoped to the current owner. Do not expose a new Tag HTTP request just to retrieve already returned names.

- [ ] **1. Write RED:** Start editor with no Tag `42` in `initialNote.tags`; perform confirmed Load latest receiving `{id:42,name:"Planning"}`; assert rendered chip **Planning**, not `Tag #42`. Test first-create acknowledged name and Tag-only PATCH acknowledgement; no edit reset/caret movement or cross-owner label reuse.
- [ ] **2. Run RED:** `cd client && npm run test -- src/note/NoteEditorPage.test.tsx src/tag/TagSelector.test.tsx src/note/NoteSaveCoordinator.test.ts`.
- [ ] **3. Minimal fix:** Make the coordinator snapshot/editor supply a bounded current-owner map/list of canonical `Tag` metadata from initial Note **and** subsequent server acknowledgements and conflict-load GETs. Prefer an existing snapshot/Query source over parallel state if it stays fresh; avoid Tag-specific re-fetch or a generic global Tag store. Preserve selector keyboard and duplicate behavior for Tasks.
- [ ] **4. Run GREEN:** Same targeted tests and `src/task/TaskTagSelector.test.tsx` / `src/task/useTaskTagsEdit.test.tsx`; require PASS.
- [ ] **5. Commit:** `git commit -m "fix(notes): refresh canonical Tag labels after server updates"`.

### Task 5 — Worthwhile CodeRabbit static-analysis cleanups

**CodeRabbit source:** PR #90 general review contains the following *verified-style code quality* suggestions; only apply those whose current code remains valid.

**Files:** Modify `server/src/main/java/com/krishnamurti/horizon/note/application/{IdempotentNoteCreationService,NoteCommandService,NoteCreationResult}.java`, `server/src/main/java/com/krishnamurti/horizon/note/web/NoteRequestMapper.java`; use existing backend tests plus focused mapper tests if present.

- [ ] **1. Write/identify RED checks:** Existing request shape tests cover `tags` missing/null/[]/invalid-ID/name/mixed fields; existing service tests cover transactional rollback and replay. Add focused parsing cases only if absent. Capture existing green baseline before a behavior-preserving refactor; this task is static-analysis cleanup, so a new failing functional test is not required when no functional defect exists.
- [ ] **2. Small refactor:** Extract `NoteRequestMapper.parseTagSelection(JsonNode)` and `parseTagId(JsonNode)` from `parseTags` to reduce SonarCloud cognitive complexity without changing errors or edge-case acceptance.
- [ ] **3. Small refactor:** Replace same-bean `@Transactional` delegation in `IdempotentNoteCreationService.create(...)` and `NoteCommandService.create(...)` with a private `doCreate(...)` helper; preserve `@Transactional` on all public externally callable entry points and return shapes. This resolves lint, **not** a currently demonstrated transaction failure.
- [ ] **4. One-line cleanup:** Add `@Override` to `NoteCreationResult.note()` accessor when still absent.
- [ ] **5. Run tests/check:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteControllerIntegrationTest,NoteCreationFingerprintTest,IdempotentNoteCreationServiceTest,NoteTagAssignmentServiceIntegrationTest test`; then `./mvnw -Duser.timezone=UTC verify`. Confirm no new/static-analysis warnings, rollback or API contract change.
- [ ] **6. Commit:** `git commit -m "refactor(notes): reduce parser complexity and transaction lint"`.

### Task 6 — Strengthen targeted regression assertions

**Files:** Modify `server/src/test/java/com/krishnamurti/horizon/note/application/NoteTagAssignmentServiceIntegrationTest.java`, `server/src/test/java/com/krishnamurti/horizon/tag/application/TagNormalizationServiceTest.java`, `client/src/note/api.test.ts`.

- [ ] **1. RED/quality assertion:** Current rollback test catches any `RuntimeException`, which could pass before the `note_tag` trigger runs. Assert the distinctive nested cause/stack contains `association rejected`, then assert the newly resolved Tag and association remain absent. Keep trigger cleanup in `finally`.
- [ ] **2. Tighten input test:** Calculate `String tooLongName = "x".repeat(101);` *before* the AssertJ `assertThatThrownBy` lambda. The lambda should contain only the normalization call.
- [ ] **3. Strengthen client API test:** Assert `tags` on the `noteApi.list(...)` **returned item** (e.g. `data.items[0].tags`) and not merely `'tags' in summary` fixture. Preserve existing typed test payload and API call assertions.
- [ ] **4. Run tests:** `cd server && ./mvnw -Duser.timezone=UTC -Dtest=NoteTagAssignmentServiceIntegrationTest,TagNormalizationServiceTest test`; `cd client && npm run test -- src/note/api.test.ts`. All pass; no production behavior change.
- [ ] **5. Commit:** `git commit -m "test(notes): strengthen Tag rollback and API assertions"`.

### Task 7 — High-value browser integration and final PR verification

**Files:** Extend `client/e2e/notes-tags.spec.ts` and only supporting mocks/helpers needed. No new feature behavior.

- [ ] **1. Add Playwright test:** Existing Note Tag PATCH fails with RFC 9457 `400 errors.tags`; UI shows actionable Tag error and Retry, preserves title/body/Tags, and correcting then clicking Retry succeeds with new request reflecting corrected set. Use deterministic mocked responses; assert no automatic retry before click.
- [ ] **2. Add Playwright test:** After another editor updates the Note, conflict **Load latest** displays newly returned canonical Tag names (not `Tag #ID`), with approved confirmation and no implicit overwrite. Check accessible names/keyboard where relevant.
- [ ] **3. Add or expand one browser regression:** Cross-workspace reused Tag appears by name in Notes, or replay/recovery flow if existing Task↔Note integration already covers reused names. Don't duplicate every coordinator/DB test in Playwright; add the highest-value missing browser boundary.
- [ ] **4. Run targeted browser tests:** `cd client && npm run test:e2e -- --grep "Notes Tags"` (match test names); require PASS. Run Task Tag selector regressions.
- [ ] **5. Run full quality gates:** `cd server && ./mvnw -Duser.timezone=UTC verify`; `cd client && npm run verify`; `cd client && npm run test:e2e`. Record exact result counts, duration-independent facts and environmental blockers. Re-run PR CI/Sonar checks; avoid claiming Sonar passed without a new workflow run.
- [ ] **6. Re-review:** Compare diff with original #72 spec, confirm no Tag filtering/management/owner leakage, ensure fixed CodeRabbit major issues and meaningful low-cost nitpicks are addressed, and retain all first-create, session and conflict guarantees.
- [ ] **7. Commit/report:** Commit only if browser tests actually changed, e.g. `git commit -m "test(notes): cover Tag validation and canonical UI recovery"`. Post concise verification and disposition summary to PR #90; seek owner approval before any merge.

## CodeRabbit disposition — include in final PR review summary

| Finding | Decision |
| --- | --- |
| Major: name-based Tag save reconciliation | **FIX** in Task 2 |
| Major: historical tag-free fingerprint replay | **FIX** in Task 1 |
| Self-invocation warnings, both services | **FIX** bounded refactor Task 5 |
| `parseTags` cognitive complexity | **FIX** Task 5 |
| Missing record accessor `@Override` | **FIX** Task 5 |
| Weak rollback exception assertion | **FIX** Task 6 |
| Build 101-char string outside assertion lambda | **FIX** Task 6 |
| `api.test.ts` asserts fixture instead of returned Tags | **FIX** Task 6 |
| Optional `Note::getId` method reference | **SKIP** — stylistic/no practical benefit; avoid new import |
| Chunk `IN (:noteIds)` for >32,767 IDs | **SKIP** — current Notes pagination caps pages at 100; no such caller; revisit only if API contract changes |
| Blanket 80% docstring-coverage suggestion | **SKIP** — not a Horizon rule; avoid boilerplate |
| Any generic CodeRabbit autofix/doc-generation request | **SKIP** without independently verified value |

## Definition of done / escalation

- [ ] All four review defects resolved: legacy receipt replay, lost-response name→ID reconciliation, field-level Tag validation UX, and canonical display after server update/conflict.
- [ ] Both major CodeRabbit findings have passing regression tests that fail against pre-fix code.
- [ ] Original #72 semantics and cross-owner security preserved; frozen retry request identities unchanged.
- [ ] Worthwhile CodeRabbit test-quality/static checks fixed; skipped findings explained with evidence.
- [ ] Relevant backend/TypeScript/Playwright gates pass, or blockers explicitly documented.
- [ ] PR #90 updated on the existing branch, small commits, no new PR or merge.

**Stop and escalate** if fixing reconciliation demands changing the approved request-identity fingerprint, auto-merging conflicts, adding Tag lookup APIs, persisted drafts, or more than narrow selected-file refactors. The code reviewer and agent should never treat a suggestion as approval to redesign the product.
