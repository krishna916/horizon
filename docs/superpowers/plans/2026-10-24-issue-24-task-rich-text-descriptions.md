# Issue #24 — Task Rich-Text Descriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support Notion/Obsidian-inspired rich task descriptions with Markdown typing shortcuts, automatic Markdown paste, explicit Save/Cancel and secure Tiptap JSON persistence in both detail surfaces.

**Architecture:** Keep the canonical `task.description` as nullable JSONB. Build a small reusable frontend rich-text area that owns one Tiptap schema, rendering, editor toolbar, JSON normalization and Markdown paste adapter; Task feature owns create/edit state, API, dirty guard and user-scoped caching. Reuse one Task-domain server validator for POST and PATCH without a DB migration.

**Tech Stack:** React 19, TypeScript 6, Tiptap 3 (`@tiptap/react` and `@tiptap/starter-kit` already installed; add version-aligned `@tiptap/extension-table` and `@tiptap/markdown`), shadcn/ui, TanStack Query/Router, Vitest/RTL, Playwright; Java 25, Spring Boot 4, PostgreSQL JSONB, Maven/Testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-24-issue-24-task-rich-text-description-design.md`

**Product references:** GitHub issue #24; `docs/design/tasks-workspace/DESIGN-SPEC.md`; PRD-004 Tasks (FR-015/FR-022); Constitution; `client/AGENTS.md` and repository engineering guides.

## Global Constraints

- **Owner-approved:** JSONB stores valid Tiptap JSON or `null`; no Markdown/HTML persistence, migration or export framework.
- **Owner-approved:** both TaskCreateForm and shared TaskDetailView support all nine PRD formatting categories plus horizontal rules, Markdown input rules, Markdown-source paste and rich HTML paste.
- **Owner-approved:** empty description displays `Add description…`, single click activates; populated read mode uses double click; Enter/Space accessible keyboard activation.
- **Owner-approved:** clickable safe links open new tab using `rel="noopener noreferrer"`; toolbar appears only while editing (creation always counts as editing).
- **Owner-approved:** no autosave/blur-save; explicit Save/Cancel; preserve dirty navigation guard and failed-save retry; never show description in task list rows.
- **Engineering conventions from spec:** heading levels 1–3 preserve `#`/`##`/`###` Markdown semantics; protect intentionally empty tables; validator bounds 256 KiB UTF-8 JSON / 10,000 nodes / nesting depth 32. Flag a true conflict; do not quietly change semantics.
- **Compatibility:** accept old plain-paragraph documents and nullable columns; maintain created/updated metadata, auth/ownership, idempotent create snapshots, user-bound query keys.
- **Dependency discipline:** verify the Tiptap 3 API against pinned installed version and current official docs (use Context7 if available); no paid Tiptap extension; use TableKit/Markdown only if tests confirm required behavior. Official refs: https://tiptap.dev/docs/editor/extensions/functionality/table-kit and https://tiptap.dev/docs/editor/markdown/examples.
- **Execution:** keep this branch focused on #24; TDD for each task; focused meaningful commits; self-review and check changed behaviors against PRD before PR.

## Review Focus

1. **A malicious/unknown mark or `javascript:` link in POST/PATCH:** 400, scoped to `description`; existing DB content never executes code (Tasks 1, 2, 3).
2. **A plain-text clipboard with full Markdown (nested list, fenced code, GFM table), including one containing HTML:** convert supported structures once, retain text and safe links; preserve rich HTML precedence; fallback without loss (Task 4).
3. **A user types in description, then clicks another field or leaves the panel; Save fails:** previous draft remains editable; correct blocking and Save/Discard/Keep Editing without silent reset (Task 8).
4. **An empty paragraph vs an empty table:** whitespace yields `null` and placeholder, intentionally inserted table survives create/save/reload (Tasks 1, 3, 7, 8).
5. **Create returns ambiguous network failure after editing rich text:** retry reuses exact payload/idempotency key; disabled form cannot mutate snapshot; no duplicate task (Task 7).

---

## Implementation map (ownership, not a cross-feature platform)

| Unit | Responsibilities | Files |
| --- | --- | --- |
| Task domain | strict JSON schema, safety, normalization, depth/node/size limits | New `server/src/main/java/com/krishnamurti/horizon/task/domain/TaskDescriptionValidator.java`, modify `Task.java` |
| Task transport | correctly route POST/PATCH through validation and preserve error response contract | `TaskController.java`, `TaskRequestMapper.java`, web/integration tests |
| Shared frontend rich text | configured Tiptap extensions, Markdown adapter, JSON shape/empty logic, safe read-only view, formatting toolbar/editor | New small files under `client/src/components/rich-text/` |
| Task data adapter | payload types and successful cache reconciliation | `client/src/task/types.ts`, `useUpdateTask.ts` |
| Creation | optional rich editor in form, dirty guard, idempotent recovery | `client/src/task/TaskCreateForm.tsx` |
| Task detail | one description edit state and existing single-registration navigation guard, panel/page parity | `client/src/task/TaskDetailView.tsx`, new `useTaskDescriptionEdit.ts` and `TaskDescriptionField.tsx` |
| Verification | tests / E2E / build checks | `server/src/test/...`, `client/src/**/*.test.*`, `client/e2e` |

### Task 1: Strict Task-domain JSON validator and null normalization

**Files:**
- Create: `server/src/main/java/com/krishnamurti/horizon/task/domain/TaskDescriptionValidator.java`
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/domain/Task.java`
- Create: `server/src/test/java/com/krishnamurti/horizon/task/domain/TaskDescriptionValidatorTest.java`
- Modify: `server/src/test/java/com/krishnamurti/horizon/task/domain/TaskTest.java`

**Interfaces:**
- Produce: `public static Map<String, Object> validateAndCopy(Map<String, Object> input)`; return normalized defensive copy or `null`; throw `InvalidTaskException("description", detail)`.
- Existing Task create/update methods call only this boundary for description assignment. Never expose the input map by reference.

- [ ] **Step 1 — RED:** write parameterized validator tests: `null` and legacy `doc -> paragraph -> text` pass; empty/whitespace-only paragraphs -> `null`; a structurally empty table retains JSON; valid heading levels 1/2/3, bold/italic/link, ordered/bullet list, codeBlock, blockquote, horizontalRule, tableRow/tableCell/tableHeader pass. Test defensive nested copy.
- [ ] **Step 2 — RED:** assert unknown type/mark/attrs, script link protocol, malformed tree placement, non-string text, invalid heading level/table attrs, over-size, >10,000 nodes and depth >32 all raise `InvalidTaskException` for `description`. Explicitly cover Tiptap's nullable/default node attrs (`colspan`, `rowspan`, `colwidth`, link `target`/`rel`/`class`, ordered list `start`, code block `language`) with carefully allowlisted types; accept only what configured editor actually emits.
- [ ] **Step 3 — Verify RED:** `cd server && ./mvnw -Dtest=TaskDescriptionValidatorTest,TaskTest test`; expected fail.
- [ ] **Step 4 — GREEN:** implement bounded iterative/controlled-depth traversal, schema-aware allowed child types, UTF-8 size bound and normalized copy; validate safe links as absolute http(s)/mailto, rejecting harmful schemes and unexpected link attr values. Reuse it from `Task.create` and `Task.updateDescription`; remove redundant shallow domain validation but preserve existing defensive copy in `getDescription`.
- [ ] **Step 5 — Verify GREEN:** repeat focused Maven test; expected pass; review input rules against actual JSON emitted by configured Tiptap in Task 3. Commit `feat(task): validate and normalize rich-text description JSON`.

### Task 2: POST/PATCH API round-trips, error contract and persistence

**Files:**
- Modify: `server/src/main/java/com/krishnamurti/horizon/task/web/TaskController.java`, `TaskRequestMapper.java` only as needed
- Modify: `server/src/test/java/com/krishnamurti/horizon/task/web/TaskControllerIntegrationTest.java`
- Modify: `server/src/test/java/com/krishnamurti/horizon/task/infrastructure/TaskPersistenceIntegrationTest.java`
- Modify: `server/src/test/java/com/krishnamurti/horizon/task/application/TaskCreationFingerprintTest.java` if normalization affects create fingerprints

**Interfaces:**
- POST `/api/v1/tasks`: optional `description: doc | null`; PATCH `/api/v1/tasks/{id}`: omitted description untouched, `description: null` clears, `description: doc` replaces. Both produce TaskDetailResponse with original supported JSON structure and `updatedAt` behavior.

- [ ] **Step 1 — RED:** integration-test create with formatted document and idempotency key, GET after transaction/reload retaining list/table/links/heading; patch a description and reload; clear with null; patch another field without modifying description; inaccessible user sees 404; list summary omits description.
- [ ] **Step 2 — RED:** invalid nested type/mark/link/attributes/document depth/size must get HTTP 400 and existing `description` field error on BOTH POST and PATCH; response must not be 500. Failed patch must leave content/`updatedAt` intact; completing/archiving must not prevent valid description editing.
- [ ] **Step 3 — Verify RED:** `cd server && ./mvnw -Dtest=TaskControllerIntegrationTest,TaskPersistenceIntegrationTest test`; expected fail.
- [ ] **Step 4 — GREEN:** route both create and update through the single domain validator. Map object-structure failures to existing `TaskExceptionHandler` shape; preserve service ownership logic, existing Flyway schema and idempotent receipt/fingerprint semantics. **No migration.**
- [ ] **Step 5 — Verify GREEN:** repeat tests, plus `./mvnw test` when Testcontainers environment is available; commit `test(task): cover rich-text API validation and JSONB round-trips` (include minimal API changes).

### Task 3: Shared Tiptap schema, document adapter and safe read-only display

**Files:**
- Create: `client/src/components/rich-text/richTextExtensions.ts`
- Create: `client/src/components/rich-text/richTextDocument.ts`
- Create: `client/src/components/rich-text/RichTextViewer.tsx`
- Create: `client/src/components/rich-text/richTextDocument.test.ts`
- Create: `client/src/components/rich-text/RichTextViewer.test.tsx`
- Modify: `client/package.json`, `client/package-lock.json` (or repo's actual lockfile only)

**Interfaces:**
- `type RichTextDocument = Record<string, unknown>` exported from `richTextDocument.ts` (narrower Tiptap JSON type is fine if compatible with Task payload).
- `normalizeRichTextDocument(document: RichTextDocument | null): RichTextDocument | null` — valid content preserved, whitespace-only -> null; structural content such as table/horizontalRule preserved.
- `toEditorDocument(document: RichTextDocument | null): RichTextDocument` — null -> valid empty doc.
- `getRichTextExtensions()` — one configuration used by editor and viewer; StarterKit + TableKit + Markdown (later Task 4); Link config enforces safe protocols and outbound rel/target. Avoid registering duplicate Link/StarterKit marks.
- `RichTextViewer({value}: {value: RichTextDocument | null})` safe noneditable Tiptap read mode, no unsanitized HTML injection; links clickable via keyboard/mouse.

- [ ] **Step 1 — RED:** document-helper tests for null, empty paragraph, whitespace-only, legacy saved docs, empty table and horizontalRule; viewer RTL tests for formatting semantics (heading/list/table/code/quote/link), outbound link attributes, malicious legacy document never executing scripts/crashing.
- [ ] **Step 2 — Verify RED:** `cd client && npm test -- richTextDocument.test.ts RichTextViewer.test.tsx`; expected fail.
- [ ] **Step 3 — GREEN:** add `@tiptap/extension-table` and `@tiptap/markdown` matching installed v3 versions; implement focused extension config and safe viewer, avoiding `dangerouslySetInnerHTML`. Disable unused StarterKit nodes/marks if server validator intentionally excludes them; preserve old paragraph docs. For legacy malformed JSON render escaped fallback or unavailable-content message without throwing.
- [ ] **Step 4 — Verify GREEN:** focused tests, `npm run typecheck`; expected pass. Commit `feat(rich-text): define editor schema and secure document viewer`.

### Task 4: Markdown shortcuts and automatic Markdown-source paste

**Files:**
- Create: `client/src/components/rich-text/markdownPaste.ts`
- Create: `client/src/components/rich-text/markdownPaste.test.ts`
- Modify: `client/src/components/rich-text/richTextExtensions.ts`
- Create: `client/src/components/rich-text/richTextExtensions.test.ts` (or integrated RTL test when editor exists in Task 5)

**Interfaces:**
- `looksLikeMarkdown(text: string): boolean` returns true for confident Markdown structures, false for ordinary prose and ambiguous punctuation.
- `createMarkdownPasteExtension()` (or equivalent Tiptap/ProseMirror extension) takes `text/plain` only when Markdown-source intent is established, uses `editor.markdown.parse(text)` then `insertContent(parsedJson)` at current selection, and returns the paste event as handled exactly once; default editor paste remains fallback.
- Existing configured Tiptap Markdown extension remains adapter-owned; persistence is always JSON.

- [ ] **Step 1 — RED:** tests for Markdown headings `#`/`##`/`###`, `**bold**`, `*italic*`, links, bullet/ordered/nested lists, fenced multiline code, quote, `---`, GFM table, combinations; assert generated nodes conform to validator schema and can round-trip JSON.
- [ ] **Step 2 — RED:** integration tests for actual clipboardData: marked plain text converts at cursor without replacing document; rich HTML from browser/Docs retains supported formatting instead of double-handling its text/plain part; ordinary literal text/asterisks/`---` mid-paragraph remains literal; unsafe Markdown link is non-clickable text or rejected; malformed input falls back without loss; Undo reverses conversion.
- [ ] **Step 3 — Verify RED:** `cd client && npm test -- markdownPaste.test.ts richTextExtensions.test.ts`; expected fail.
- [ ] **Step 4 — GREEN:** use official `@tiptap/markdown` parser, conservative detection and a small ProseMirror paste plugin as illustrated at https://tiptap.dev/docs/editor/markdown/examples; do not build an ad-hoc multiline Markdown regex parser. Existing Tiptap input rules perform live shortcuts, add only missing verified behaviors. Confirm whether `---` and triple-backtick rules trigger on Space/Enter in pinned version; test real typing events.
- [ ] **Step 5 — Verify GREEN:** all Markdown/paste/renderer tests pass. Document any beta parsing incompatibility and **stop for owner review if supported V1 data would be lost**; do not silently relax requirements. Commit `feat(rich-text): convert Markdown typing and paste to structured content`.

### Task 5: Reusable editor and formatting toolbar

**Files:**
- Create: `client/src/components/rich-text/RichTextEditor.tsx`
- Create: `client/src/components/rich-text/RichTextToolbar.tsx`
- Create: `client/src/components/rich-text/RichTextEditor.test.tsx`
- Modify: `client/src/index.css` only for scoped editable/read-only typography and responsive table overflow as necessary

**Interfaces:**
- `RichTextEditor({value,onChange,disabled,ariaLabel}: {value: RichTextDocument|null; onChange:(next:RichTextDocument|null)=>void; disabled?:boolean; ariaLabel:string})` (may add focus ref on need). Emits normalized JSON-or-null, not HTML/Markdown; on subsequent edit start initializes from current Task data.
- Toolbar controls: bold, italic, heading levels 1–3, bullet/ordered lists, link add/edit/remove, code block, blockquote, horizontalRule, insert/delete table and row/column basics; add keyboard shortcuts via existing Tiptap rules.
- Ensure toolbar pointer-down does not steal text selection before formatting; no global CSS bleed.

- [ ] **Step 1 — RED:** RTL tests toggling supported marks/blocks, insert and edit link with safe URL validation, insert table/add row/delete column, heading style, editor disabled state; verify emitted JSON and toolbar no unintended submit in create form.
- [ ] **Step 2 — RED:** test type/paste examples through an actual editor instance (not helper mocks only), focus/selection, keyboard Undo, rich HTML paste and Markdown paste parity with the configured renderer.
- [ ] **Step 3 — Verify RED:** `cd client && npm test -- RichTextEditor.test.tsx`; expected fail.
- [ ] **Step 4 — GREEN:** implement shared controlled editor using Tiptap 3 `useEditor`, `EditorContent`, shadcn Button/accessible labels. Tooltip/dialog for link accepts https/http/mailto only. Toolbar compact and persistent only when editor shown. Handle prop-driven initial content without destructive resets on own change events.
- [ ] **Step 5 — Verify GREEN:** targeted tests + `npm run lint && npm run typecheck`; commit `feat(rich-text): add shared accessible editor and formatting toolbar`.

### Task 6: Task update payload and successful-cache reconciliation

**Files:**
- Modify: `client/src/task/types.ts`
- Modify: `client/src/task/useUpdateTask.ts`
- Modify: `client/src/task/useUpdateTask.test.tsx`

**Interfaces:**
- Add `{ description: Record<string, unknown> | null }` to `UpdateTaskPayload`; preserve existing title/priority/dueDate variants and `taskApi.update` endpoint.
- On successful PATCH reconcile `description` and server `updatedAt` in user-scoped detail cache; never introduce `description` into `TaskSummary`/list.

- [ ] **Step 1 — RED:** mutation tests: description update uses expected PATCH payload; returned JSON populates detail even when cache exists; `null` clearing works; list row includes only summary fields; fail 400/500 keeps previous cache; stale auth user result cannot update new user's cache.
- [ ] **Step 2 — Verify RED:** `cd client && npm test -- useUpdateTask.test.tsx`; expected fail.
- [ ] **Step 3 — GREEN:** minimal union type and cache mutation extension using the server response (not optimistic guess), preserving list invalidation/`updatedAt` behavior and type narrowing.
- [ ] **Step 4 — Verify GREEN:** focused tests + typecheck; commit `feat(task): support description PATCH cache reconciliation`.

### Task 7: Rich-text Task creation, dirty guard and idempotent retries

**Files:**
- Modify: `client/src/task/TaskCreateForm.tsx`
- Modify: `client/src/task/TaskCreateForm.test.tsx`
- Modify: `client/src/task/TaskCreateSurface.test.tsx`
- Replace/retire old `client/src/task/taskDescriptionDocument.ts` only if no other caller remains; update tests if removed

**Interfaces:**
- Form description is `RichTextDocument | null`, initially null. A controlled rich editor uses the common normalization adapter and form state; submit snapshot captures exact JSON; `CreateTaskPayload.description` omitted when null.
- No change to `TaskCreateRecovery` semantics, generated UUID, `onDirtyChange`, `onSubmittingChange` or cancel behavior.

- [ ] **Step 1 — RED:** test empty create submits title alone; rich headings/list/table pasted/typed then Create sends structured JSON; description editing alone sets create guard dirty; Cancel discards without create; server field validation displays error at description.
- [ ] **Step 2 — RED:** ambiguous response (network/408/5xx) holds one immutable `TaskCreateRecovery` payload and key; Retry sends same request, edit UI disabled during pending/recovery; user change protects old snapshot; successful create opens detail. Assert whitespace-only doc omitted but blank inserted table retained.
- [ ] **Step 3 — Verify RED:** `cd client && npm test -- TaskCreateForm.test.tsx TaskCreateSurface.test.tsx`; expected fail.
- [ ] **Step 4 — GREEN:** replace textarea with `RichTextEditor`, integrate with RHF via Controller/setValue+shouldDirty (not duplicate source-of-truth), adjust Zod schema to JSON-or-null and server field error mapping. Update `reportDirtyFromCurrentValues` and checklist path to account for semantic rich text. Preserve title autofocus and pending submit guards.
- [ ] **Step 5 — Verify GREEN:** focused tests, typecheck, existing `task-create.spec.ts` Playwright; commit `feat(task): create tasks with formatted descriptions`.

### Task 8: Detail description editing, exclusivity, Save/Cancel and navigation guard

**Files:**
- Create: `client/src/task/useTaskDescriptionEdit.ts`
- Create: `client/src/task/TaskDescriptionField.tsx`
- Create: `client/src/task/TaskDescriptionField.test.tsx`
- Modify: `client/src/task/TaskDetailView.tsx`, `TaskDetailView.test.tsx`
- Modify: `client/src/task/TaskDetailPage.test.tsx` and `TaskDetailSurface.test.tsx` only when coverage requires
- Leave `TaskFieldEditor.tsx` focused on existing scalar fields; do not force JSON into its string draft API

**Interfaces:**
- `useTaskDescriptionEdit(task: TaskDetail, userId: number)` returns `{editing, draft, dirty, pending, error, activate, change, save, cancel}` where `save(): Promise<boolean>`; save delegates to existing `useUpdateTask` with description PATCH. Snapshot baseline at activation; dirty uses normalized semantic JSON equality, not transient Tiptap selection.
- `TaskDescriptionField` renders placeholder/viewer/editor and Save/Cancel; receives callbacks and busy/blocking state. Integrate with `TaskDetailView`'s *existing* single `TaskDraftNavigationGuard` registration `field:<userId>:<taskId>:description` when active. Do not install a second independent draft guard.

- [ ] **Step 1 — RED:** component tests: empty placeholder single click + Enter/Space opens editor; populated read mode preserves markup and opens on non-link double click; link click opens safe destination without starting edit; description edit single-click elsewhere never autosaves; Cancel restores initial JSON; Save issues one PATCH and updates metadata.
- [ ] **Step 2 — RED:** hook/integration tests: dirty navigation invokes Save/Discard/Keep Editing; failed save keeps draft and offers retry; only one registration between title/priority/dueDate/description/checklist; editing desc blocks checklist and scalar activation, and vice versa; panel/page share identical view; route/task/user identity changes do not leak old draft; completed/archived task remains editable.
- [ ] **Step 3 — Verify RED:** `cd client && npm test -- TaskDescriptionField.test.tsx TaskDetailView.test.tsx`; expected fail.
- [ ] **Step 4 — GREEN:** implement typed rich JSON edit state and normalized comparisons. Adapt `TaskDetailView` guard registration and `editorProps.onActivate`/ChecklistSection `editBlocked` to enforce one active editor, not concurrent guards. Wire field Save/Cancel into the existing user-scoped mutation; reset on successful save, retain draft on failed save; do not modify list rows. Avoid task mount key/order regressions.
- [ ] **Step 5 — Verify GREEN:** focused tests + `npm run typecheck` and existing detail/edit navigation tests; commit `feat(task): edit and render rich descriptions in task detail`.

### Task 9: End-to-end regression, accessibility/security audit and quality gates

**Files:**
- Create: `client/e2e/task-rich-description.spec.ts`
- Modify: existing E2E/test fixtures only when needed (`client/e2e/task-create.spec.ts`, `task-detail.spec.ts`, `task-edit.spec.ts`)
- Update minimal project documentation only for genuine developer-facing rich-text contract decisions

**Interfaces:** No new runtime interfaces. Final acceptance evidence across server + client + actual browser.

- [ ] **Step 1 — E2E RED:** scripted user creates with Markdown source pasted (`###`, bullet, link, fenced code, GFM table, divider), saves, reloads, opens panel and full page, sees matching formatted output; asserts no description preview in task list.
- [ ] **Step 2 — E2E RED:** editing + Cancel/blur, successful Save, navigation guard Save/Discard/Keep Editing, failed network PATCH preserving draft, outbound links safe, keyboard activation, completed/archived edits. Cover whether Markdown-aware paste rule can be undone normally.
- [ ] **Step 3 — GREEN:** resolve only regressions related to this slice; run `cd client && npm run test:e2e -- task-rich-description.spec.ts` with existing Playwright server/test setup, expected pass.
- [ ] **Step 4 — Full gates:** `cd server && ./mvnw verify` (or documented CI verification goal if project defines a different profile); `cd client && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`. If environment lacks Docker/browser dependencies report blockers explicitly, do not claim green.
- [ ] **Step 5 — Final review:** inspect PR diff for unintended Notes/editor platform, import/export, DB migration, unsafe HTML, duplicate Link extensions, same-content data loss, stale cache and module boundary violations. Commit remaining focused fixes (`test(task): verify rich-text end-to-end behaviors`). Open PR to `master` linked to #24 only after reviewing changed-files scope and passing available gates.

## Acceptance traceability

- Issue #24 all formats + panel/page reload parity: Tasks 1–5, 7–9.
- PRD FR-015 nine formats; horizontalRule user addition: Tasks 1–5, 9.
- Markdown typing AND multiline clipboard-source paste: Tasks 3–5, 7–9.
- Secure rendering / protocol validation: Tasks 1–5, 9.
- Explicit Save/Cancel / no blur / error recovery / dirty guard: Tasks 6–9.
- Optional creation / idempotent retries / user ownership: Tasks 2, 7, 9.
- No list description previews / metadata update: Tasks 2, 6, 8, 9.
- Safe foundation for Notes without editor platform: Tasks 3–5; future backlog only.

## Executor handoff / escalation rules

1. Read this plan and its **Spec** in full, plus issue #24, approved workspace design, Constitution, Task PRD, client AGENTS and repository implementation guide.
2. Start from feature branch `issue-24-rich-text-descriptions`; inspect actual branch/master before editing; do not overwrite or discard uncommitted work.
3. Execute tasks in order using Superpowers (`subagent-driven-development` preferred; `executing-plans` acceptable); RED -> GREEN -> commit per task. Validate current Tiptap package API and version before choosing implementation details.
4. No implementation shortcuts: **automatic Markdown-source paste** must be tested with multiline lists, code and tables; do not represent it as implemented merely because Tiptap input rules work.
5. If the beta Markdown parser drops agreed content or strict server rules disagree with *actual* valid editor output, **stop and ask owner** rather than discard content, weaken security, silently change the schema, or scope-creep.
6. Preserve existing product behavior and authorization. Do not implement deferred Notion/Obsidian features, Notes, import/export or platform abstractions in this issue.
7. Finish with tests/gates evidence, known limitations, changed-file summary, and PR link; request review instead of merging autonomously.
